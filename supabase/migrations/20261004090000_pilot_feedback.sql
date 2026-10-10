-- Apply after the 20260823 baseline. Additive pilot features; no destructive data conversion.
begin;

create table public.site_editors (user_id uuid primary key references public.profiles(user_id) on delete cascade);
revoke all on public.site_editors from public,anon,authenticated;
alter table public.site_editors enable row level security;
create policy editors_read_self on public.site_editors for select to authenticated using (user_id = auth.uid());
grant select on public.site_editors to authenticated;
grant all on public.site_editors to service_role;
create function public.is_site_editor() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.site_editors where user_id = auth.uid());
$$;
revoke all on function public.is_site_editor() from public,anon,authenticated;
grant execute on function public.is_site_editor() to anon, authenticated, service_role;

create table public.universities (
  id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 2 and 160),
  verified boolean not null default false, created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index universities_name_unique on public.universities (lower(btrim(name)));
create table public.university_schools (
  id uuid primary key default gen_random_uuid(), university_id uuid not null references public.universities(id),
  name text not null check (length(btrim(name)) between 1 and 160), unique(id, university_id)
);
create unique index university_schools_name_unique on public.university_schools (university_id, lower(btrim(name)));
create table public.university_groups (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.university_schools(id),
  name text not null check (length(btrim(name)) between 1 and 80), unique(id, school_id)
);
create unique index university_groups_name_unique on public.university_groups (school_id, lower(btrim(name)));
create table public.university_proposals (
  user_id uuid primary key references public.profiles(user_id) on delete cascade, last_proposed_at timestamptz not null default now()
);
revoke all on public.university_proposals from public,anon,authenticated;
alter table public.university_proposals enable row level security;
revoke all on public.universities from public,anon,authenticated;
alter table public.universities enable row level security;
revoke all on public.university_schools from public,anon,authenticated;
alter table public.university_schools enable row level security;
revoke all on public.university_groups from public,anon,authenticated;
alter table public.university_groups enable row level security;
create policy universities_read on public.universities for select using (true);
create policy schools_read on public.university_schools for select using (true);
create policy groups_read on public.university_groups for select using (true);
create policy universities_edit on public.universities for all to authenticated using (public.is_site_editor()) with check (public.is_site_editor());
create policy schools_edit on public.university_schools for all to authenticated using (public.is_site_editor()) with check (public.is_site_editor());
create policy groups_edit on public.university_groups for all to authenticated using (public.is_site_editor()) with check (public.is_site_editor());
grant select on public.universities, public.university_schools, public.university_groups to anon;
grant select,insert,update,delete on public.universities, public.university_schools, public.university_groups to authenticated;
grant all on public.universities, public.university_schools, public.university_groups, public.university_proposals to service_role;

create sequence public.expert_code_seq start 100001;
revoke all on sequence public.expert_code_seq from public,anon,authenticated;
alter table public.profiles
  add column expert_code text unique,
  add column experience_years text check (experience_years in ('unspecified','none','under_1','1_3','3_5','over_5')),
  add column price_from numeric check (price_from >= 0 and price_from <= 1000000000),
  add column price_unit text not null default 'negotiable' check (price_unit in ('negotiable','project','consultation')),
  add column languages jsonb not null default '[]'::jsonb check (jsonb_typeof(languages) = 'array' and jsonb_array_length(languages) <= 10),
  add column university_id uuid references public.universities(id),
  add column school_id uuid,
  add column study_group_id uuid,
  add column academic_role text check (academic_role in ('student','graduate','teacher','representative')),
  add constraint profiles_school_path foreign key (school_id, university_id) references public.university_schools(id, university_id),
  add constraint profiles_group_path foreign key (study_group_id, school_id) references public.university_groups(id, school_id),
  add constraint profiles_university_path_check check ((school_id is null or university_id is not null) and (study_group_id is null or school_id is not null)),
  add constraint profiles_price_check check ((price_unit = 'negotiable' and price_from is null) or (price_unit <> 'negotiable' and price_from is not null));
update public.profiles set expert_code = 'ER-' || nextval('public.expert_code_seq')::text;
alter table public.profiles alter column expert_code set not null;
create function public.guard_profile_pilot_fields() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb;
begin
  if tg_op = 'INSERT' then new.expert_code := 'ER-' || nextval('public.expert_code_seq')::text;
  elsif new.expert_code is distinct from old.expert_code then raise exception 'Регистрационный номер нельзя изменять'; end if;
  if (tg_op = 'INSERT' and new.display_name <> '') or (tg_op = 'UPDATE' and new.display_name is distinct from old.display_name) then
    new.display_name := btrim(regexp_replace(new.display_name, '\s+', ' ', 'g'));
    if length(new.display_name) not between 2 and 100 or new.display_name !~ '^[A-Za-zА-Яа-яЁё]+([ ''-][A-Za-zА-Яа-яЁё]+)*$' then
      raise exception 'Имя: только буквы, пробел, дефис и апостроф; от 2 до 100 символов';
    end if;
    if lower(new.display_name) ~ '(^|[ ''-])(хуй[а-яё]*|ху[яеёюй][а-яё]*|пизд[а-яё]*|бляд[а-яё]*|блять|ебан[а-яё]*|ёбан[а-яё]*|пидор[а-яё]*|pidor[a-z]*|fuck[a-z]*|shit)([ ''-]|$)' then
      raise exception 'Укажите настоящее имя без оскорбительных выражений';
    end if;
  end if;
  for item in select value from jsonb_array_elements(new.languages) loop
    if jsonb_typeof(item) <> 'object' or coalesce(length(btrim(item->>'language')),0) not between 2 and 60
      or coalesce(item->>'level','') not in ('A1','A2','B1','B2','C1','C2','native')
      or (coalesce(item->>'certificate_url','') <> '' and (item->>'certificate_url' !~ '^https?://' or length(item->>'certificate_url') > 2000))
      or item ? 'verified' then raise exception 'Проверьте язык, уровень и ссылку на сертификат'; end if;
  end loop;
  return new;
end $$;
create trigger guard_profile_pilot_fields before insert or update on public.profiles for each row execute function public.guard_profile_pilot_fields();
revoke all on function public.guard_profile_pilot_fields() from public,anon,authenticated;

create function public.propose_university_path(p_university text, p_school text default null, p_group text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid; s uuid; g uuid; last_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  if length(btrim(p_university)) not between 2 and 160 or (p_school is not null and length(btrim(p_school)) not between 1 and 160)
    or (p_group is not null and (p_school is null or length(btrim(p_group)) not between 1 and 80)) then raise exception 'Проверьте названия'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':university', 0));
  select last_proposed_at into last_at from public.university_proposals where user_id = auth.uid();
  if last_at > now() - interval '1 minute' then raise exception 'Повторите через минуту'; end if;
  -- A first-time registrant may not have a profile yet. The empty identity is completed in onboarding.
  insert into public.profiles(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  insert into public.university_proposals(user_id) values(auth.uid()) on conflict(user_id) do update set last_proposed_at = now();
  insert into public.universities(name,created_by) values(btrim(p_university),auth.uid())
    on conflict(lower(btrim(name))) do update set name = universities.name returning id into u;
  if p_school is not null then
    insert into public.university_schools(university_id,name) values(u,btrim(p_school))
      on conflict(university_id,lower(btrim(name))) do update set name = university_schools.name returning id into s;
  end if;
  if p_group is not null then
    insert into public.university_groups(school_id,name) values(s,btrim(p_group))
      on conflict(school_id,lower(btrim(name))) do update set name = university_groups.name returning id into g;
  end if;
  return jsonb_build_object('university_id',u,'school_id',s,'study_group_id',g);
end $$;
revoke all on function public.propose_university_path(text,text,text) from public,anon,authenticated;
grant execute on function public.propose_university_path(text,text,text) to authenticated;

alter table public.listings
  add column university_id uuid references public.universities(id), add column school_id uuid, add column study_group_id uuid,
  add column completed_at timestamptz,
  add constraint listings_school_path foreign key(school_id,university_id) references public.university_schools(id,university_id),
  add constraint listings_group_path foreign key(study_group_id,school_id) references public.university_groups(id,school_id),
  add constraint listings_university_path_check check ((school_id is null or university_id is not null) and (study_group_id is null or school_id is not null));
-- Inline ownership/visibility lets INSERT ... RETURNING see the just-inserted row.
-- The existing stable helper cannot see a new row in the same statement's snapshot.
drop policy "Visible listings can be read" on public.listings;
create policy "Visible listings can be read" on public.listings for select
using (visibility='public' or created_by=auth.uid() or public.can_read_listing(id));
create index profiles_university_filters on public.profiles(university_id,school_id,study_group_id);
create index listings_university_filters on public.listings(university_id,school_id,study_group_id);

-- Preserve the existing explicit column masks and visibility rule. Append new columns only.
create or replace view public.profiles_public with (security_barrier=true,security_invoker=false) as
select p.user_id,p.display_name,p.roles,p.skills,p.timezone,p.work_format,p.experience_level,p.about,
  case when p.show_city then p.city else null::text end as city,
  case when p.show_rate then p.hourly_rate else null::numeric end as hourly_rate,
  case when p.show_portfolio then p.portfolio_links else '[]'::jsonb end as portfolio_links,
  case when p.show_availability then p.availability_hours else null::integer end as availability_hours,
  p.visibility,p.show_rate,p.show_city,p.show_portfolio,p.show_availability,p.created_at,
  p.expert_code,p.experience_years,case when p.show_rate then p.price_from else null::numeric end as price_from,
  case when p.show_rate then p.price_unit else 'negotiable'::text end as price_unit,
  p.languages,p.university_id,p.school_id,p.study_group_id,p.academic_role,
  u.name as university_name,s.name as school_name,g.name as study_group_name
from public.profiles p left join public.universities u on u.id=p.university_id
left join public.university_schools s on s.id=p.school_id left join public.university_groups g on g.id=p.study_group_id
where p.visibility='public' or (p.visibility='platform_only' and auth.uid() is not null);
create or replace view public.profiles_collaboration with (security_barrier=true,security_invoker=false) as
select user_id,display_name,expert_code from public.profiles where public.can_view_profile_identity(user_id);
create or replace view public.listings_with_count with (security_invoker=true) as
select id,title,description,roles_needed,skills,timezone,visibility,created_at,created_by,public.visible_application_count(id) as applications_count,
  university_id,school_id,study_group_id,completed_at from public.listings;

create table public.contact_requests (
  id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  body text not null check(length(btrim(body)) between 20 and 2000),
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  reply text check(length(reply) <= 2000), created_at timestamptz not null default now(), responded_at timestamptz,
  project_id uuid references public.listings(id) on delete set null, unique(sender_id,recipient_id), check(sender_id<>recipient_id)
);
revoke all on public.contact_requests from public,anon,authenticated;
alter table public.contact_requests enable row level security;
create policy contacts_participants_read on public.contact_requests for select to authenticated using(auth.uid() in (sender_id,recipient_id));
grant select on public.contact_requests to authenticated;
grant all on public.contact_requests to service_role;
create index contacts_recipient on public.contact_requests(recipient_id,created_at desc);
create function public.send_contact_request(p_recipient uuid,p_body text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare request_id uuid;
begin
  if auth.uid() is null or auth.uid()=p_recipient then raise exception 'Недопустимый получатель'; end if;
  if not exists(select 1 from public.profiles where user_id=auth.uid() and length(display_name)>=2) then raise exception 'Сначала заполните профиль'; end if;
  if not exists(select 1 from public.profiles where user_id=p_recipient and visibility in ('public','platform_only')) then raise exception 'Эксперт недоступен'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':contacts',0));
  if (select count(*) from public.contact_requests where sender_id=auth.uid() and created_at > now()-interval '24 hours') >= 5 then raise exception 'Доступно не более пяти новых обращений за сутки'; end if;
  if exists(select 1 from public.contact_requests where sender_id=auth.uid() and recipient_id=p_recipient) then raise exception 'Вы уже отправили обращение этому эксперту'; end if;
  insert into public.contact_requests(sender_id,recipient_id,body) values(auth.uid(),p_recipient,btrim(p_body)) returning id into request_id;
  insert into public.notifications(recipient_id,actor_id,type,title,body,href,payload)
    values(p_recipient,auth.uid(),'contact_request','Новое предложение сотрудничества','Откройте обращение, чтобы ответить.','/inquiries',jsonb_build_object('contact_id',request_id));
  return request_id;
end $$;
create function public.respond_contact_request(p_id uuid,p_accept boolean,p_reply text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare request public.contact_requests;
begin
  select * into request from public.contact_requests where id=p_id and recipient_id=auth.uid() for update;
  if not found or request.status<>'pending' or p_accept is null then raise exception 'Обращение недоступно или уже обработано'; end if;
  update public.contact_requests set status=case when p_accept then 'accepted' else 'declined' end,reply=nullif(btrim(p_reply),''),responded_at=now() where id=p_id;
  insert into public.notifications(recipient_id,actor_id,type,title,body,href,payload)
    values(request.sender_id,auth.uid(),'contact_response','Эксперт ответил на обращение',case when p_accept then 'Сотрудничество можно обсудить в проекте.' else 'Эксперт отклонил предложение.' end,'/inquiries',jsonb_build_object('contact_id',p_id));
end $$;
create function public.create_project_from_contact(p_contact uuid,p_title text,p_description text,p_roles text[],p_skills text[],p_timezone text,p_university uuid default null,p_school uuid default null,p_group uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare request public.contact_requests; project uuid;
begin
  select * into request from public.contact_requests where id=p_contact and sender_id=auth.uid() for update;
  if not found or request.status<>'accepted' then raise exception 'Сначала дождитесь согласия эксперта'; end if;
  if request.project_id is not null then return request.project_id; end if;
  if length(btrim(p_title)) not between 3 and 200 or length(btrim(p_description)) not between 10 and 20000 then raise exception 'Проверьте название и описание проекта'; end if;
  insert into public.listings(user_id,created_by,title,description,roles_needed,skills,timezone,university_id,school_id,study_group_id)
    values(auth.uid(),auth.uid(),btrim(p_title),btrim(p_description),p_roles,p_skills,p_timezone,p_university,p_school,p_group) returning id into project;
  insert into public.applications(listing_id,user_id,invited_by_author,status) values(project,request.recipient_id,true,'pending');
  update public.contact_requests set project_id=project where id=p_contact;
  return project;
end $$;
revoke all on function public.send_contact_request(uuid,text), public.respond_contact_request(uuid,boolean,text), public.create_project_from_contact(uuid,text,text,text[],text[],text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.send_contact_request(uuid,text), public.respond_contact_request(uuid,boolean,text), public.create_project_from_contact(uuid,text,text,text[],text[],text,uuid,uuid,uuid) to authenticated;

create function public.guard_project_completion() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then new.completed_at:=null; return new; end if;
  if new.completed_at is distinct from old.completed_at then
    if old.completed_at is not null then raise exception 'Завершение проекта нельзя отменить'; end if;
    if auth.uid() is null or old.created_by<>auth.uid() then raise exception 'Только автор может завершить проект'; end if;
    if exists(select 1 from public.tasks where project_id=old.id and status<>'done') then raise exception 'Сначала завершите все задачи проекта'; end if;
    if not exists(select 1 from public.applications where listing_id=old.id and status='accepted') then raise exception 'Для завершения совместного проекта нужен принятый участник'; end if;
    new.completed_at:=now();
  end if;
  return new;
end $$;
create trigger guard_project_completion before insert or update on public.listings for each row execute function public.guard_project_completion();
revoke all on function public.guard_project_completion() from public,anon,authenticated;
-- Freeze the team and tasks at completion so later joiners cannot review past work.
create function public.guard_completed_project_work() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare project uuid; finished timestamptz;
begin
  if tg_table_name='applications' then
    if tg_op='DELETE' then project:=old.listing_id; else project:=new.listing_id; end if;
  else
    if tg_op='DELETE' then project:=old.project_id; else project:=new.project_id; end if;
  end if;
  -- Lock the project row to serialize membership/task changes with completion.
  select completed_at into finished from public.listings where id=project for update;
  if finished is not null then raise exception 'Проект завершён: состав команды и задачи зафиксированы'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger guard_completed_project_applications before insert or update or delete on public.applications for each row execute function public.guard_completed_project_work();
create trigger guard_completed_project_tasks before insert or update or delete on public.tasks for each row execute function public.guard_completed_project_work();
revoke all on function public.guard_completed_project_work() from public,anon,authenticated;
create function public.project_is_completed(p_project uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from public.listings where id=p_project and completed_at is not null); $$;
revoke all on function public.project_is_completed(uuid) from public,anon,authenticated;
grant execute on function public.project_is_completed(uuid) to anon,authenticated;
create policy completed_project_reviews_insert on public.profile_reviews as restrictive for insert to authenticated
with check(public.project_is_completed(project_id) and public.is_project_member(project_id,auth.uid()) and public.is_project_member(project_id,reviewed_user_id));
create policy completed_project_reviews_update on public.profile_reviews as restrictive for update to authenticated
using(public.project_is_completed(project_id)) with check(public.project_is_completed(project_id) and public.is_project_member(project_id,auth.uid()) and public.is_project_member(project_id,reviewed_user_id));
drop policy "Anyone can read profile reviews" on public.profile_reviews;
create policy completed_project_reviews_read on public.profile_reviews for select using(public.project_is_completed(project_id));

create table public.portfolio_files (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null check(length(name) between 1 and 180), storage_path text not null unique,
  size_bytes bigint not null check(size_bytes between 1 and 15728640),
  status text not null default 'pending' check(status in ('pending','ready')), created_at timestamptz not null default now()
);
revoke all on public.portfolio_files from public,anon,authenticated;
alter table public.portfolio_files enable row level security;
create function public.can_read_portfolio(p_user uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
select exists(select 1 from public.profiles where user_id=p_user and (user_id=auth.uid() or (show_portfolio and (visibility='public' or (visibility='platform_only' and auth.uid() is not null)))));
$$;
revoke all on function public.can_read_portfolio(uuid) from public,anon,authenticated;
grant execute on function public.can_read_portfolio(uuid) to anon,authenticated;
create policy portfolio_read on public.portfolio_files for select using ((status='ready' and public.can_read_portfolio(user_id)) or user_id=auth.uid());
grant select on public.portfolio_files to anon,authenticated;
grant all on public.portfolio_files to service_role;
create index portfolio_owner on public.portfolio_files(user_id);
create function public.reserve_portfolio_file(p_user uuid,p_name text,p_bytes bigint) returns public.portfolio_files
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.portfolio_files; file_id uuid := gen_random_uuid(); total bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':portfolio',0));
  delete from public.portfolio_files where user_id=p_user and status='pending' and created_at < now()-interval '15 minutes';
  select coalesce(sum(size_bytes),0) into total from public.portfolio_files where user_id=p_user;
  if p_bytes is null or p_bytes<1 or total+p_bytes>15728640 then raise exception 'Общий размер портфолио не должен превышать 15 МБ'; end if;
  insert into public.portfolio_files(id,user_id,name,storage_path,size_bytes)
    values(file_id,p_user,p_name,p_user::text || '/' || file_id::text || '.pdf',p_bytes) returning * into result;
  return result;
end $$;
revoke all on function public.reserve_portfolio_file(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_portfolio_file(uuid,text,bigint) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portfolio','portfolio',false,15728640,array['application/pdf']) on conflict(id) do update set public=false,file_size_limit=15728640,allowed_mime_types=array['application/pdf'];
-- Upload, finalize and delete only through the JWT-verified Edge Function. No browser write policy.
create policy portfolio_objects_read on storage.objects for select to anon,authenticated using(
  bucket_id='portfolio' and exists(select 1 from public.portfolio_files f where f.storage_path=storage.objects.name and f.status='ready' and public.can_read_portfolio(f.user_id))
);

create table public.publications (
  id uuid primary key default gen_random_uuid(), title text not null check(length(btrim(title)) between 3 and 200),
  kind text not null check(kind in ('news','event','exhibition','seminar','journal')),
  summary text not null default '' check(length(summary)<=600), body text not null default '' check(length(body)<=50000),
  starts_at timestamptz, location text, source_url text check(source_url is null or source_url ~ '^https?://'),
  status text not null default 'draft' check(status in ('draft','published')), published_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(user_id), created_at timestamptz not null default now()
);
revoke all on public.publications from public,anon,authenticated;
alter table public.publications enable row level security;
create policy publications_read on public.publications for select using((status='published' and published_at<=now()) or public.is_site_editor());
create policy publications_editor on public.publications for all to authenticated using(public.is_site_editor()) with check(public.is_site_editor());
grant select on public.publications to anon;
grant select,insert,update,delete on public.publications to authenticated;
grant all on public.publications to service_role;
create table public.legal_documents (
  slug text primary key check(slug in ('ethics','site-use','privacy','terms')), title text not null,
  body text not null default '', version text not null default 'draft', published_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on public.legal_documents from public,anon,authenticated;
alter table public.legal_documents enable row level security;
create policy legal_read on public.legal_documents for select using((published_at is not null and published_at<=now()) or public.is_site_editor());
create policy legal_editor on public.legal_documents for all to authenticated using(public.is_site_editor()) with check(public.is_site_editor());
grant select on public.legal_documents to anon;
grant select,insert,update,delete on public.legal_documents to authenticated;
grant all on public.legal_documents to service_role;
insert into public.legal_documents(slug,title) values('ethics','Этика'),('site-use','Использование сайта'),('privacy','Защита персональных данных'),('terms','Пользовательское соглашение');

create view public.university_projects with(security_invoker=true) as
select l.id,l.title,l.description,l.roles_needed,l.skills,l.created_at,l.university_id,l.school_id,l.study_group_id,l.completed_at,
 u.name as university_name,s.name as school_name,g.name as study_group_name
from public.listings l join public.universities u on u.id=l.university_id
left join public.university_schools s on s.id=l.school_id left join public.university_groups g on g.id=l.study_group_id;
revoke all on public.university_projects from public,anon,authenticated;
grant select on public.university_projects to anon,authenticated;

-- Public read views retain their original grants. New RPCs explicitly grant only the required role.
notify pgrst, 'reload schema';
commit;
