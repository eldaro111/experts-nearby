-- UI/server integration: additive API, existing direct task updates remain supported.
-- First run diagnostics/ER-001-task-schedule.sql. No existing rows are repaired.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $preflight$
declare expected record; actual record;
begin
  for expected in select * from (values
    ('append_project_activity_internal', 'e675251f0c4cd0ca8e003455a1c4b620', 'ab92d6706e58aec99932c5096f4f213e'),
    ('trusted_activity_from_task', 'fd75269caef4168bc2d45afb5e478037', '4c00ec3fa3581db00df4b293b2eafca9'),
    ('phase8_guard_task_row', 'a5bbb8bd7b5c5a9d3042893086163ab5', '5193fd28c3a107eb5325b61d2e5d84e8')
  ) as v(name, old_hash, new_hash) loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=expected.name) <> 1 then
      raise exception 'ER-001: unexpected overload/missing function %', expected.name;
    end if;
    select p.*, pg_get_userbyid(p.proowner) as owner into actual
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=expected.name;
    if actual.owner <> 'postgres' or not actual.prosecdef
       or actual.proconfig is distinct from array['search_path=public, pg_temp']::text[]
       or md5(replace(actual.prosrc, chr(13), '')) not in (expected.old_hash, expected.new_hash) then
      raise exception 'ER-001: unexpected definition/owner/settings of %. Stop and inspect schema drift.', expected.name;
    end if;
    if expected.name <> 'phase8_guard_task_row' and
       (has_function_privilege('anon', actual.oid, 'EXECUTE')
        or has_function_privilege('authenticated', actual.oid, 'EXECUTE')) then
      raise exception 'ER-001: ER-SEC-001 required; effective client EXECUTE remains on %', expected.name;
    end if;
  end loop;
end $preflight$;

create or replace function public.append_project_activity_internal (
  p_project_id  uuid,
  p_type        text,
  p_title       text,
  p_body        text  default null::text,
  p_entity_type text  default null::text,
  p_entity_id   uuid  default null::uuid,
  p_metadata    jsonb default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_activity_id uuid;
begin
  if p_project_id is null then
    raise exception 'project_id обязателен для истории проекта.';
  end if;

  if p_type not in (
    'task_created',
    'task_schedule_changed',
    'task_completed',
    'task_status_changed',
    'task_assignee_changed',
    'task_deleted',
    'contribution_added',
    'contribution_verified',
    'file_uploaded',
    'file_deleted',
    'profile_review_created',
    'profile_review_updated'
  ) then
    raise exception 'Недопустимый внутренний тип истории: %', p_type;
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Заголовок истории обязателен.';
  end if;

  -- Для действий пользователя подтверждаем связь с проектом.
  -- Системные миграции с auth.uid() = null допускаются с actor_id = null.
  if v_actor_id is not null
     and not public.is_project_member(p_project_id, v_actor_id) then
    raise exception 'Пользователь не является участником проекта.';
  end if;

  insert into public.project_activity (
    project_id,
    actor_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_project_id,
    v_actor_id,
    p_type,
    left(btrim(p_title), 300),
    case
      when p_body is null then null
      else left(p_body, 4000)
    end,
    nullif(btrim(coalesce(p_entity_type, '')), ''),
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_activity_id;

  return v_activity_id;
end
$function$;

create or replace function public.trusted_activity_from_task()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_assignee_name text;
begin
  if tg_op = 'INSERT' then
    v_assignee_name := public.project_activity_profile_name(new.assignee_id);

    perform public.append_project_activity_internal(
      new.project_id,
      'task_created',
      format('Создана задача «%s»', new.title),
      case
        when new.assignee_id is null
          then 'Исполнитель пока не назначен.'
        else format(
          'Исполнитель: %s.',
          coalesce(v_assignee_name, 'Участник проекта')
        )
      end,
      'task',
      new.id,
      jsonb_build_object(
        'task_id', new.id,
        'task_title', new.title,
        'assignee_id', new.assignee_id,
        'status', new.status,
        'start_at', new.start_at,
        'due_at', new.due_at
      )
    );

    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.append_project_activity_internal(
      old.project_id,
      'task_deleted',
      format('Удалена задача «%s»', old.title),
      null,
      'task',
      old.id,
      jsonb_build_object(
        'task_id', old.id,
        'task_title', old.title,
        'last_status', old.status,
        'last_assignee_id', old.assignee_id
      )
    );

    return old;
  end if;

  -- Exactly one schedule event, independent of status/assignee changes.
  if new.start_at is distinct from old.start_at
     or new.due_at is distinct from old.due_at then
    perform public.append_project_activity_internal(
      new.project_id, 'task_schedule_changed',
      format('Изменены сроки задачи «%s»', new.title), null, 'task', new.id,
      jsonb_build_object('task_id', new.id, 'task_title', new.title,
        'old_start_at', old.start_at, 'new_start_at', new.start_at,
        'old_due_at', old.due_at, 'new_due_at', new.due_at)
    );
  end if;

  if new.status is distinct from old.status then
    perform public.append_project_activity_internal(
      new.project_id,
      case
        when new.status = 'done' then 'task_completed'
        else 'task_status_changed'
      end,
      case
        when new.status = 'done'
          then format('Задача «%s» завершена', new.title)
        else format('Статус задачи «%s» изменён', new.title)
      end,
      format('Статус: %s → %s.', old.status, new.status),
      'task',
      new.id,
      jsonb_build_object(
        'task_id', new.id,
        'task_title', new.title,
        'old_status', old.status,
        'new_status', new.status,
        'completed_at', new.completed_at
      )
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    v_assignee_name := public.project_activity_profile_name(new.assignee_id);

    perform public.append_project_activity_internal(
      new.project_id,
      'task_assignee_changed',
      format('Изменён исполнитель задачи «%s»', new.title),
      case
        when new.assignee_id is null
          then 'Исполнитель снят.'
        else format(
          'Новый исполнитель: %s.',
          coalesce(v_assignee_name, 'Участник проекта')
        )
      end,
      'task',
      new.id,
      jsonb_build_object(
        'task_id', new.id,
        'task_title', new.title,
        'old_assignee_id', old.assignee_id,
        'new_assignee_id', new.assignee_id
      )
    );
  end if;

  return new;
end
$function$;

create or replace function public.phase8_guard_task_row()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_excuse_changed boolean := false;
begin
  if new.start_at is not null and new.due_at is not null
     and new.due_at < new.start_at then
    raise exception using errcode = '23514', message = 'Дедлайн не может быть раньше начала.';
  end if;

  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Нельзя переносить задачу в другой проект.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'Нельзя изменять дату создания задачи.';
    end if;

    v_excuse_changed :=
      new.excuse_reason is distinct from old.excuse_reason
      or new.excuse_status is distinct from old.excuse_status
      or new.excuse_decided_by is distinct from old.excuse_decided_by
      or new.excuse_decided_at is distinct from old.excuse_decided_at;
  else
    v_excuse_changed :=
      new.excuse_reason is not null
      or new.excuse_status is distinct from 'none'
      or new.excuse_decided_by is not null
      or new.excuse_decided_at is not null;
  end if;

  if tg_op = 'INSERT'
     or new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null
       and not public.phase8_is_project_member_internal(
         new.project_id,
         new.assignee_id
       ) then
      raise exception
        'Исполнитель задачи должен быть участником этого проекта.';
    end if;
  end if;

  if new.excuse_status not in (
    'none',
    'pending',
    'approved',
    'rejected'
  ) then
    raise exception 'Недопустимый статус уважительной причины.';
  end if;

  if new.excuse_status in ('none', 'pending')
     and (
       new.excuse_decided_by is not null
       or new.excuse_decided_at is not null
     ) then
    raise exception
      'Для none/pending поля решения должны быть пустыми.';
  end if;

  if new.excuse_status = 'pending'
     and (
       new.excuse_reason is null
       or btrim(new.excuse_reason) = ''
     ) then
    raise exception 'Для отправки причины требуется текст.';
  end if;

  if new.excuse_status in ('approved', 'rejected') then
    if new.excuse_reason is null
       or btrim(new.excuse_reason) = ''
       or new.excuse_decided_by is null
       or new.excuse_decided_at is null then
      raise exception 'Решение по причине заполнено не полностью.';
    end if;

    if not public.phase8_is_project_owner_internal(
      new.project_id,
      new.excuse_decided_by
    ) then
      raise exception
        'Решение по причине может принадлежать только автору проекта.';
    end if;
  end if;

  if v_actor_id is not null and v_excuse_changed then
    if new.excuse_status = 'pending' then
      if new.assignee_id is null
         or new.assignee_id <> v_actor_id then
        raise exception
          'Отправить уважительную причину может только исполнитель задачи.';
      end if;
    elsif new.excuse_status in ('approved', 'rejected') then
      if not public.phase8_is_project_owner_internal(
        new.project_id,
        v_actor_id
      ) then
        raise exception
          'Решение по причине может принять только автор проекта.';
      end if;

      if new.excuse_decided_by <> v_actor_id then
        raise exception
          'excuse_decided_by должен совпадать с текущим пользователем.';
      end if;
    else
      raise exception
        'Клиент не может сбрасывать состояние уважительной причины.';
    end if;
  end if;

  return new;
end
$function$;

-- NOT VALID retains legacy invalid rows, but enforces the rule on every new/updated row.
-- Validate separately only after the owner resolves reported incompatibilities.
do $constraint$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.tasks'::regclass
                 and conname='tasks_schedule_order_check') then
    alter table public.tasks add constraint tasks_schedule_order_check
      check (start_at is null or due_at is null or due_at >= start_at) not valid;
  elsif (select pg_get_constraintdef(oid) from pg_constraint
         where conrelid='public.tasks'::regclass and conname='tasks_schedule_order_check')
         not in ('CHECK (((start_at IS NULL) OR (due_at IS NULL) OR (due_at >= start_at))) NOT VALID',
                 'CHECK (((start_at IS NULL) OR (due_at IS NULL) OR (due_at >= start_at)))') then
    raise exception 'ER-001: unexpected tasks_schedule_order_check definition';
  end if;
end $constraint$;

create or replace function public.reschedule_task_secure(
  p_task_id uuid, p_expected_start_at timestamptz, p_expected_due_at timestamptz,
  p_new_start_at timestamptz, p_new_due_at timestamptz
) returns public.tasks
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare v_task public.tasks; v_actor uuid := auth.uid(); v_finished timestamptz;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='Требуется вход в аккаунт.';
  end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or not public.is_project_member(v_task.project_id, v_actor) then
    raise exception using errcode='42501', message='Задача недоступна или нет прав на её изменение.';
  end if;
  -- Same task -> project lock order as the existing task guard. Membership/completion
  -- writers also lock this project. Recheck access after acquiring that lock.
  select completed_at into v_finished from public.listings where id=v_task.project_id for update;
  if not public.is_project_member(v_task.project_id, v_actor) then
    raise exception using errcode='42501', message='Задача недоступна или нет прав на её изменение.';
  end if;
  if v_finished is not null then
    raise exception 'Проект завершён: состав команды и задачи зафиксированы';
  end if;
  if v_task.start_at is distinct from p_expected_start_at
     or v_task.due_at is distinct from p_expected_due_at then
    raise exception using errcode='PT409', message='Сроки задачи уже изменил другой участник. Обновите данные.';
  end if;
  if p_new_start_at is not null and p_new_due_at is not null and p_new_due_at < p_new_start_at then
    raise exception using errcode='23514', message='Дедлайн не может быть раньше начала.';
  end if;
  if v_task.start_at is not distinct from p_new_start_at and v_task.due_at is not distinct from p_new_due_at then
    return v_task;
  end if;
  update public.tasks set start_at=p_new_start_at, due_at=p_new_due_at
    where id=p_task_id returning * into v_task;
  -- The existing AFTER trigger records the event in this same transaction.
  return v_task;
end $function$;
revoke all on function public.reschedule_task_secure(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon;
grant execute on function public.reschedule_task_secure(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
do $acl$
begin
  if has_function_privilege('anon','public.reschedule_task_secure(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','EXECUTE') then
    raise exception 'ER-001: inherited anon EXECUTE on reschedule_task_secure; no role membership changed';
  end if;
end $acl$;
notify pgrst, 'reload schema';
commit;
