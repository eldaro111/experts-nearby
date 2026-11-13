-- Read-only aggregates and schema metadata. Run before AND after the new migrations.
-- No user titles, IDs, files, tokens or function calls that mutate data.
begin read only;
select count(*) as total_tasks,
  count(*) filter (where start_at is null and due_at is null) as no_dates,
  count(*) filter (where (start_at is null) <> (due_at is null)) as one_date,
  count(*) filter (where due_at < start_at) as incompatible_date_order
from public.tasks;

select p.oid::regprocedure::text as signature, pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer, p.proconfig as settings,
  md5(replace(p.prosrc,chr(13),'')) as definition_hash,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
         where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'reschedule_task_secure','phase8_guard_task_row','append_project_activity_internal',
  'trusted_activity_from_task','trusted_activity_from_contribution',
  'trusted_activity_from_project_file','trusted_activity_from_profile_review',
  'accept_auction_bid_secure','decide_auction_access_secure','guard_auction_bid_update',
  'guard_auction_status_transition','request_auction_access_secure','review_auction_bid_secure',
  'save_auction_bid_secure','transition_auction_status_secure','withdraw_auction_bid_secure')
order by p.proname,signature;

select conname,convalidated,pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid='public.tasks'::regclass and conname='tasks_schedule_order_check';
select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid='public.tasks'::regclass and not tgisinternal order by tgname;
rollback;
