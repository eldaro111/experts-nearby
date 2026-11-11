-- ER-SEC-001: READ-ONLY METADATA. May be run before and after the migration.
-- SELECT only; does not call application functions or read application rows.
-- No pg_get_functiondef/prosrc output, secret settings, tokens or user data.
-- Local code expects five functions, each with one overload and owner postgres.

-- 1. Presence, all public overloads, owner, SECURITY DEFINER and search_path.
with expected(function_name, signature) as (values
  ('append_project_activity_internal', 'public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)'),
  ('trusted_activity_from_task', 'public.trusted_activity_from_task()'),
  ('trusted_activity_from_contribution', 'public.trusted_activity_from_contribution()'),
  ('trusted_activity_from_project_file', 'public.trusted_activity_from_project_file()'),
  ('trusted_activity_from_profile_review', 'public.trusted_activity_from_profile_review()')
)
select e.function_name, e.signature as expected_signature,
  pg_catalog.to_regprocedure(e.signature) is not null as expected_signature_exists,
  count(p.oid) over (partition by e.function_name) as overload_count,
  p.oid, n.nspname as schema_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer, p.prokind as routine_kind,
  p.prorettype::regtype::text as result_type, p.pronargdefaults as default_argument_count,
  (select setting from unnest(p.proconfig) as settings(setting)
   where setting like 'search_path=%' limit 1) as search_path,
  pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
from expected e
left join pg_catalog.pg_namespace n on n.nspname = 'public'
left join pg_catalog.pg_proc p on p.pronamespace = n.oid and p.proname = e.function_name
order by e.function_name, p.oid;

-- 2. Explicit/default ACL entries; an empty proacl means PostgreSQL defaults,
-- not absence of access. Grantors/grantees are database-role metadata only.
select p.oid::regprocedure::text as signature,
  pg_catalog.pg_get_userbyid(a.grantor) as grantor,
  case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as grantee,
  a.privilege_type, a.is_grantable
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
where n.nspname = 'public' and p.proname in (
  'append_project_activity_internal', 'trusted_activity_from_task',
  'trusted_activity_from_contribution', 'trusted_activity_from_project_file',
  'trusted_activity_from_profile_review')
order by signature, grantee, grantor;

-- 3. Effective EXECUTE for API roles and every role reachable by membership.
-- MEMBER is intentionally conservative: includes non-INHERIT membership paths.
with clients as (
  select oid, rolname, rolsuper, rolcreaterole from pg_catalog.pg_roles
  where rolname in ('anon', 'authenticated')
), reachable as (
  select c.rolname as client_role, c.rolsuper as client_superuser,
    c.rolcreaterole as client_can_create_roles, r.oid, r.rolname,
    pg_catalog.pg_has_role(c.oid, r.oid, 'USAGE') as immediately_inherited
  from clients c cross join pg_catalog.pg_roles r
  where r.oid = c.oid or pg_catalog.pg_has_role(c.oid, r.oid, 'MEMBER')
)
select r.client_role, r.client_superuser, r.client_can_create_roles,
  r.rolname as reachable_role, r.immediately_inherited,
  p.oid::regprocedure::text as signature,
  pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE') as effective_execute
from reachable r cross join pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'append_project_activity_internal', 'trusted_activity_from_task',
  'trusted_activity_from_contribution', 'trusted_activity_from_project_file',
  'trusted_activity_from_profile_review')
order by r.client_role, r.rolname, signature;

-- 4. Every existing attachment to these functions, including unexpected tables.
select p.oid::regprocedure::text as signature, tn.nspname as table_schema,
  c.relname as table_name, pg_catalog.pg_get_userbyid(c.relowner) as table_owner,
  t.tgname as trigger_name, t.tgenabled, t.tgisinternal, t.tgtype as trigger_type_bits
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
left join pg_catalog.pg_trigger t on t.tgfoid = p.oid
left join pg_catalog.pg_class c on c.oid = t.tgrelid
left join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace
where n.nspname = 'public' and p.proname in (
  'append_project_activity_internal', 'trusted_activity_from_task',
  'trusted_activity_from_contribution', 'trusted_activity_from_project_file',
  'trusted_activity_from_profile_review')
order by signature, table_schema, table_name, trigger_name;

-- 5. History table rights and public-schema CREATE, without reading history.
select r.rolname, c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT') as can_select,
  pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT') as can_insert,
  pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE') as can_update,
  pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE') as can_delete,
  pg_catalog.has_table_privilege(r.oid, c.oid, 'TRUNCATE') as can_truncate,
  pg_catalog.has_table_privilege(r.oid, c.oid, 'TRIGGER') as can_create_history_trigger,
  pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') as can_create_in_public
from pg_catalog.pg_roles r
left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass('public.project_activity')
where r.rolname in ('anon', 'authenticated')
order by r.rolname;
