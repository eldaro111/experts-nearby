-- Additive migration: existing projects, applications and RLS remain intact.
begin;
alter table public.listings
  add column project_kind text not null default 'project',
  add column startup_stage text,
  add column participation_terms text;
alter table public.listings add constraint listings_startup_fields_check check (
  (project_kind = 'project' and startup_stage is null and participation_terms is null)
  or (project_kind = 'startup' and startup_stage is not null and participation_terms is not null
      and startup_stage in ('idea','prototype','pilot','sales')
      and participation_terms in ('paid','educational','volunteer','equity'))
);
create index listings_startup_catalog_idx on public.listings (created_at desc)
  where project_kind = 'startup' and completed_at is null;
-- Security invoker preserves listings RLS for anonymous users and members alike.
create function public.search_startups(
  p_query text default '', p_stage text default null, p_terms text default null,
  p_university uuid default null, p_school uuid default null, p_group uuid default null,
  p_offset integer default 0
) returns setof public.listings language sql stable security invoker
set search_path = public
as $$
  select l.* from public.listings l
  where l.project_kind = 'startup' and l.visibility = 'public' and l.completed_at is null
    and (p_stage is null or l.startup_stage = p_stage)
    and (p_terms is null or l.participation_terms = p_terms)
    and (p_university is null or l.university_id = p_university)
    and (p_school is null or l.school_id = p_school)
    and (p_group is null or l.study_group_id = p_group)
    and (coalesce(trim(p_query),'') = '' or strpos(lower(concat_ws(' ', l.title, l.description,
        array_to_string(l.roles_needed, ' '), array_to_string(l.skills, ' '))), lower(trim(p_query))) > 0)
  order by l.created_at desc, l.id asc
  limit 25 offset greatest(0, least(coalesce(p_offset,0), 1000000));
$$;
revoke all on function public.search_startups(text,text,text,uuid,uuid,uuid,integer) from public;
grant execute on function public.search_startups(text,text,text,uuid,uuid,uuid,integer) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
