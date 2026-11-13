-- ER-012 stage 1. Additive server API; no existing task/history backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare r record;
begin
 for r in select * from (values
   ('guard_completed_project_work'),('reschedule_task_secure'),('append_project_activity_internal')) v(name) loop
   if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=r.name)<>1
      or not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=r.name
       and pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=public, pg_temp']) then
     raise exception 'ER-012: unexpected owner/overload/settings of %. Inspect schema before applying.',r.name;
   end if;
 end loop;
end $preflight$;

create table public.project_planning (
  project_id uuid primary key references public.listings(id) on delete cascade,
  mode text not null default 'simple' check (mode in ('simple','kanban','scrum','custom')),
  goal text not null default '' check (length(goal) <= 4000),
  definition_of_done text not null default '' check (length(definition_of_done) <= 8000),
  wip_mode text not null default 'soft' check (wip_mode in ('soft','strict')),
  delegate_to_roles boolean not null default false,
  version bigint not null default 0 check (version >= 0)
);
create table public.project_roles (
  project_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('product_owner','scrum_master','developer')),
  primary key(project_id,user_id,role)
);
create unique index project_roles_one_lead on public.project_roles(project_id,role)
  where role in ('product_owner','scrum_master');
create table public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.listings(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  position integer not null check (position >= 0),
  category text not null check (category in ('todo','doing','done')),
  status_value text check (status_value is null or length(btrim(status_value)) between 1 and 60),
  policy text not null default '' check (length(policy) <= 8000),
  wip_limit integer check (wip_limit between 1 and 100000),
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  unique(project_id,id),
  check ((category='done') = (coalesce(status_value,category)='done')),
  check (coalesce(status_value,category) not in ('todo','doing') or category=coalesce(status_value,category))
);
create unique index project_stages_active_position on public.project_stages(project_id,position) where archived_at is null;
create unique index project_stages_active_status on public.project_stages(project_id,(coalesce(status_value,category))) where archived_at is null;
alter table public.tasks add column stage_id uuid,
  add column story_points integer check (story_points in (1,2,3,5,8,13,21)),
  add column planned_hours numeric check (planned_hours > 0 and planned_hours <= 2000 and planned_hours=round(planned_hours,2)),
  add column planning_version bigint not null default 1 check (planning_version > 0),
  add constraint tasks_stage_project_fk foreign key(project_id,stage_id) references public.project_stages(project_id,id);
create index tasks_stage_id_idx on public.tasks(stage_id) where stage_id is not null;

alter table public.project_planning enable row level security;
alter table public.project_roles enable row level security;
alter table public.project_stages enable row level security;
revoke all on public.project_planning,public.project_roles,public.project_stages from public,anon,authenticated;
grant select on public.project_planning,public.project_roles,public.project_stages to authenticated;
create policy planning_members_read on public.project_planning for select to authenticated using(public.is_project_member(project_id,auth.uid()));
create policy planning_roles_members_read on public.project_roles for select to authenticated using(public.is_project_member(project_id,auth.uid()));
create policy planning_stages_members_read on public.project_stages for select to authenticated using(public.is_project_member(project_id,auth.uid()));

create function public.planning_can_manage_internal(p_project uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and public.is_project_member(p_project,auth.uid()) and (
   exists(select 1 from public.listings where id=p_project and created_by=auth.uid()) or
   (exists(select 1 from public.project_planning where project_id=p_project and delegate_to_roles) and
    exists(select 1 from public.project_roles where project_id=p_project and user_id=auth.uid() and role in ('product_owner','scrum_master'))))
$$;
create function public.planning_lock_internal(p_project uuid,p_manage boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_completed timestamptz;
begin
 if auth.uid() is null or not public.is_project_member(p_project,auth.uid()) then
   raise exception using errcode='42501',message='Проект недоступен.';
 end if;
 select completed_at into v_completed from public.listings where id=p_project for update;
 if not found or not public.is_project_member(p_project,auth.uid()) then
   raise exception using errcode='42501',message='Проект недоступен.';
 end if;
 if v_completed is not null then raise exception using errcode='23514',message='Проект завершён: планирование зафиксировано.'; end if;
 if p_manage and not public.planning_can_manage_internal(p_project) then
   raise exception using errcode='42501',message='Нет прав управления планированием.';
 end if;
end $$;
create function public.planning_version_internal(p_project uuid,p_expected bigint) returns public.project_planning
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning;
begin
 insert into public.project_planning(project_id) values(p_project) on conflict do nothing;
 select * into v from public.project_planning where project_id=p_project for update;
 if p_expected is distinct from v.version then raise exception using errcode='PT409',message='Планирование изменилось. Обновите данные.'; end if;
 return v;
end $$;

-- Private trusted writer. Separate from the old allowlist; no client EXECUTE.
-- Only fixed kinds below can be emitted by the new server operations/triggers.
create function public.planning_event_internal(p_project uuid,p_kind text,p_entity uuid,p_data jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_title text;
begin
 if auth.uid() is not null and not public.is_project_member(p_project,auth.uid()) then
   raise exception using errcode='42501',message='Нет прав на историю проекта.';
 end if;
 v_title := case p_kind
 when 'planning_changed' then 'Изменены настройки планирования'
 when 'planning_role_changed' then 'Изменены роли планирования'
 when 'stage_changed' then 'Изменён этап проекта'
 when 'stage_archived' then 'Этап проекта архивирован'
 when 'task_stage_changed' then 'Изменён этап задачи'
 when 'task_estimate_changed' then 'Изменена оценка задачи'
 when 'backlog_reordered' then 'Изменён порядок бэклога'
 when 'sprint_created' then 'Создан спринт'
 when 'sprint_updated' then 'Изменён спринт'
 when 'sprint_started' then 'Спринт начат'
 when 'sprint_scope_changed' then 'Изменён состав спринта'
 when 'sprint_completed' then 'Спринт завершён'
 when 'sprint_cancelled' then 'Спринт отменён'
 else null end;
 if v_title is null then raise exception 'Unknown planning event'; end if;
 insert into public.project_activity(project_id,actor_id,type,title,entity_type,entity_id,metadata)
 values(p_project,auth.uid(),p_kind,v_title,'planning',p_entity,coalesce(p_data,'{}'));
end $$;

-- Existing direct DML owns the task/application tuple already. Do not WAIT for
-- the project in inverse order; abort with a retryable conflict instead.
create or replace function public.guard_completed_project_work() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project uuid; v_completed timestamptz;
begin
 if tg_table_name='tasks' then
   v_project := case when tg_op='DELETE' then old.project_id else new.project_id end;
 else
   v_project := case when tg_op='DELETE' then old.listing_id else new.listing_id end;
 end if;
 begin
   select completed_at into v_completed from public.listings where id=v_project for update nowait;
 exception when lock_not_available then
   raise exception using errcode='PT409',message='Проект изменяется другим запросом. Обновите данные и повторите.';
 end;
 -- Missing parent during the existing ON DELETE CASCADE is allowed.
 if found then
   if v_completed is not null then raise exception 'Проект завершён: состав команды и задачи зафиксированы'; end if;
   if tg_table_name='tasks' and auth.uid() is not null and not public.is_project_member(v_project,auth.uid()) then
     raise exception using errcode='42501',message='Нет прав на задачу.';
   end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

create function public.planning_guard_task_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_stage public.project_stages; v_mode text; v_wip text; v_changed boolean;
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.planning_version<>old.planning_version) then
   raise exception using errcode='23514',message='UUID и версия задачи управляются сервером.';
 end if;
 if tg_op='INSERT' and new.planning_version<>1 then raise exception using errcode='23514',message='Начальная версия задачи равна 1.'; end if;
 -- Explicit stage wins; old clients send only status. Clearing a stage must not
 -- let a canonical status evade the matching stage's strict WIP.
 if new.stage_id is not null and (tg_op='INSERT' or new.stage_id is distinct from old.stage_id) then
   select * into v_stage from public.project_stages where id=new.stage_id and project_id=new.project_id and archived_at is null;
   if not found then raise exception using errcode='23514',message='Этап недоступен или принадлежит другому проекту.'; end if;
   if tg_op='UPDATE' and new.status is distinct from old.status and new.status<>coalesce(v_stage.status_value,v_stage.category) then
     raise exception using errcode='23514',message='Этап и статус противоречат друг другу.';
   end if;
   new.status := coalesce(v_stage.status_value,v_stage.category);
 elsif tg_op='INSERT' or new.status is distinct from old.status or new.stage_id is distinct from old.stage_id then
   select id into new.stage_id from public.project_stages where project_id=new.project_id and archived_at is null and coalesce(status_value,category)=new.status;
 end if;
 if new.stage_id is not null then
   select * into v_stage from public.project_stages where id=new.stage_id and project_id=new.project_id and archived_at is null;
   if not found or new.status<>coalesce(v_stage.status_value,v_stage.category) then
     raise exception using errcode='23514',message='Этап и статус должны соответствовать друг другу.';
   end if;
   select mode,wip_mode into v_mode,v_wip from public.project_planning where project_id=new.project_id;
   v_changed := tg_op='INSERT' or new.stage_id is distinct from old.stage_id;
   if v_changed and v_mode<>'simple' and v_wip='strict' and v_stage.wip_limit is not null and new.status<>'done'
      and (select count(*) from public.tasks where stage_id=new.stage_id and id<>new.id and status<>'done') >= v_stage.wip_limit then
     raise exception using errcode='23514',message='Превышен строгий WIP-лимит этапа.';
   end if;
 end if;
 if new.status<>'done' then new.completed_at:=null;
 elsif tg_op='INSERT' or old.status<>'done' then new.completed_at:=statement_timestamp();
 elsif new.completed_at is distinct from old.completed_at then new.completed_at:=old.completed_at;
 end if;
 if tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then new.planning_version:=old.planning_version+1; end if;
 return new;
end $$;
create trigger planning_guard_task before insert or update on public.tasks for each row execute function public.planning_guard_task_internal();

create function public.planning_activity_task_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.stage_id is not null and tg_op='INSERT' or tg_op='UPDATE' and new.stage_id is distinct from old.stage_id then
   perform public.planning_event_internal(new.project_id,'task_stage_changed',new.id,
     jsonb_build_object('task_id',new.id,'old_stage_id',case when tg_op='UPDATE' then old.stage_id end,'new_stage_id',new.stage_id,'version',new.planning_version));
 end if;
 if tg_op='INSERT' and (new.story_points is not null or new.planned_hours is not null)
    or tg_op='UPDATE' and (new.story_points is distinct from old.story_points or new.planned_hours is distinct from old.planned_hours) then
   perform public.planning_event_internal(new.project_id,'task_estimate_changed',new.id,
     jsonb_build_object('task_id',new.id,'old_story_points',case when tg_op='UPDATE' then old.story_points end,
       'new_story_points',new.story_points,'old_planned_hours',case when tg_op='UPDATE' then old.planned_hours end,
       'new_planned_hours',new.planned_hours,'version',new.planning_version));
 end if;
 return new;
end $$;
create trigger planning_activity_task after insert or update on public.tasks for each row execute function public.planning_activity_task_internal();

create function public.update_project_planning(p_project_id uuid,p_expected_version bigint,p_mode text,
 p_goal text,p_definition_of_done text,p_wip_mode text,p_delegate_to_roles boolean) returns public.project_planning
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning; v_after public.project_planning; v_task record;
begin
 perform public.planning_lock_internal(p_project_id,true);
 v:=public.planning_version_internal(p_project_id,p_expected_version);
 if v.delegate_to_roles is distinct from p_delegate_to_roles and not exists(select 1 from public.listings where id=p_project_id and created_by=auth.uid()) then
   raise exception using errcode='42501',message='Делегирование меняет только автор проекта.';
 end if;
 if p_mode<>'simple' and p_wip_mode='strict' and exists(
   select 1 from public.project_stages s where s.project_id=p_project_id and s.archived_at is null and s.wip_limit is not null
    and (select count(*) from public.tasks t where t.stage_id=s.id and t.status<>'done')>s.wip_limit) then
   raise exception using errcode='23514',message='Сначала устраните превышения WIP.';
 end if;
 if (v.mode,v.goal,v.definition_of_done,v.wip_mode,v.delegate_to_roles) is not distinct from
    (p_mode,p_goal,p_definition_of_done,p_wip_mode,p_delegate_to_roles) then return v; end if;
 update public.project_planning set mode=p_mode,goal=p_goal,definition_of_done=p_definition_of_done,
   wip_mode=p_wip_mode,delegate_to_roles=p_delegate_to_roles,version=version+1 where project_id=p_project_id returning * into v_after;
 if p_mode<>'simple' and not exists(select 1 from public.project_stages where project_id=p_project_id) then
   insert into public.project_stages(project_id,name,position,category) values
    (p_project_id,'К выполнению',0,'todo'),(p_project_id,'В работе',1,'doing'),(p_project_id,'Готово',2,'done');
   for v_task in select id from public.tasks where project_id=p_project_id order by id for update loop
     update public.tasks t set stage_id=s.id from public.project_stages s
       where t.id=v_task.id and s.project_id=p_project_id and s.category=t.status;
   end loop;
 end if;
 perform public.planning_event_internal(p_project_id,'planning_changed',p_project_id,jsonb_build_object('old',to_jsonb(v),'new',to_jsonb(v_after)));
 return v_after;
end $$;

create function public.set_project_role(p_project_id uuid,p_expected_version bigint,p_user_id uuid,p_role text,p_assigned boolean)
returns public.project_planning language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning; v_exists boolean;
begin
 perform public.planning_lock_internal(p_project_id);
 if not exists(select 1 from public.listings where id=p_project_id and created_by=auth.uid()) then
   raise exception using errcode='42501',message='Роли назначает автор проекта.';
 end if;
 v:=public.planning_version_internal(p_project_id,p_expected_version);
 if p_role is null or p_role not in ('product_owner','scrum_master','developer') or p_assigned is null then raise exception using errcode='23514',message='Недопустимая роль.'; end if;
 if p_assigned and not public.is_project_member(p_project_id,p_user_id) then raise exception using errcode='23514',message='Роль требует действующего членства.'; end if;
 select exists(select 1 from public.project_roles where project_id=p_project_id and user_id=p_user_id and role=p_role) into v_exists;
 if v_exists=p_assigned then return v; end if;
 if p_assigned then insert into public.project_roles values(p_project_id,p_user_id,p_role);
 else delete from public.project_roles where project_id=p_project_id and user_id=p_user_id and role=p_role; end if;
 update public.project_planning set version=version+1 where project_id=p_project_id returning * into v;
 perform public.planning_event_internal(p_project_id,'planning_role_changed',p_user_id,jsonb_build_object('user_id',p_user_id,'role',p_role,'assigned',p_assigned));
 return v;
end $$;

create function public.planning_member_removed_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_roles jsonb;
begin
 if old.status='accepted' and (tg_op='DELETE' or new.status is distinct from 'accepted' or new.user_id<>old.user_id or new.listing_id<>old.listing_id) then
   select jsonb_agg(role order by role) into v_roles from public.project_roles where project_id=old.listing_id and user_id=old.user_id;
   if v_roles is not null then
     delete from public.project_roles where project_id=old.listing_id and user_id=old.user_id;
     update public.project_planning set version=version+1 where project_id=old.listing_id;
     if exists(select 1 from public.listings where id=old.listing_id) then
       perform public.planning_event_internal(old.listing_id,'planning_role_changed',old.user_id,
         jsonb_build_object('user_id',old.user_id,'removed_roles',v_roles,'reason','membership_removed'));
     end if;
   end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger planning_member_removed before update or delete on public.applications for each row execute function public.planning_member_removed_internal();

create function public.upsert_project_stage(p_project_id uuid,p_expected_planning_version bigint,p_stage_id uuid,p_expected_version bigint,
 p_name text,p_position integer,p_category text,p_status_value text,p_policy text,p_wip_limit integer) returns public.project_stages
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_stages; v_after public.project_stages; v_planning public.project_planning;
begin
 perform public.planning_lock_internal(p_project_id,true);
 v_planning:=public.planning_version_internal(p_project_id,p_expected_planning_version);
 if p_stage_id is null then
   if p_expected_version is distinct from 0::bigint then raise exception using errcode='PT409',message='Версия нового этапа должна быть 0.'; end if;
   insert into public.project_stages(project_id,name,position,category,status_value,policy,wip_limit)
    values(p_project_id,p_name,p_position,p_category,p_status_value,p_policy,p_wip_limit) returning * into v_after;
 else
   select * into v from public.project_stages where id=p_stage_id and project_id=p_project_id and archived_at is null for update;
   if not found then raise exception using errcode='23514',message='Этап недоступен.'; end if;
   if v.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Этап изменился.'; end if;
   if (v.category,v.status_value) is distinct from (p_category,p_status_value) and exists(select 1 from public.tasks where stage_id=v.id) then
     raise exception using errcode='23514',message='Создайте новый этап и явно перенесите задачи при архивировании старого.';
   end if;
   if v_planning.mode<>'simple' and v_planning.wip_mode='strict' and p_wip_limit is not null and
     (select count(*) from public.tasks where stage_id=v.id and status<>'done')>p_wip_limit then
     raise exception using errcode='23514',message='Лимит меньше текущего числа задач.';
   end if;
   if (v.name,v.position,v.category,v.status_value,v.policy,v.wip_limit) is not distinct from
      (p_name,p_position,p_category,p_status_value,p_policy,p_wip_limit) then return v; end if;
   update public.project_stages set name=p_name,position=p_position,category=p_category,status_value=p_status_value,policy=p_policy,wip_limit=p_wip_limit,
    version=version+1 where id=v.id returning * into v_after;
 end if;
 update public.project_planning set version=version+1 where project_id=p_project_id;
 perform public.planning_event_internal(p_project_id,'stage_changed',v_after.id,jsonb_build_object('old',to_jsonb(v),'new',to_jsonb(v_after)));
 return v_after;
end $$;

create function public.archive_project_stage(p_project_id uuid,p_expected_planning_version bigint,p_stage_id uuid,p_expected_version bigint,p_target_stage_id uuid)
returns public.project_stages language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_stages; v_task record;
begin
 perform public.planning_lock_internal(p_project_id,true);
 perform public.planning_version_internal(p_project_id,p_expected_planning_version);
 perform 1 from public.project_stages where project_id=p_project_id and id in (p_stage_id,p_target_stage_id) order by id for update;
 select * into v from public.project_stages where id=p_stage_id and project_id=p_project_id;
 if not found then raise exception using errcode='23514',message='Этап недоступен.'; end if;
 if v.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Этап изменился.'; end if;
 if v.archived_at is not null then return v; end if;
 if p_target_stage_id=p_stage_id or (p_target_stage_id is not null and not exists(select 1 from public.project_stages where id=p_target_stage_id and project_id=p_project_id and archived_at is null)) then
   raise exception using errcode='23514',message='Нужен другой активный этап того же проекта.';
 end if;
 if p_target_stage_id is null and exists(select 1 from public.tasks where stage_id=p_stage_id) then
   raise exception using errcode='23514',message='Укажите этап для существующих задач.';
 end if;
 for v_task in select id from public.tasks where stage_id=p_stage_id order by id for update loop
   update public.tasks set stage_id=p_target_stage_id where id=v_task.id;
 end loop;
 update public.project_stages set archived_at=statement_timestamp(),version=version+1 where id=v.id returning * into v;
 update public.project_planning set version=version+1 where project_id=p_project_id;
 perform public.planning_event_internal(p_project_id,'stage_archived',v.id,jsonb_build_object('target_stage_id',p_target_stage_id,'version',v.version));
 return v;
end $$;

create function public.edit_task_planning(p_task_id uuid,p_expected_version bigint,p_stage_id uuid,p_story_points integer,p_planned_hours numeric)
returns public.tasks language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.tasks; v_project uuid;
begin
 select project_id into v_project from public.tasks where id=p_task_id;
 perform public.planning_lock_internal(v_project);
 select * into v from public.tasks where id=p_task_id and project_id=v_project for update;
 if not found then raise exception using errcode='PT409',message='Задача удалена.'; end if;
 if v.planning_version is distinct from p_expected_version then raise exception using errcode='PT409',message='Задача изменилась. Обновите данные.'; end if;
 if (v.stage_id,v.story_points,v.planned_hours) is not distinct from (p_stage_id,p_story_points,p_planned_hours) then return v; end if;
 update public.tasks set stage_id=p_stage_id,story_points=p_story_points,planned_hours=p_planned_hours where id=v.id returning * into v;
 return v;
end $$;

-- Preserve the published signature and date semantics; only lock ordering changes.
create or replace function public.reschedule_task_secure(p_task_id uuid,p_expected_start_at timestamptz,p_expected_due_at timestamptz,
 p_new_start_at timestamptz,p_new_due_at timestamptz) returns public.tasks
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.tasks; v_project uuid;
begin
 select project_id into v_project from public.tasks where id=p_task_id;
 perform public.planning_lock_internal(v_project);
 select * into v from public.tasks where id=p_task_id and project_id=v_project for update;
 if not found then raise exception using errcode='PT409',message='Задача удалена.'; end if;
 if v.start_at is distinct from p_expected_start_at or v.due_at is distinct from p_expected_due_at then
   raise exception using errcode='PT409',message='Сроки задачи уже изменил другой участник. Обновите данные.';
 end if;
 if v.start_at is not distinct from p_new_start_at and v.due_at is not distinct from p_new_due_at then return v; end if;
 update public.tasks set start_at=p_new_start_at,due_at=p_new_due_at where id=p_task_id returning * into v;
 return v;
end $$;

-- Limit ACL changes to this feature's new functions and the existing private guard.
do $acl$
declare r record;
begin
 for r in select oid,proname,oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and
   proname in ('planning_can_manage_internal','planning_lock_internal','planning_version_internal','planning_event_internal',
    'planning_guard_task_internal','planning_activity_task_internal','planning_member_removed_internal',
    'update_project_planning','set_project_role','upsert_project_stage','archive_project_stage','edit_task_planning','guard_completed_project_work') loop
   if pg_get_userbyid((select proowner from pg_proc where oid=r.oid))<>'postgres' then raise exception 'ER-012: unexpected function owner %',r.signature; end if;
   execute format('revoke all on function %s from public,anon,authenticated',r.signature);
   if r.proname in ('update_project_planning','set_project_role','upsert_project_stage','archive_project_stage','edit_task_planning') then
     execute format('grant execute on function %s to authenticated',r.signature);
   elsif has_function_privilege('authenticated',r.oid,'EXECUTE') then raise exception 'ER-012: inherited internal EXECUTE %',r.signature;
   end if;
   if has_function_privilege('anon',r.oid,'EXECUTE') then raise exception 'ER-012: inherited anon EXECUTE %',r.signature; end if;
 end loop;
 if has_function_privilege('authenticated','public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)','EXECUTE') then
   raise exception 'ER-012: ER-SEC-001 required';
 end if;
end $acl$;
notify pgrst,'reload schema';
commit;
