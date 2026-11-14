-- Read-only metadata and aggregate counts. No task/user text, UUIDs, secrets,
-- suspicious function execution or changes. Run by the owner, not automatically.
-- Before the FIRST two ER-012 migrations use ER-012-planning.sql first.
-- This file requires their tables; missing tables = stop and check migration order.
begin transaction read only;
set local statement_timeout='15s';
select version() as postgres_version,
       to_regclass('public.project_planning') as planning,
       to_regclass('public.project_sprints') as sprints,
       to_regclass('public.project_planning_requests') as receipts;

select p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,
 p.prosecdef as security_definer,p.proconfig,
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('postgres',p.oid,'EXECUTE') as postgres_execute
from pg_proc p where p.pronamespace='public'::regnamespace and
 (p.proname in ('update_project_planning','reorder_project_stages','replace_project_lead',
 'create_project_sprint','close_project_sprint','create_project_sprint_once','close_project_sprint_once',
 'get_project_planning_request','append_project_activity_internal')
 or p.proname like 'planning_%_internal')
order by signature;

select c.relname,t.tgname,t.tgenabled,p.oid::regprocedure::text as function_signature
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
where not t.tgisinternal and c.relnamespace='public'::regnamespace
 and c.relname in ('tasks','project_stages','project_sprints','project_activity')
order by c.relname,t.tgname;

select c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity as rls,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_any_dml,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_any_dml
from pg_class c where c.relnamespace='public'::regnamespace and c.relname='project_planning_requests';

-- All values below are aggregate counts, not rows of user data. Nonzero incompatible
-- counts require investigation; this diagnostic does not repair anything.
select count(*) filter(where t.stage_id is not null and s.id is null) as missing_stage,
 count(*) filter(where s.id is not null and t.project_id<>s.project_id) as cross_project_stage,
 count(*) filter(where s.archived_at is not null) as assigned_archived_stage,
 count(*) filter(where s.id is not null and t.status is distinct from coalesce(s.status_value,s.category)) as stage_status_mismatch,
 count(*) filter(where (t.status='done') is distinct from (t.completed_at is not null)) as completion_mismatch,
 count(*) filter(where t.stage_id is null) as legacy_unassigned_tasks
from public.tasks t left join public.project_stages s on s.id=t.stage_id;

select count(*) as stages_needing_position_review from public.project_stages
where archived_at is null and position>2147478646;
select count(*) as strict_stages_over_limit
from public.project_stages s join public.project_planning p on p.project_id=s.project_id
where s.archived_at is null and s.wip_limit is not null and p.mode<>'simple' and p.wip_mode='strict'
 and (select count(*) from public.tasks t where t.stage_id=s.id and t.status<>'done')>s.wip_limit;
commit;
