-- READ ONLY, metadata only. Run before/after the two chat migrations in the chosen project.
-- Does not read message text, profiles, JWTs, secrets or application data; does not invoke application RPC.
-- Publication membership + RLS do NOT prove end-to-end Realtime delivery.
begin transaction read only;
select current_database() as database_name, current_user as diagnostic_role,
       current_setting('server_version') as postgres_version;
select name, setting from pg_settings
where name in ('wal_level','max_replication_slots','max_wal_senders') order by name;

select pubname, pg_get_userbyid(pubowner) as owner, puballtables,
       pubinsert,pubupdate,pubdelete,pubtruncate
from pg_publication where pubname='supabase_realtime';
select pubname,schemaname,tablename,attnames,rowfilter
from pg_publication_tables where pubname='supabase_realtime'
order by schemaname,tablename;

select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity,c.relforcerowsecurity,
       c.relreplident,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('project_messages','project_message_hidden');
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename in ('project_messages','project_message_hidden')
order by tablename,policyname;
select r.rolname,r.rolsuper,r.rolbypassrls,r.rolinherit,c.relname,
       has_schema_privilege(r.oid,'public','USAGE') as public_usage,
       has_schema_privilege(r.oid,'auth','USAGE') as auth_usage,
       has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') as can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') as can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') as can_delete
from pg_roles r cross join pg_class c
where r.rolname in ('anon','authenticated','service_role','supabase_realtime_admin')
  and c.oid in (to_regclass('public.project_messages'),to_regclass('public.project_message_hidden'),
               to_regclass('public.listings'),to_regclass('public.applications'))
order by r.rolname,c.relname;
select r.rolname,a.attname,has_column_privilege(r.oid,a.attrelid,a.attnum,'SELECT') as can_select
from pg_roles r cross join pg_attribute a
where r.rolname in ('anon','authenticated') and a.attrelid=to_regclass('public.project_messages')
  and a.attnum>0 and not a.attisdropped order by r.rolname,a.attnum;

select t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
from pg_trigger t where t.tgrelid=to_regclass('public.project_messages') and not t.tgisinternal
order by t.tgname;
select p.oid::regprocedure as signature,pg_get_userbyid(p.proowner) as owner,
       p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('phase8_guard_project_message_row','project_message_server_time');
select r.rolname,p.oid::regprocedure as signature,has_function_privilege(r.oid,p.oid,'EXECUTE') as can_execute
from pg_roles r cross join pg_proc p join pg_namespace n on n.oid=p.pronamespace
where r.rolname in ('anon','authenticated','postgres','service_role')
  and ((n.nspname='public' and p.proname in ('project_message_server_time','append_project_activity_internal',
       'phase8_current_user_is_project_member')) or (n.nspname='auth' and p.proname='uid'))
order by signature,r.rolname;
commit;
