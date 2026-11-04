-- Additive migration. Existing objects remain raw; no data is deleted or rewritten.
begin;

alter table public.project_files
  add column if not exists storage_format text not null default 'raw',
  add column if not exists pack_kind text,
  add column if not exists original_size bigint,
  add column if not exists file_count integer not null default 1,
  add column if not exists storage_sha256 text;

alter table public.project_file_upload_reservations
  add column if not exists storage_format text not null default 'raw',
  add column if not exists pack_kind text,
  add column if not exists original_size bigint,
  add column if not exists file_count integer not null default 1,
  add column if not exists storage_sha256 text;

create or replace function public.guard_project_file_storage_metadata()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (
    new.storage_format is distinct from old.storage_format or
    new.pack_kind is distinct from old.pack_kind or
    new.original_size is distinct from old.original_size or
    new.file_count is distinct from old.file_count or
    new.storage_sha256 is distinct from old.storage_sha256 or
    (old.storage_format = 'nearby-pack-v1' and new.file_size is distinct from old.file_size)
  ) then
    raise exception 'Формат и контрольную сумму сохранённого файла нельзя изменять.';
  end if;
  if new.storage_format = 'nearby-pack-v1' then
    if new.pack_kind is null or new.pack_kind not in ('single','folder') or
      new.original_size is null or new.original_size < 0 or new.original_size > 524288000 or
      new.file_size is null or new.file_size <= 0 or new.file_size > 524288000 or
      new.file_count is null or new.file_count < 1 or new.file_count > 2000 or
      (new.pack_kind = 'single' and (new.file_count <> 1 or new.original_size = 0)) or
      new.storage_sha256 is null or new.storage_sha256 !~ '^[a-f0-9]{64}$' then
      raise exception 'Некорректные сведения о сжатом файле.';
    end if;
  elsif new.storage_format <> 'raw' or new.pack_kind is not null or new.file_count <> 1 or
    new.original_size is not null or new.storage_sha256 is not null then
    raise exception 'Некорректные сведения об обычном файле.';
  end if;
  return new;
end $$;

drop trigger if exists trg_project_file_storage_metadata on public.project_files;
create trigger trg_project_file_storage_metadata before insert or update on public.project_files
for each row execute function public.guard_project_file_storage_metadata();

create or replace function public.project_file_storage_version()
returns integer language sql stable set search_path = public, pg_temp as $$ select 1 $$;
revoke all on function public.project_file_storage_version() from public, anon;
grant execute on function public.project_file_storage_version() to authenticated;

-- Keep the existing reservation checks; normalize only NEW object keys.
create or replace function public.reserve_project_file_upload_secure (
  p_expected_user_id uuid,
  p_project_id       uuid,
  p_file_name        text,
  p_file_size        bigint,
  p_mime_type        text   default null::text,
  p_category         text   default 'other'::text,
  p_description      text   default null::text,
  p_version_label    text   default null::text,
  p_task_id          uuid   default null::uuid
)
  returns table (
    reservation_id uuid,
    file_path      text
  )
  language plpgsql
  security definer
  set search_path to 'public', 'storage', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_safe_file_name text;
  v_file_path text;
  v_reservation_id uuid;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'Для загрузки файла требуется авторизация.';
  end if;

  if p_expected_user_id is null
     or p_expected_user_id is distinct from v_user_id then
    raise exception 'user_id не совпадает с текущим пользователем.';
  end if;

  if not public.project_file_is_member(p_project_id, v_user_id) then
    raise exception 'Нет доступа к загрузке файлов в этот проект.';
  end if;

  if p_file_size is null
     or p_file_size <= 0
     or p_file_size > 524288000 then
    raise exception 'Размер файла должен быть от 1 байта до 500 МиБ.';
  end if;

  if p_file_name is null or btrim(p_file_name) = '' then
    raise exception 'Имя файла обязательно.';
  end if;

  if char_length(p_file_name) > 255 then
    raise exception 'Имя файла слишком длинное.';
  end if;

  if p_mime_type is not null and char_length(p_mime_type) > 255 then
    raise exception 'MIME-тип слишком длинный.';
  end if;

  if p_category not in (
    'document',
    'drawing',
    'cad',
    'code',
    'image',
    'archive',
    'report',
    'presentation',
    'other'
  ) then
    raise exception 'Недопустимая категория файла.';
  end if;

  if p_description is not null and char_length(p_description) > 4000 then
    raise exception 'Описание файла слишком длинное.';
  end if;

  if p_version_label is not null and char_length(p_version_label) > 80 then
    raise exception 'Метка версии слишком длинная.';
  end if;

  if p_task_id is not null
     and not exists (
       select 1
       from public.tasks t
       where t.id = p_task_id
         and t.project_id = p_project_id
     ) then
    raise exception 'Выбранная задача относится к другому проекту.';
  end if;

  -- Удаляем только истёкшие резервации, для которых объект так и не появился.
  delete from public.project_file_upload_reservations r
  where r.user_id = v_user_id
    and r.expires_at < now()
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'project-files'
        and o.name = r.file_path
    );

  select count(*)
    into v_active_count
  from public.project_file_upload_reservations r
  where r.user_id = v_user_id
    and r.expires_at > now();

  if v_active_count >= 20 then
    raise exception
      'Слишком много незавершённых загрузок. Завершите или отмените предыдущие.';
  end if;

  v_safe_file_name := regexp_replace(
    btrim(p_file_name),
    E'[/\\\\?%*:|"<>]+',
    '_',
    'g'
  );
  v_safe_file_name := regexp_replace(
    v_safe_file_name,
    '[[:cntrl:]]+',
    '_',
    'g'
  );
  v_safe_file_name := regexp_replace(
    v_safe_file_name,
    '^[. ]+',
    '',
    'g'
  );
  v_safe_file_name := left(v_safe_file_name, 180);

  if btrim(v_safe_file_name) = '' then
    v_safe_file_name := 'file';
  end if;

  -- Storage object keys use ASCII; file_name keeps the user's original Unicode name.
  v_safe_file_name := regexp_replace(v_safe_file_name, '[^A-Za-z0-9._-]', '_', 'g');

  v_file_path :=
    p_project_id::text
    || '/'
    || gen_random_uuid()::text
    || '-'
    || v_safe_file_name;

  insert into public.project_file_upload_reservations (
    project_id,
    user_id,
    file_path,
    file_name,
    file_size,
    mime_type,
    category,
    description,
    version_label,
    task_id
  )
  values (
    p_project_id,
    v_user_id,
    v_file_path,
    p_file_name,
    p_file_size,
    nullif(btrim(coalesce(p_mime_type, '')), ''),
    p_category,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_version_label, '')), ''),
    p_task_id
  )
  returning id into v_reservation_id;

  return query
  select v_reservation_id, v_file_path;
end
$function$;

create or replace function public.reserve_project_file_pack_secure(
  p_expected_user_id uuid, p_project_id uuid, p_file_name text, p_file_size bigint,
  p_original_size bigint, p_file_count integer, p_pack_kind text, p_storage_sha256 text,
  p_mime_type text default null, p_category text default 'other', p_description text default null,
  p_version_label text default null, p_task_id uuid default null
)
returns table(reservation_id uuid, file_path text)
language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare v_reservation record;
begin
  if public.project_file_storage_version() <> 1 then
    raise exception 'Загрузка сборок временно отключена. Загрузите обычный файл без сжатия.';
  end if;
  if p_original_size is null or p_original_size < 0 or p_original_size > 524288000 or
    p_file_count is null or p_file_count < 1 or p_file_count > 2000 or
    p_pack_kind is null or p_pack_kind not in ('single','folder') or
    (p_pack_kind = 'single' and (p_file_count <> 1 or p_original_size = 0)) or
    p_storage_sha256 is null or p_storage_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Некорректные сведения о сжатом файле.';
  end if;
  -- Reuse all established identity, membership, task, size, filename and reservation-limit checks.
  select r.* into v_reservation from public.reserve_project_file_upload_secure(
    p_expected_user_id, p_project_id, p_file_name, p_file_size, p_mime_type,
    p_category, p_description, p_version_label, p_task_id
  ) r;
  update public.project_file_upload_reservations r
    set storage_format = 'nearby-pack-v1', pack_kind = p_pack_kind,
      original_size = p_original_size, file_count = p_file_count, storage_sha256 = p_storage_sha256
    where r.id = v_reservation.reservation_id;
  return query select v_reservation.reservation_id::uuid, v_reservation.file_path::text;
end $$;
revoke all on function public.reserve_project_file_pack_secure(uuid,uuid,text,bigint,bigint,integer,text,text,text,text,text,text,uuid) from public, anon;
grant execute on function public.reserve_project_file_pack_secure(uuid,uuid,text,bigint,bigint,integer,text,text,text,text,text,text,uuid) to authenticated;

create or replace function public.finalize_project_file_upload_secure (
  p_expected_user_id uuid,
  p_reservation_id   uuid
)
  returns table (
    project_file_id uuid
  )
  language plpgsql
  security definer
  set search_path to 'public', 'storage', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.project_file_upload_reservations%rowtype;
  v_existing_id uuid;
  v_project_file_id uuid;
begin
  if v_user_id is null then
    raise exception 'Для завершения загрузки требуется авторизация.';
  end if;

  if p_expected_user_id is null
     or p_expected_user_id is distinct from v_user_id then
    raise exception 'user_id не совпадает с текущим пользователем.';
  end if;

  -- Идемпотентность при повторном вызове после сетевой ошибки.
  select pf.id
    into v_existing_id
  from public.project_files pf
  where pf.upload_reservation_id = p_reservation_id
    and pf.uploaded_by = v_user_id;

  if found then
    return query select v_existing_id;
    return;
  end if;

  select r.*
    into v_reservation
  from public.project_file_upload_reservations r
  where r.id = p_reservation_id
    and r.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Резервация загрузки не найдена.';
  end if;

  if not public.project_file_is_member(
    v_reservation.project_id,
    v_user_id
  ) then
    raise exception 'Доступ к проекту был отозван.';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'project-files'
      and o.name = v_reservation.file_path
      and o.owner_id = v_user_id::text
  ) then
    raise exception
      'Объект не найден в Storage или принадлежит другому пользователю.';
  end if;

  if v_reservation.storage_format = 'nearby-pack-v1' and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-files' and o.name = v_reservation.file_path
      and case when o.metadata->>'size' ~ '^[0-9]{1,12}$'
        then (o.metadata->>'size')::bigint = v_reservation.file_size else false end
  ) then
    raise exception 'Размер объекта в Storage не совпадает с резервацией.';
  end if;

  insert into public.project_files (
    project_id,
    uploaded_by,
    file_name,
    file_path,
    file_size,
    mime_type,
    category,
    description,
    version_label,
    task_id,
    upload_reservation_id,
    storage_format, pack_kind, original_size, file_count, storage_sha256
  )
  values (
    v_reservation.project_id,
    v_user_id,
    v_reservation.file_name,
    v_reservation.file_path,
    v_reservation.file_size,
    v_reservation.mime_type,
    v_reservation.category,
    v_reservation.description,
    v_reservation.version_label,
    v_reservation.task_id,
    v_reservation.id,
    v_reservation.storage_format, v_reservation.pack_kind, v_reservation.original_size,
    v_reservation.file_count, v_reservation.storage_sha256
  )
  returning id into v_project_file_id;

  delete from public.project_file_upload_reservations
  where id = v_reservation.id;

  return query
  select v_project_file_id;
end
$function$;


notify pgrst, 'reload schema';
commit;
