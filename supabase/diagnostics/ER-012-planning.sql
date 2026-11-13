-- Read-only aggregate/metadata preflight. No data repairs or internal function calls.
begin read only;
select count(*) as tasks_total,
 count(*) filter(where status='done' and completed_at is null) as legacy_done_time_unknown,
 count(*) filter(where status<>'done' and completed_at is not null) as legacy_non_done_with_timestamp,
 count(*) filter(where start_at is not null and due_at < start_at) as incompatible_date_order
from public.tasks;
select p.proname,p.oid::regprocedure as signature,pg_get_userbyid(p.proowner) as owner,
 p.prosecdef,p.proconfig,md5(replace(p.prosrc,chr(13),'')) as body_hash,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
 ('guard_completed_project_work','reschedule_task_secure','append_project_activity_internal',
  'planning_event_internal','planning_guard_task_internal','update_project_planning','edit_task_planning')
order by p.proname,p.oid;
select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where t.tgrelid in ('public.tasks'::regclass,'public.applications'::regclass,'public.listings'::regclass) and not t.tgisinternal
order by c.relname,t.tgname;
select to_regclass('public.project_planning') as planning_table,
 to_regclass('public.project_sprints') as sprint_table;
commit;
