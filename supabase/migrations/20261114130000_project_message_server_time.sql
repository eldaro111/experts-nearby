-- Server timestamps for future message writes only. No existing row/history is rewritten.
-- Old clients may still send edited_at; it is ignored in favour of the server clock.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'Chat timestamps: apply as postgres; owners must be preserved.';
  end if;
  if not exists (select 1 from pg_class where oid=to_regclass('public.project_messages')
    and relowner='postgres'::regrole and relrowsecurity) then
    raise exception 'Chat timestamps: expected postgres-owned project_messages with RLS enabled.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='project_message_server_time') then
    raise exception 'Chat timestamps: function name already exists; check applied migrations, do not overwrite.';
  end if;
  if not exists (select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.project_messages'::regclass
      and t.tgname='trg_phase8_guard_project_messages' and t.tgtype=23
      and t.tgenabled='O' and t.tgqual is null and t.tgnargs=0 and t.tgattr=''::int2vector
      and p.oid=to_regprocedure('public.phase8_guard_project_message_row()')
      and p.proowner='postgres'::regrole and p.prosecdef
      and p.proconfig=array['search_path=public, pg_temp'])
    or (select count(*) from pg_trigger where tgrelid='public.project_messages'::regclass
        and not tgisinternal and (tgtype & 2)=2) <> 1 then
    raise exception 'Chat timestamps: unexpected BEFORE triggers/guard; inspect metadata before applying.';
  end if;
end
$preflight$;

create function public.project_message_server_time()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op='INSERT' then
    new.created_at := clock_timestamp();
    new.edited_at := case when new.is_deleted_for_all then new.created_at else null end;
  else
    new.created_at := old.created_at;
    if new.body is distinct from old.body
       or new.is_deleted_for_all is distinct from old.is_deleted_for_all then
      new.edited_at := clock_timestamp();
    else
      new.edited_at := old.edited_at;
    end if;
  end if;
  return new;
end
$function$;

-- PostgreSQL runs same-kind triggers in name order: normalise timestamps first,
-- then the unchanged phase8 guard checks identity, replies and irreversible deletion.
create trigger trg_00_project_message_server_time
before insert or update on public.project_messages
for each row execute function public.project_message_server_time();

revoke execute on function public.project_message_server_time() from public, anon, authenticated;
do $acl$
begin
  if has_function_privilege('anon','public.project_message_server_time()','execute')
     or has_function_privilege('authenticated','public.project_message_server_time()','execute') then
    raise exception 'Chat timestamps: unexpected inherited EXECUTE on the internal trigger function; transaction rolled back.';
  end if;
end
$acl$;
commit;
