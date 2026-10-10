-- Event-driven, explainable recommendations. Run after the pilot migration.
begin;

-- Private working data. Never inherit broad Supabase default table privileges.
create table public.recommendation_pairs (
  project_id uuid not null references public.listings(id) on delete cascade,
  expert_id uuid not null references public.profiles(user_id) on delete cascade,
  expert_dismissed boolean not null default false,
  owner_dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, expert_id)
);
create index recommendation_pairs_expert on public.recommendation_pairs(expert_id);
create table public.recommendation_deliveries (
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  -- Deliberately retain these identifiers after project deletion: deleting a project
  -- or an inbox notification must not reset deduplication or a recipient's quota.
  project_id uuid not null, expert_id uuid not null,
  kind text not null check(kind in ('projects','experts')),
  created_at timestamptz not null default now(),
  primary key(recipient_id,project_id,expert_id,kind)
);
create index recommendation_delivery_quota on public.recommendation_deliveries(recipient_id,created_at desc);
create table public.recommendation_refreshes (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  refreshed_at timestamptz not null default now()
);
alter table public.recommendation_pairs enable row level security;
alter table public.recommendation_deliveries enable row level security;
alter table public.recommendation_refreshes enable row level security;
revoke all on public.recommendation_pairs,public.recommendation_deliveries,public.recommendation_refreshes from public,anon,authenticated;
grant all on public.recommendation_pairs,public.recommendation_deliveries,public.recommendation_refreshes to service_role;

-- Exact, case-insensitive tags; punctuation in C++, C# and .NET is meaningful.
create function public.recommendation_tags(p_tags text[]) returns text[]
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(array_agg(distinct tag order by tag),'{}'::text[])
  from (select replace(lower(btrim(regexp_replace(value,'\s+',' ','g'))),'ё','е') as tag
        from unnest(coalesce(p_tags,'{}'::text[])) with ordinality t(value,n) where n<=100) q
  where length(tag) between 1 and 100;
$$;
create function public.recommendation_fit(p_skills text[],p_roles text[],l_skills text[],l_roles text[],same_university boolean)
returns table(score integer,matched_skills text[],matched_roles text[],university_match boolean)
language sql immutable set search_path=public,pg_temp as $$
  with tags as (
    select public.recommendation_tags(l_skills) required_skills,
      array(select unnest(public.recommendation_tags(p_skills)) intersect select unnest(public.recommendation_tags(l_skills)) order by 1) skills,
      array(select unnest(public.recommendation_tags(p_roles)) intersect select unnest(public.recommendation_tags(l_roles)) order by 1) roles
  )
  select case when cardinality(skills)=0 and cardinality(roles)=0 then 0
    else coalesce(round(70.0*cardinality(skills)/nullif(cardinality(required_skills),0))::integer,0)
      +case when cardinality(roles)>0 then 25 else 0 end
      +case when coalesce(same_university,false) then 5 else 0 end end,
    skills,roles,coalesce(same_university,false) from tags;
$$;

-- This view is internal only. All client access is via caller-scoped RPCs below.
create view public.recommendation_live with(security_barrier=true,security_invoker=false) as
select l.id project_id,p.user_id expert_id,l.created_by owner_id,l.title project_title,
  left(l.description,320) project_description,l.created_at project_created_at,
  p.display_name expert_name,p.expert_code,
  case when p.show_rate then p.price_from else null end price_from,
  case when p.show_rate then p.price_unit else 'negotiable' end price_unit,
  fit.score,fit.matched_skills,fit.matched_roles,fit.university_match
from public.listings l cross join public.profiles p
cross join lateral public.recommendation_fit(p.skills,p.roles,l.skills,l.roles_needed,
  p.university_id is not null and p.university_id=l.university_id) fit
where l.visibility='public' and l.completed_at is null
  and (l.deadline_at is null or l.deadline_at>now())
  and l.created_by is not null and l.created_by<>p.user_id
  and p.visibility in ('public','platform_only') and length(btrim(p.display_name))>=2
  and (p.availability_hours is null or p.availability_hours>0)
  and fit.score>=25
  and not exists(select 1 from public.applications a where a.listing_id=l.id and a.user_id=p.user_id);
revoke all on public.recommendation_live from public,anon,authenticated;
grant select on public.recommendation_live to service_role;

create function public.rebuild_recommendations_internal(p_project uuid default null,p_expert uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_project is null and p_expert is null then raise exception 'A recommendation source is required'; end if;
  insert into public.recommendation_pairs(project_id,expert_id)
    select project_id,expert_id from public.recommendation_live
    where (p_project is null or project_id=p_project) and (p_expert is null or expert_id=p_expert)
    order by score desc,project_created_at desc,project_id,expert_id limit 50
  on conflict(project_id,expert_id) do nothing;
end $$;

create function public.deliver_recommendations_internal(p_recipient uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; delivered integer:=0; remaining integer; prefs jsonb; delivery_count integer;
begin
  -- Busy recipients are retried on a later source update or when opening the site.
  -- Try-lock avoids lock-order deadlocks between simultaneous project/profile saves.
  if not pg_try_advisory_xact_lock(hashtextextended(p_recipient::text||':recommendations',0)) then return 0; end if;
  select 3-count(*)::integer into remaining from public.recommendation_deliveries
    where recipient_id=p_recipient and created_at>now()-interval '24 hours';
  if remaining<=0 then return 0; end if;
  select notification_prefs into prefs from public.user_settings where user_id=p_recipient;
  for candidate in
    select live.*,case when live.expert_id=p_recipient then 'projects' else 'experts' end kind
    from public.recommendation_pairs pair join public.recommendation_live live using(project_id,expert_id)
    where ((live.expert_id=p_recipient and not pair.expert_dismissed
        and coalesce(prefs->'recommend_projects','true'::jsonb)='true'::jsonb)
      or (live.owner_id=p_recipient and not pair.owner_dismissed
        and coalesce(prefs->'recommend_experts','true'::jsonb)='true'::jsonb))
      and not exists(select 1 from public.recommendation_deliveries d where d.recipient_id=p_recipient
        and d.project_id=pair.project_id and d.expert_id=pair.expert_id
        and d.kind=case when live.expert_id=p_recipient then 'projects' else 'experts' end)
    order by live.score desc,live.project_created_at desc,live.project_id,live.expert_id limit remaining
  loop
    insert into public.recommendation_deliveries(recipient_id,project_id,expert_id,kind)
      values(p_recipient,candidate.project_id,candidate.expert_id,candidate.kind) on conflict do nothing;
    get diagnostics delivery_count=row_count;
    if delivery_count=1 then
      -- No names, titles or skill snapshots: later privacy changes cannot leak
      -- stale personal data in an old inbox item. The destination rechecks access.
      insert into public.notifications(recipient_id,actor_id,project_id,type,title,body,href,payload)
      values(p_recipient,null,candidate.project_id,
        case when candidate.kind='projects' then 'recommended_project' else 'recommended_expert' end,
        case when candidate.kind='projects' then 'Для вас найден подходящий проект' else 'Найден специалист для вашего проекта' end,
        'Есть совпадения по навыкам или специализациям. Посмотрите подборку и причины рекомендации.',
        '/recommendations?kind='||candidate.kind,
        jsonb_build_object('project_id',candidate.project_id,'expert_id',candidate.expert_id,'kind',candidate.kind));
      delivered:=delivered+1;
    end if;
  end loop;
  return delivered;
end $$;

create function public.recommendations_from_listing() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;
begin
  if tg_op='UPDATE' and row(new.roles_needed,new.skills,new.university_id,new.visibility,new.completed_at,new.deadline_at)
    is not distinct from row(old.roles_needed,old.skills,old.university_id,old.visibility,old.completed_at,old.deadline_at) then return new; end if;
  perform public.rebuild_recommendations_internal(new.id,null);
  for recipient in select distinct id from (
    select new.created_by id union all select expert_id from public.recommendation_pairs where project_id=new.id
  ) recipients where id is not null order by id loop
    perform public.deliver_recommendations_internal(recipient);
  end loop;
  return new;
end $$;
create function public.recommendations_from_profile() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;
begin
  if tg_op='UPDATE' and row(new.roles,new.skills,new.university_id,new.visibility,new.availability_hours,new.display_name)
    is not distinct from row(old.roles,old.skills,old.university_id,old.visibility,old.availability_hours,old.display_name) then return new; end if;
  perform public.rebuild_recommendations_internal(null,new.user_id);
  for recipient in select distinct id from (
    select new.user_id id union all select l.created_by from public.recommendation_pairs pair
      join public.listings l on l.id=pair.project_id where pair.expert_id=new.user_id
  ) recipients where id is not null order by id loop
    perform public.deliver_recommendations_internal(recipient);
  end loop;
  return new;
end $$;
-- Defer until commit so invitations/applications created in the same transaction
-- are already visible and cannot produce a redundant recommendation.
create constraint trigger recommendations_listing after insert or update on public.listings deferrable initially deferred for each row execute function public.recommendations_from_listing();
create constraint trigger recommendations_profile after insert or update on public.profiles deferrable initially deferred for each row execute function public.recommendations_from_profile();

create function public.refresh_my_recommendations() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare viewer uuid:=auth.uid(); last_refresh timestamptz; project uuid; sent integer;
begin
  if viewer is null then raise exception 'Войдите в аккаунт'; end if;
  if not exists(select 1 from public.profiles where user_id=viewer) then return jsonb_build_object('refreshed',false,'sent',0); end if;
  if not pg_try_advisory_xact_lock(hashtextextended(viewer::text||':recommendation-refresh',0)) then return jsonb_build_object('refreshed',false,'sent',0); end if;
  select refreshed_at into last_refresh from public.recommendation_refreshes where user_id=viewer;
  if last_refresh>now()-interval '5 minutes' then return jsonb_build_object('refreshed',false,'sent',0); end if;
  insert into public.recommendation_refreshes(user_id) values(viewer) on conflict(user_id) do update set refreshed_at=now();
  perform public.rebuild_recommendations_internal(null,viewer);
  for project in select id from public.listings where created_by=viewer and visibility='public' and completed_at is null order by created_at desc limit 20 loop
    perform public.rebuild_recommendations_internal(project,null);
  end loop;
  sent:=public.deliver_recommendations_internal(viewer);
  return jsonb_build_object('refreshed',true,'sent',sent);
end $$;

create function public.get_my_recommendations(p_kind text,p_project uuid default null)
returns table(project_id uuid,expert_id uuid,project_title text,project_description text,project_created_at timestamptz,
  expert_name text,expert_code text,price_from numeric,price_unit text,score integer,
  matched_skills text[],matched_roles text[],university_match boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  if p_kind is null or p_kind not in ('projects','experts') then raise exception 'Выберите тип рекомендаций'; end if;
  return query select live.project_id,live.expert_id,live.project_title,live.project_description,live.project_created_at,
    live.expert_name,live.expert_code,live.price_from,live.price_unit,live.score,live.matched_skills,live.matched_roles,live.university_match
    from public.recommendation_pairs pair join public.recommendation_live live using(project_id,expert_id)
    where ((p_kind='projects' and live.expert_id=auth.uid() and not pair.expert_dismissed)
      or (p_kind='experts' and live.owner_id=auth.uid() and not pair.owner_dismissed))
      and (p_project is null or live.project_id=p_project)
    order by live.score desc,live.project_created_at desc,live.project_id,live.expert_id limit 50;
end $$;

create function public.dismiss_my_recommendation(p_project uuid,p_expert uuid,p_kind text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  if p_kind='projects' and p_expert=auth.uid() then
    update public.recommendation_pairs set expert_dismissed=true where project_id=p_project and expert_id=p_expert;
  elsif p_kind='experts' and exists(select 1 from public.listings where id=p_project and created_by=auth.uid()) then
    update public.recommendation_pairs set owner_dismissed=true where project_id=p_project and expert_id=p_expert;
  else raise exception 'Рекомендация недоступна'; end if;
end $$;
create function public.restore_my_recommendations(p_kind text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  if p_kind='projects' then update public.recommendation_pairs set expert_dismissed=false where expert_id=auth.uid();
  elsif p_kind='experts' then update public.recommendation_pairs pair set owner_dismissed=false
    from public.listings l where l.id=pair.project_id and l.created_by=auth.uid();
  else raise exception 'Выберите тип рекомендаций'; end if;
end $$;

-- Existing settings keep their choices. Missing recommendation flags mean enabled.
alter table public.user_settings alter column notification_prefs set default
'{"files":true,"tasks":true,"reviews":true,"auctions":true,"projects":true,"invitations":true,"recommend_projects":true,"recommend_experts":true}'::jsonb;
revoke all on function public.recommendation_tags(text[]),public.recommendation_fit(text[],text[],text[],text[],boolean),
 public.rebuild_recommendations_internal(uuid,uuid),public.deliver_recommendations_internal(uuid),
 public.recommendations_from_listing(),public.recommendations_from_profile(),public.refresh_my_recommendations(),
 public.get_my_recommendations(text,uuid),public.dismiss_my_recommendation(uuid,uuid,text),public.restore_my_recommendations(text)
 from public,anon,authenticated;
grant execute on function public.refresh_my_recommendations(),public.get_my_recommendations(text,uuid),
 public.dismiss_my_recommendation(uuid,uuid,text),public.restore_my_recommendations(text) to authenticated;
notify pgrst,'reload schema';
commit;
