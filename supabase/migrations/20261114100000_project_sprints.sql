-- ER-012 stage 2. Requires 20261114090000; no cloud execution by the agent.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.project_backlogs (
 project_id uuid primary key references public.listings(id) on delete cascade,
 version bigint not null default 0 check(version>=0),
 task_order uuid[] not null default '{}'
);
create table public.project_sprints (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.listings(id) on delete cascade,
 number integer not null check(number>0),
 name text not null check(length(btrim(name)) between 1 and 120),
 goal text not null default '' check(length(goal)<=4000),
 start_at timestamptz,
 end_at timestamptz,
 state text not null default 'planned' check(state in ('planned','active','completed','cancelled')),
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default statement_timestamp(),
 created_by uuid,
 started_at timestamptz,
 closed_at timestamptz,
 close_reason text check(length(close_reason)<=2000),
 start_snapshot jsonb,
 final_snapshot jsonb,
 unique(project_id,id),unique(project_id,number),
 check(start_at is null or end_at is null or end_at>start_at),
 check((state in ('completed','cancelled'))=(closed_at is not null)),
 check(state<>'active' or (started_at is not null and start_at is not null and end_at is not null and start_snapshot is not null)),
 check(state not in ('completed','cancelled') or final_snapshot is not null)
);
create unique index project_sprints_one_active on public.project_sprints(project_id) where state='active';
alter table public.tasks add constraint tasks_project_id_id_unique unique(project_id,id);
create table public.project_sprint_items (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.listings(id) on delete cascade,
 sprint_id uuid not null,
 task_id uuid not null,
 live_task_id uuid,
 added_at timestamptz not null default statement_timestamp(),
 added_by uuid,
 removed_at timestamptz,
 removed_by uuid,
 outcome text check(outcome in ('done','backlog','moved','removed','deleted')),
 destination_sprint_id uuid,
 entry_snapshot jsonb not null,
 exit_snapshot jsonb,
 foreign key(project_id,sprint_id) references public.project_sprints(project_id,id) on delete cascade,
 foreign key(project_id,destination_sprint_id) references public.project_sprints(project_id,id),
 foreign key(project_id,live_task_id) references public.tasks(project_id,id) on delete set null (live_task_id),
 check(live_task_id is null or live_task_id=task_id),
 check((removed_at is null)=(outcome is null)),
 check(removed_at is null or exit_snapshot is not null)
);
create unique index project_sprint_items_one_open on public.project_sprint_items(live_task_id) where removed_at is null;
create index project_sprint_items_sprint_idx on public.project_sprint_items(sprint_id);
create index project_sprint_items_task_idx on public.project_sprint_items(task_id);
create table public.project_sprint_events (
 id bigint generated always as identity primary key,
 project_id uuid not null references public.listings(id) on delete cascade,
 sprint_id uuid not null,
 kind text not null check(kind in ('created','updated','started','scope_added','scope_removed','task_changed','task_deleted','completed','cancelled')),
 actor_id uuid,
 created_at timestamptz not null default statement_timestamp(),
 data jsonb not null,
 foreign key(project_id,sprint_id) references public.project_sprints(project_id,id) on delete cascade
);
create index project_sprint_events_sprint_idx on public.project_sprint_events(sprint_id,id);

alter table public.project_backlogs enable row level security;
alter table public.project_sprints enable row level security;
alter table public.project_sprint_items enable row level security;
alter table public.project_sprint_events enable row level security;
revoke all on public.project_backlogs,public.project_sprints,public.project_sprint_items,public.project_sprint_events from public,anon,authenticated;
revoke all on sequence public.project_sprint_events_id_seq from public,anon,authenticated;
grant select on public.project_backlogs,public.project_sprints,public.project_sprint_items,public.project_sprint_events to authenticated;
create policy backlog_members_read on public.project_backlogs for select to authenticated using(public.is_project_member(project_id,auth.uid()));
create policy sprints_members_read on public.project_sprints for select to authenticated using(public.is_project_member(project_id,auth.uid()));
create policy sprint_items_members_read on public.project_sprint_items for select to authenticated using(public.is_project_member(project_id,auth.uid()));
create policy sprint_events_members_read on public.project_sprint_events for select to authenticated using(public.is_project_member(project_id,auth.uid()));

create function public.planning_backlog_touch_internal(p_project uuid) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.project_backlogs(project_id,version) values(p_project,1)
 on conflict(project_id) do update set version=project_backlogs.version+1
$$;
create function public.planning_task_snapshot_internal(p_task public.tasks) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('task_id',p_task.id,'title',p_task.title,'status',p_task.status,'stage_id',p_task.stage_id,
  'story_points',p_task.story_points,'planned_hours',p_task.planned_hours,'version',p_task.planning_version,
  'assignee_id',p_task.assignee_id,'start_at',p_task.start_at,'due_at',p_task.due_at,'completed_at',p_task.completed_at)
$$;
create function public.planning_sprint_event_internal(p_sprint uuid,p_kind text,p_data jsonb,p_activity boolean default true) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project uuid; v_type text;
begin
 select project_id into strict v_project from public.project_sprints where id=p_sprint;
 if auth.uid() is not null and not public.is_project_member(v_project,auth.uid()) then raise exception using errcode='42501',message='Нет прав на спринт.'; end if;
 insert into public.project_sprint_events(project_id,sprint_id,kind,actor_id,data) values(v_project,p_sprint,p_kind,auth.uid(),p_data);
 if p_activity then
   v_type:=case when p_kind in ('scope_added','scope_removed') then 'sprint_scope_changed' else 'sprint_'||p_kind end;
   perform public.planning_event_internal(v_project,v_type,p_sprint,p_data);
 end if;
end $$;
create function public.planning_sprint_lock_internal(p_sprint uuid,p_expected bigint,p_manage boolean,p_require_scrum boolean default true)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project uuid; v public.project_sprints;
begin
 select project_id into v_project from public.project_sprints where id=p_sprint;
 perform public.planning_lock_internal(v_project,p_manage);
 if p_require_scrum and not exists(select 1 from public.project_planning where project_id=v_project and mode='scrum') then
   raise exception using errcode='23514',message='Операция требует режима scrum.';
 end if;
 select * into v from public.project_sprints where id=p_sprint for update;
 if not found or v.version is distinct from p_expected then raise exception using errcode='PT409',message='Спринт изменился. Обновите данные.'; end if;
 return v;
end $$;

create function public.get_project_backlog(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_backlogs; v_tasks jsonb;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id,auth.uid()) then raise exception using errcode='42501',message='Проект недоступен.'; end if;
 select * into v from public.project_backlogs where project_id=p_project_id;
 select coalesce(jsonb_agg(to_jsonb(t) order by coalesce(array_position(v.task_order,t.id),2147483647),t.created_at,t.id),'[]') into v_tasks
 from public.tasks t where t.project_id=p_project_id and t.status<>'done'
 and not exists(select 1 from public.project_sprint_items i where i.live_task_id=t.id and i.removed_at is null);
 return jsonb_build_object('project_id',p_project_id,'version',coalesce(v.version,0),'tasks',v_tasks);
end $$;

create function public.reorder_project_backlog(p_project_id uuid,p_expected_version bigint,p_task_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_backlogs; v_current uuid[];
begin
 perform public.planning_lock_internal(p_project_id);
 if not exists(select 1 from public.listings where id=p_project_id and created_by=auth.uid()) and
    not exists(select 1 from public.project_roles where project_id=p_project_id and user_id=auth.uid() and role='product_owner') then
   raise exception using errcode='42501',message='Порядок бэклога меняют автор и действующий Product Owner.';
 end if;
 insert into public.project_backlogs(project_id) values(p_project_id) on conflict do nothing;
 select * into v from public.project_backlogs where project_id=p_project_id for update;
 if v.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Бэклог изменился. Обновите данные.'; end if;
 if p_task_ids is null or cardinality(p_task_ids)>5000 or array_position(p_task_ids,null) is not null
   or cardinality(p_task_ids)<>(select count(distinct x) from unnest(p_task_ids) x) then
   raise exception using errcode='23514',message='Нужен список уникальных UUID бэклога (не более 5000).';
 end if;
 perform 1 from public.tasks where project_id=p_project_id order by id for update;
 select coalesce(array_agg(t.id order by coalesce(array_position(v.task_order,t.id),2147483647),t.created_at,t.id),'{}') into v_current
 from public.tasks t where t.project_id=p_project_id and t.status<>'done'
   and not exists(select 1 from public.project_sprint_items i where i.live_task_id=t.id and i.removed_at is null);
 if not (p_task_ids @> v_current and p_task_ids <@ v_current) then raise exception using errcode='PT409',message='Состав бэклога изменился или содержит чужие задачи.'; end if;
 if p_task_ids=v_current then return public.get_project_backlog(p_project_id); end if;
 update public.project_backlogs set task_order=p_task_ids,version=version+1 where project_id=p_project_id;
 perform public.planning_event_internal(p_project_id,'backlog_reordered',p_project_id,jsonb_build_object('old_task_ids',v_current,'new_task_ids',p_task_ids,'version',v.version+1));
 return public.get_project_backlog(p_project_id);
end $$;

create function public.create_project_sprint(p_project_id uuid,p_expected_planning_version bigint,p_name text,p_goal text,p_start_at timestamptz,p_end_at timestamptz)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_sprints; v_planning public.project_planning;
begin
 perform public.planning_lock_internal(p_project_id,true);
 v_planning:=public.planning_version_internal(p_project_id,p_expected_planning_version);
 if v_planning.mode<>'scrum' then raise exception using errcode='23514',message='Создание спринта требует режима scrum.'; end if;
 insert into public.project_sprints(project_id,number,name,goal,start_at,end_at,created_by)
 select p_project_id,coalesce(max(number),0)+1,p_name,p_goal,p_start_at,p_end_at,auth.uid()
 from public.project_sprints where project_id=p_project_id returning * into v;
 update public.project_planning set version=version+1 where project_id=p_project_id;
 perform public.planning_sprint_event_internal(v.id,'created',to_jsonb(v));
 return v;
end $$;
create function public.update_project_sprint(p_sprint_id uuid,p_expected_version bigint,p_name text,p_goal text,p_start_at timestamptz,p_end_at timestamptz)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_sprints; v_after public.project_sprints;
begin
 v:=public.planning_sprint_lock_internal(p_sprint_id,p_expected_version,true);
 if v.state not in ('planned','active') then raise exception using errcode='23514',message='Закрытый спринт неизменяем.'; end if;
 if (v.name,v.goal,v.start_at,v.end_at) is not distinct from (p_name,p_goal,p_start_at,p_end_at) then return v; end if;
 update public.project_sprints set name=p_name,goal=p_goal,start_at=p_start_at,end_at=p_end_at,version=version+1 where id=v.id returning * into v_after;
 perform public.planning_sprint_event_internal(v.id,'updated',jsonb_build_object('old',to_jsonb(v),'new',to_jsonb(v_after)));
 return v_after;
end $$;

create function public.add_tasks_to_sprint(p_sprint_id uuid,p_expected_version bigint,p_tasks jsonb)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_sprints; r record; t public.tasks; v_added uuid[]:='{}';
begin
 v:=public.planning_sprint_lock_internal(p_sprint_id,p_expected_version,false);
 if v.state not in ('planned','active') then raise exception using errcode='23514',message='Закрытый спринт неизменяем.'; end if;
 if v.state='active' and not public.planning_can_manage_internal(v.project_id) then raise exception using errcode='42501',message='Активным составом управляет автор или делегат.'; end if;
 if p_tasks is null or jsonb_typeof(p_tasks)<>'array' then raise exception using errcode='23514',message='Ожидается массив задач с версиями.'; end if;
 if jsonb_array_length(p_tasks)>5000 or exists(select 1 from jsonb_to_recordset(p_tasks) as x(task_id uuid,expected_version bigint) where task_id is null or expected_version is null)
 or (select count(distinct task_id) from jsonb_to_recordset(p_tasks) as x(task_id uuid))<>jsonb_array_length(p_tasks) then
   raise exception using errcode='23514',message='Нужны уникальные задачи с версиями (не более 5000).';
 end if;
 for r in select * from jsonb_to_recordset(p_tasks) as x(task_id uuid,expected_version bigint) order by task_id loop
   select * into t from public.tasks where id=r.task_id and project_id=v.project_id for update;
   if not found then raise exception using errcode='23514',message='Задача недоступна или принадлежит другому проекту.'; end if;
   if t.planning_version is distinct from r.expected_version then raise exception using errcode='PT409',message='Задача изменилась. Обновите состав.'; end if;
   if exists(select 1 from public.project_sprint_items where live_task_id=t.id and removed_at is null and sprint_id=v.id) then continue; end if;
   if t.status='done' or exists(select 1 from public.project_sprint_items where live_task_id=t.id and removed_at is null) then
     raise exception using errcode='23514',message='Задача завершена или уже включена в другой спринт.';
   end if;
   insert into public.project_sprint_items(project_id,sprint_id,task_id,live_task_id,added_by,entry_snapshot)
    values(v.project_id,v.id,t.id,t.id,auth.uid(),public.planning_task_snapshot_internal(t));
   v_added:=array_append(v_added,t.id);
 end loop;
 if cardinality(v_added)=0 then return v; end if;
 update public.project_sprints set version=version+1 where id=v.id returning * into v;
 perform public.planning_backlog_touch_internal(v.project_id);
 perform public.planning_sprint_event_internal(v.id,'scope_added',jsonb_build_object('task_ids',v_added,'version',v.version));
 return v;
end $$;

create function public.remove_task_from_sprint(p_sprint_id uuid,p_expected_version bigint,p_task_id uuid,p_expected_task_version bigint)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_sprints; t public.tasks;
begin
 v:=public.planning_sprint_lock_internal(p_sprint_id,p_expected_version,false);
 if v.state not in ('planned','active') then raise exception using errcode='23514',message='Закрытый спринт неизменяем.'; end if;
 if v.state='active' and not public.planning_can_manage_internal(v.project_id) then raise exception using errcode='42501',message='Активным составом управляет автор или делегат.'; end if;
 select * into t from public.tasks where id=p_task_id and project_id=v.project_id for update;
 if not found then raise exception using errcode='23514',message='Задача недоступна.'; end if;
 if t.planning_version is distinct from p_expected_task_version then raise exception using errcode='PT409',message='Задача изменилась.'; end if;
 update public.project_sprint_items set removed_at=statement_timestamp(),removed_by=auth.uid(),outcome='removed',exit_snapshot=public.planning_task_snapshot_internal(t)
  where sprint_id=v.id and live_task_id=t.id and removed_at is null;
 if not found then return v; end if;
 update public.project_sprints set version=version+1 where id=v.id returning * into v;
 perform public.planning_backlog_touch_internal(v.project_id);
 perform public.planning_sprint_event_internal(v.id,'scope_removed',jsonb_build_object('task_id',t.id,'version',v.version));
 return v;
end $$;

create function public.planning_sprint_snapshot_internal(p_sprint uuid,p_start boolean) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 with scope as (
   select i.*,coalesce(i.exit_snapshot,public.planning_task_snapshot_internal(t)) as value
   from public.project_sprint_items i left join public.tasks t on t.id=i.live_task_id
   where i.sprint_id=p_sprint and (not p_start or i.removed_at is null)
 ), counted as (
   select * from scope where p_start or outcome in ('done','backlog','moved')
 )
 select jsonb_build_object('captured_at',statement_timestamp(),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('item_id',id,'task_id',task_id,'added_at',added_at,'removed_at',removed_at,
    'outcome',outcome,'destination_sprint_id',destination_sprint_id,'task',value) order by added_at,id),'[]') from scope),
  'totals',(select jsonb_build_object('tasks',count(*),'story_points',sum((value->>'story_points')::numeric),
    'planned_hours',sum((value->>'planned_hours')::numeric),'unestimated_points',count(*) filter(where value->>'story_points' is null),
    'unestimated_hours',count(*) filter(where value->>'planned_hours' is null)) from counted),
  'completed',(select jsonb_build_object('tasks',count(*),'story_points',sum((value->>'story_points')::numeric),
    'planned_hours',sum((value->>'planned_hours')::numeric),'unestimated_points',count(*) filter(where value->>'story_points' is null),
    'unestimated_hours',count(*) filter(where value->>'planned_hours' is null)) from counted where value->>'status'='done'))
$$;

create function public.start_project_sprint(p_sprint_id uuid,p_expected_version bigint) returns public.project_sprints
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_sprints;
begin
 v:=public.planning_sprint_lock_internal(p_sprint_id,p_expected_version,true);
 if v.state='active' then return v; end if;
 if v.state<>'planned' or v.start_at is null or v.end_at is null then raise exception using errcode='23514',message='Для старта нужен планируемый спринт с датами.'; end if;
 if exists(select 1 from public.project_sprints where project_id=v.project_id and state='active') then raise exception using errcode='23514',message='В проекте уже есть активный спринт.'; end if;
 if not exists(select 1 from public.project_sprint_items where sprint_id=v.id and removed_at is null) then raise exception using errcode='23514',message='Пустой спринт нельзя начать.'; end if;
 perform 1 from public.tasks where id in(select live_task_id from public.project_sprint_items where sprint_id=v.id and removed_at is null) order by id for update;
 update public.project_sprints set state='active',started_at=statement_timestamp(),start_snapshot=public.planning_sprint_snapshot_internal(v.id,true),version=version+1
  where id=v.id returning * into v;
 perform public.planning_sprint_event_internal(v.id,'started',jsonb_build_object('snapshot',v.start_snapshot,'version',v.version));
 return v;
end $$;

-- Exact decision set: one choice per unfinished open task; targets and their
-- expected versions are checked BEFORE any scope mutation.
create function public.close_project_sprint(p_sprint_id uuid,p_expected_version bigint,p_cancel boolean,p_reason text,p_decisions jsonb)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_sprints; target public.project_sprints; r record; item record; t public.tasks;
 v_destination uuid; v_outcome text; v_target_ids uuid[]:='{}'; v_final jsonb;
begin
 v:=public.planning_sprint_lock_internal(p_sprint_id,p_expected_version,true,false);
 if p_cancel is null or p_decisions is null or jsonb_typeof(p_decisions)<>'array' then raise exception using errcode='23514',message='Нужны тип закрытия и массив решений.'; end if;
 if v.state not in ('planned','active') or (not p_cancel and v.state<>'active') then raise exception using errcode='23514',message='Нельзя закрыть спринт в этом состоянии.'; end if;
 if p_cancel and (p_reason is null or btrim(p_reason)='') then raise exception using errcode='23514',message='Для отмены нужна причина.'; end if;
 if length(p_reason)>2000 or jsonb_array_length(p_decisions)>5000 then raise exception using errcode='23514',message='Превышен размер запроса.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_decisions) as x(task_id uuid,destination text,sprint_id uuid,expected_sprint_version bigint)
    where task_id is null or destination is null or destination not in ('backlog','sprint')
      or (destination='backlog' and (sprint_id is not null or expected_sprint_version is not null))
      or (destination='sprint' and (sprint_id is null or expected_sprint_version is null or sprint_id=v.id)))
 or (select count(distinct task_id) from jsonb_to_recordset(p_decisions) as x(task_id uuid))<>jsonb_array_length(p_decisions) then
   raise exception using errcode='23514',message='Некорректные или повторные решения.';
 end if;
 perform 1 from public.project_sprints where project_id=v.project_id and id in
  (select sprint_id from jsonb_to_recordset(p_decisions) as x(sprint_id uuid)) order by id for update;
 for r in select distinct sprint_id,expected_sprint_version from jsonb_to_recordset(p_decisions) as x(sprint_id uuid,expected_sprint_version bigint) where sprint_id is not null order by sprint_id loop
   select * into target from public.project_sprints where id=r.sprint_id and project_id=v.project_id;
   if not found or target.state<>'planned' then raise exception using errcode='23514',message='Цель переноса должна быть планируемым спринтом того же проекта.'; end if;
   if target.version is distinct from r.expected_sprint_version then raise exception using errcode='PT409',message='Целевой спринт изменился.'; end if;
   v_target_ids:=array_append(v_target_ids,target.id);
 end loop;
 perform 1 from public.tasks where id in(select live_task_id from public.project_sprint_items where sprint_id=v.id and removed_at is null) order by id for update;
 if exists(
   (select task_row.id from public.project_sprint_items i join public.tasks task_row on task_row.id=i.live_task_id where i.sprint_id=v.id and i.removed_at is null and task_row.status<>'done'
    except select task_id from jsonb_to_recordset(p_decisions) as x(task_id uuid))
   union all
   (select task_id from jsonb_to_recordset(p_decisions) as x(task_id uuid)
    except select task_row.id from public.project_sprint_items i join public.tasks task_row on task_row.id=i.live_task_id where i.sprint_id=v.id and i.removed_at is null and task_row.status<>'done')
 ) then raise exception using errcode='23514',message='Решение требуется ровно для каждой незавершённой задачи.'; end if;
 for item in select * from public.project_sprint_items where sprint_id=v.id and removed_at is null order by task_id loop
   select * into strict t from public.tasks where id=item.live_task_id;
   v_destination:=null;
   if t.status='done' then v_outcome:='done';
   else
     select case when destination='sprint' then 'moved' else 'backlog' end,sprint_id into v_outcome,v_destination
       from jsonb_to_recordset(p_decisions) as x(task_id uuid,destination text,sprint_id uuid) where task_id=t.id;
   end if;
   update public.project_sprint_items set removed_at=statement_timestamp(),removed_by=auth.uid(),outcome=v_outcome,
    destination_sprint_id=v_destination,exit_snapshot=public.planning_task_snapshot_internal(t) where id=item.id;
   if v_destination is not null then
     insert into public.project_sprint_items(project_id,sprint_id,task_id,live_task_id,added_by,entry_snapshot)
      values(v.project_id,v_destination,t.id,t.id,auth.uid(),public.planning_task_snapshot_internal(t));
   end if;
 end loop;
 for target in select * from public.project_sprints where id=any(v_target_ids) order by id loop
   update public.project_sprints set version=version+1 where id=target.id returning * into target;
   perform public.planning_sprint_event_internal(target.id,'scope_added',jsonb_build_object('from_sprint_id',v.id,'version',target.version,
     'task_ids',(select jsonb_agg(task_id order by task_id) from jsonb_to_recordset(p_decisions) as x(task_id uuid,sprint_id uuid) where sprint_id=target.id)));
 end loop;
 v_final:=public.planning_sprint_snapshot_internal(v.id,false);
 update public.project_sprints set state=case when p_cancel then 'cancelled' else 'completed' end,closed_at=statement_timestamp(),close_reason=p_reason,
   final_snapshot=v_final,version=version+1 where id=v.id returning * into v;
 perform public.planning_backlog_touch_internal(v.project_id);
 perform public.planning_sprint_event_internal(v.id,case when p_cancel then 'cancelled' else 'completed' end,
   jsonb_build_object('reason',p_reason,'decisions',p_decisions,'snapshot',v_final,'version',v.version));
 return v;
end $$;

create function public.planning_sprint_task_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project uuid; v_task public.tasks; v_old jsonb; v_new jsonb; i record;
begin
 if tg_op='DELETE' then v_task:=old; else v_task:=new; end if;
 v_project:=v_task.project_id;
 if not exists(select 1 from public.listings where id=v_project) then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='UPDATE' and new.planning_version=old.planning_version then return new; end if;
 if tg_op<>'INSERT' then v_old:=public.planning_task_snapshot_internal(old); end if;
 if tg_op<>'DELETE' then v_new:=public.planning_task_snapshot_internal(new); end if;
 for i in select it.*,s.state from public.project_sprint_items it join public.project_sprints s on s.id=it.sprint_id
   where it.live_task_id=v_task.id and it.removed_at is null order by it.sprint_id loop
   if tg_op='DELETE' then
     if i.state='active' and auth.uid() is not null and not public.planning_can_manage_internal(v_project) then
       raise exception using errcode='42501',message='Удаление задачи меняет активный состав: нужны права управляющего.';
     end if;
     update public.project_sprint_items set removed_at=statement_timestamp(),removed_by=auth.uid(),outcome='deleted',exit_snapshot=v_old where id=i.id;
   end if;
   update public.project_sprints set version=version+1 where id=i.sprint_id;
   perform public.planning_sprint_event_internal(i.sprint_id,case when tg_op='DELETE' then 'task_deleted' else 'task_changed' end,
     jsonb_build_object('task_id',v_task.id,'old',v_old,'new',v_new),false);
 end loop;
 perform public.planning_backlog_touch_internal(v_project);
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger planning_sprint_task_changes after insert or update on public.tasks for each row execute function public.planning_sprint_task_internal();
-- BEFORE DELETE captures the task before SET NULL FKs and enforces active scope rights.
create trigger planning_sprint_task_delete before delete on public.tasks for each row execute function public.planning_sprint_task_internal();

create function public.planning_sprint_mode_guard_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.mode<>'scrum' and exists(select 1 from public.project_sprints where project_id=new.project_id and state='active') then
   raise exception using errcode='23514',message='Сначала завершите или отмените активный спринт.';
 end if;
 return new;
end $$;
create trigger planning_sprint_mode_guard before update on public.project_planning for each row execute function public.planning_sprint_mode_guard_internal();
create function public.planning_sprint_project_guard_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.completed_at is not null and old.completed_at is null and exists(select 1 from public.project_sprints where project_id=new.id and state='active') then
   raise exception using errcode='23514',message='Сначала закройте активный спринт.';
 end if;
 return new;
end $$;
create trigger planning_sprint_project_guard before update on public.listings for each row execute function public.planning_sprint_project_guard_internal();

do $acl$
declare r record;
begin
 for r in select oid,proname,oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('planning_backlog_touch_internal','planning_task_snapshot_internal','planning_sprint_event_internal','planning_sprint_lock_internal',
  'planning_sprint_snapshot_internal','planning_sprint_task_internal','planning_sprint_mode_guard_internal','planning_sprint_project_guard_internal',
  'get_project_backlog','reorder_project_backlog','create_project_sprint','update_project_sprint','add_tasks_to_sprint','remove_task_from_sprint','start_project_sprint','close_project_sprint') loop
   if pg_get_userbyid((select proowner from pg_proc where oid=r.oid))<>'postgres' then raise exception 'ER-012: unexpected owner %',r.signature; end if;
   execute format('revoke all on function %s from public,anon,authenticated',r.signature);
   if r.proname not like 'planning\_%' escape '\' then execute format('grant execute on function %s to authenticated',r.signature);
   elsif has_function_privilege('authenticated',r.oid,'EXECUTE') then raise exception 'ER-012: inherited internal EXECUTE %',r.signature;
   end if;
   if has_function_privilege('anon',r.oid,'EXECUTE') then raise exception 'ER-012: inherited anon EXECUTE %',r.signature; end if;
 end loop;
end $acl$;
notify pgrst,'reload schema';
commit;
