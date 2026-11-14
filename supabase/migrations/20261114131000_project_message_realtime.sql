-- Add only the chat table; no grants, policies, replica identity or existing publication entries change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $publication$
begin
  if not exists (select 1 from pg_class where oid=to_regclass('public.project_messages')
    and relowner='postgres'::regrole and relrowsecurity) then
    raise exception 'Chat Realtime: expected postgres-owned project_messages with RLS enabled.';
  end if;
  if not exists (select 1 from pg_publication where pubname='supabase_realtime'
      and not puballtables and pubinsert and pubupdate) then
    raise exception 'Chat Realtime: expected explicit supabase_realtime publication with INSERT/UPDATE; inspect configuration, do not broaden it automatically.';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='project_messages') then
    alter publication supabase_realtime add table public.project_messages;
  end if;
end
$publication$;
commit;
