-- ER-SEC-001: restrict only the reviewed activity-writing function family.
-- Run as the trusted migration administrator, after the existing migrations.
-- No function replacement, ownership/role-membership changes or history writes.
-- Any unexpected metadata or remaining inherited EXECUTE aborts this transaction.
begin;

do $preflight$
declare
  item record;
  fn record;
  function_oid oid;
  overload_count integer;
begin
  if (select count(*) from pg_catalog.pg_roles
      where rolname in ('postgres', 'anon', 'authenticated', 'service_role')) <> 4 then
    raise exception 'ER-SEC-001: expected Supabase roles are missing; inspect metadata before applying';
  end if;

  for item in
    select * from (values
      ('append_project_activity_internal',
       'public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)',
       'uuid', null::text, null::text, null::integer),
      ('trusted_activity_from_task', 'public.trusted_activity_from_task()',
       'trigger', 'tasks', 'trg_trusted_activity_tasks', 29),
      ('trusted_activity_from_contribution', 'public.trusted_activity_from_contribution()',
       'trigger', 'contributions', 'trg_trusted_activity_contributions', 21),
      ('trusted_activity_from_project_file', 'public.trusted_activity_from_project_file()',
       'trigger', 'project_files', 'trg_trusted_activity_project_files', 13),
      ('trusted_activity_from_profile_review', 'public.trusted_activity_from_profile_review()',
       'trigger', 'profile_reviews', 'trg_trusted_activity_profile_reviews', 21)
    ) as expected(function_name, signature, result_type, table_name, trigger_name, trigger_type)
  loop
    function_oid := pg_catalog.to_regprocedure(item.signature);
    select count(*) into overload_count
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = item.function_name;
    if function_oid is null or overload_count <> 1 then
      raise exception 'ER-SEC-001: unexpected signature/overload for %; inspect diagnostics', item.function_name;
    end if;

    select p.proowner, p.prosecdef, p.prokind, p.prorettype, p.proconfig into fn
      from pg_catalog.pg_proc p where p.oid = function_oid;
    if fn.proowner <> 'postgres'::regrole then
      raise exception 'ER-SEC-001: unexpected owner for % (expected postgres); ownership was not changed', item.signature;
    end if;
    if fn.prokind <> 'f' or not fn.prosecdef
       or fn.prorettype <> pg_catalog.to_regtype(item.result_type)
       or not coalesce(fn.proconfig @> array['search_path=public, pg_temp'], false) then
      raise exception 'ER-SEC-001: unexpected function attributes/search_path for %', item.signature;
    end if;
    if exists (
      select 1 from pg_catalog.pg_roles r
      where r.rolname in ('anon', 'authenticated')
        and (r.rolsuper or r.rolcreaterole
             or pg_catalog.pg_has_role(r.oid, fn.proowner, 'MEMBER'))
    ) then
      raise exception 'ER-SEC-001: client role can reach trusted ownership or administer roles; role configuration must be reviewed separately';
    end if;

    if item.trigger_name is not null then
      -- Revoking EXECUTE does not detach already-created triggers. Refuse unknown
      -- attachments rather than silently retaining an unreviewed entry point.
      if (select count(*) from pg_catalog.pg_trigger t where t.tgfoid = function_oid) <> 1
         or not exists (
           select 1 from pg_catalog.pg_trigger t
           where t.tgfoid = function_oid
             and t.tgrelid = pg_catalog.to_regclass('public.' || item.table_name)
             and t.tgname = item.trigger_name and not t.tgisinternal
             and t.tgtype = item.trigger_type and t.tgenabled in ('O', 'A')
         ) then
        raise exception 'ER-SEC-001: unexpected trigger attachment/state for %; inspect diagnostics', item.signature;
      end if;
    end if;
  end loop;
end
$preflight$;

revoke execute on function public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)
  from public, anon, authenticated;
revoke execute on function public.trusted_activity_from_task()
  from public, anon, authenticated;
revoke execute on function public.trusted_activity_from_contribution()
  from public, anon, authenticated;
revoke execute on function public.trusted_activity_from_project_file()
  from public, anon, authenticated;
revoke execute on function public.trusted_activity_from_profile_review()
  from public, anon, authenticated;

do $verify$
declare
  signature text;
  function_oid oid;
  inherited_role text;
begin
  foreach signature in array array[
    'public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)',
    'public.trusted_activity_from_task()',
    'public.trusted_activity_from_contribution()',
    'public.trusted_activity_from_project_file()',
    'public.trusted_activity_from_profile_review()'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature);
    if pg_catalog.has_function_privilege('public', function_oid, 'EXECUTE') then
      raise exception 'ER-SEC-001: PUBLIC still has EXECUTE on %; transaction aborted', signature;
    end if;

    -- MEMBER covers transitive membership even when immediate INHERIT is disabled.
    -- Do not revoke parent-role grants or alter memberships automatically.
    select r.rolname into inherited_role
      from pg_catalog.pg_roles r
      where (r.rolname in ('anon', 'authenticated')
             or pg_catalog.pg_has_role('anon', r.oid, 'MEMBER')
             or pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
        and pg_catalog.has_function_privilege(r.oid, function_oid, 'EXECUTE')
      order by r.rolname limit 1;
    if found then
      raise exception 'ER-SEC-001: effective/inherited EXECUTE remains on % via role %; review grants separately; transaction aborted',
        signature, inherited_role;
    end if;
  end loop;
end
$verify$;

commit;
