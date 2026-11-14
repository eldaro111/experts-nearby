-- ER-012 UI integration: atomic order/lead replacement and durable request receipts.
-- Requires both ER-012 migrations. Existing signatures, data and history are preserved.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare r record;
begin
 for r in select unnest(array['planning_lock_internal','planning_version_internal',
   'planning_guard_task_internal','update_project_planning','planning_event_internal',
   'create_project_sprint','close_project_sprint']) as name loop
   if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=r.name)<>1
      or not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=r.name
        and pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=public, pg_temp']) then
     raise exception 'ER-012 integration: unexpected owner, overload or settings of %. Inspect schema first.',r.name;
   end if;
 end loop;
 if exists(select 1 from public.tasks t join public.project_stages s on s.id=t.stage_id
   where t.project_id<>s.project_id or s.archived_at is not null or t.status<>coalesce(s.status_value,s.category)) then
   raise exception 'ER-012 integration: incompatible task/stage rows. Diagnose; do not automatically rewrite data.';
 end if;
end $preflight$;

-- All writes lock project -> planning -> stages ordered by UUID. Temporary positions
-- exist only inside this transaction; failed history/constraints roll everything back.
create function public.reorder_project_stages(p_project_id uuid,p_expected_planning_version bigint,p_stage_ids uuid[])
returns public.project_planning language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning; v_before jsonb; v_after jsonb; v_offset bigint; v_ids uuid[];
begin
 perform public.planning_lock_internal(p_project_id,true);
 v:=public.planning_version_internal(p_project_id,p_expected_planning_version);
 if p_stage_ids is null or cardinality(p_stage_ids)>5000 or array_position(p_stage_ids,null) is not null
    or (select count(distinct id) from unnest(p_stage_ids) id)<>cardinality(p_stage_ids) then
   raise exception using errcode='23514',message='Нужен полный порядок уникальных активных этапов (до 5000).';
 end if;
 perform 1 from public.project_stages where project_id=p_project_id and archived_at is null order by id for update;
 select coalesce(array_agg(id order by position),'{}'::uuid[]),
        coalesce(jsonb_agg(jsonb_build_object('id',id,'position',position,'version',version) order by position),'[]'::jsonb),
        coalesce(max(position)::bigint,0)+1
   into v_ids,v_before,v_offset from public.project_stages where project_id=p_project_id and archived_at is null;
 if cardinality(v_ids)<>cardinality(p_stage_ids) or not v_ids @> p_stage_ids then
   raise exception using errcode='PT409',message='Состав этапов изменился. Передайте все активные этапы этого проекта.';
 end if;
 if v_ids=p_stage_ids then return v; end if;
 if v_offset+cardinality(p_stage_ids)>2147483647 then
   raise exception using errcode='23514',message='Позиции этапов слишком велики для безопасной перестановки.';
 end if;
 update public.project_stages s set position=(v_offset+x.n)::integer
 from unnest(p_stage_ids) with ordinality x(id,n) where s.id=x.id and s.project_id=p_project_id;
 update public.project_stages s set position=(x.n-1)::integer,version=s.version+1
 from unnest(p_stage_ids) with ordinality x(id,n) where s.id=x.id and s.project_id=p_project_id;
 update public.project_planning set version=version+1 where project_id=p_project_id returning * into v;
 select jsonb_agg(jsonb_build_object('id',id,'position',position,'version',version) order by position)
   into v_after from public.project_stages where project_id=p_project_id and archived_at is null;
 perform public.planning_event_internal(p_project_id,'stage_changed',p_project_id,
   jsonb_build_object('operation','reorder','old',v_before,'new',v_after,'version',v.version));
 return v;
end $$;

create function public.replace_project_lead(p_project_id uuid,p_expected_planning_version bigint,p_role text,p_user_id uuid)
returns public.project_planning language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning; v_previous uuid;
begin
 perform public.planning_lock_internal(p_project_id);
 if not exists(select 1 from public.listings where id=p_project_id and created_by=auth.uid()) then
   raise exception using errcode='42501',message='Роли назначает автор проекта.';
 end if;
 v:=public.planning_version_internal(p_project_id,p_expected_planning_version);
 if p_role is null or p_role not in ('product_owner','scrum_master') then
   raise exception using errcode='23514',message='Нужна роль Product Owner или Scrum Master.';
 end if;
 if p_user_id is not null and not public.is_project_member(p_project_id,p_user_id) then
   raise exception using errcode='23514',message='Роль требует действующего членства.';
 end if;
 select user_id into v_previous from public.project_roles where project_id=p_project_id and role=p_role for update;
 if v_previous is not distinct from p_user_id then return v; end if;
 delete from public.project_roles where project_id=p_project_id and role=p_role;
 if p_user_id is not null then insert into public.project_roles(project_id,user_id,role) values(p_project_id,p_user_id,p_role); end if;
 update public.project_planning set version=version+1 where project_id=p_project_id returning * into v;
 perform public.planning_event_internal(p_project_id,'planning_role_changed',p_project_id,
   jsonb_build_object('role',p_role,'old_user_id',v_previous,'new_user_id',p_user_id,'version',v.version));
 return v;
end $$;

-- A UUID is globally unique, not reusable by another actor/project/kind/payload.
-- Receipts have no expiry. They survive edits/closure of a sprint; project deletion
-- follows the existing project cascade. Clients have NO direct table privileges.
create table public.project_planning_requests (
 request_id uuid primary key,
 project_id uuid not null references public.listings(id) on delete cascade,
 actor_id uuid not null,
 kind text not null check(kind in ('create_sprint','close_sprint')),
 payload jsonb not null,
 result jsonb,
 created_at timestamptz not null default statement_timestamp()
);
alter table public.project_planning_requests enable row level security;
revoke all on public.project_planning_requests from public,anon,authenticated;

-- Project lock is already held. ON CONFLICT serializes even the same UUID submitted
-- for different projects. No cross-project row/result is returned on a collision.
create function public.planning_claim_request_internal(p_request_id uuid,p_project_id uuid,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning_requests; v_inserted integer;
begin
 if p_request_id is null or auth.uid() is null then raise exception using errcode='23514',message='Нужен идентификатор операции.'; end if;
 insert into public.project_planning_requests(request_id,project_id,actor_id,kind,payload)
 values(p_request_id,p_project_id,auth.uid(),p_kind,p_payload) on conflict do nothing;
 get diagnostics v_inserted=row_count;
 if v_inserted=1 then return null; end if;
 select * into strict v from public.project_planning_requests where request_id=p_request_id for update;
 if v.actor_id<>auth.uid() or v.project_id<>p_project_id or v.kind<>p_kind or v.payload is distinct from p_payload then
   raise exception using errcode='22023',message='Идентификатор операции уже связан с другим запросом.';
 end if;
 if v.result is null then raise exception using errcode='23514',message='Неполная запись операции: требуется диагностика.'; end if;
 return v.result;
end $$;

-- New names avoid PostgREST overload ambiguity; published non-idempotent signatures
-- remain for compatibility. Only these new calls promise a safe same-request retry.
create function public.create_project_sprint_once(p_request_id uuid,p_project_id uuid,p_expected_planning_version bigint,
 p_name text,p_goal text,p_start_at timestamptz,p_end_at timestamptz)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb; v public.project_sprints;
begin
 perform public.planning_lock_internal(p_project_id,true);
 v_result:=public.planning_claim_request_internal(p_request_id,p_project_id,'create_sprint',
   jsonb_build_object('expected_version',p_expected_planning_version,'name',p_name,'goal',p_goal,'start_at',p_start_at,'end_at',p_end_at));
 if v_result is not null then return jsonb_populate_record(null::public.project_sprints,v_result); end if;
 v:=public.create_project_sprint(p_project_id,p_expected_planning_version,p_name,p_goal,p_start_at,p_end_at);
 update public.project_planning_requests set result=to_jsonb(v) where request_id=p_request_id;
 return v;
end $$;

create function public.close_project_sprint_once(p_request_id uuid,p_sprint_id uuid,p_expected_version bigint,
 p_cancel boolean,p_reason text,p_decisions jsonb)
returns public.project_sprints language plpgsql security definer set search_path=public,pg_temp as $$
declare v_project uuid; v_result jsonb; v public.project_sprints;
begin
 select project_id into v_project from public.project_sprints where id=p_sprint_id;
 perform public.planning_lock_internal(v_project,true);
 v_result:=public.planning_claim_request_internal(p_request_id,v_project,'close_sprint',
   jsonb_build_object('sprint_id',p_sprint_id,'expected_version',p_expected_version,'cancel',p_cancel,'reason',p_reason,'decisions',p_decisions));
 if v_result is not null then return jsonb_populate_record(null::public.project_sprints,v_result); end if;
 v:=public.close_project_sprint(p_sprint_id,p_expected_version,p_cancel,p_reason,p_decisions);
 update public.project_planning_requests set result=to_jsonb(v) where request_id=p_request_id;
 return v;
end $$;

-- Read receipt without executing a write or inferring success from a name/time.
-- NULL means "not confirmed yet", not "did not commit" (an in-flight tx is invisible).
create function public.get_project_planning_request(p_project_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v public.project_planning_requests;
begin
 if auth.uid() is null or not public.is_project_member(p_project_id,auth.uid()) then
   raise exception using errcode='42501',message='Проект недоступен.';
 end if;
 select * into v from public.project_planning_requests where request_id=p_request_id;
 if not found then return null; end if;
 if v.project_id<>p_project_id or v.actor_id<>auth.uid() then
   raise exception using errcode='42501',message='Операция недоступна.';
 end if;
 if v.result is null then return null; end if;
 return jsonb_build_object('request_id',v.request_id,'project_id',v.project_id,'actor_id',v.actor_id,'kind',v.kind,'result',v.result);
end $$;

-- No data backfill. Existing tasks without a stage stay visible as unassigned.
-- Default stages are created on mode selection; only an explicit task operation
-- assigns them. The old direct status path still maps to the EXACT effective status.
create or replace function public.update_project_planning(p_project_id uuid,p_expected_version bigint,p_mode text,
 p_goal text,p_definition_of_done text,p_wip_mode text,p_delegate_to_roles boolean) returns public.project_planning
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.project_planning; v_after public.project_planning;
begin
 perform public.planning_lock_internal(p_project_id,true);
 v:=public.planning_version_internal(p_project_id,p_expected_version);
 if v.delegate_to_roles is distinct from p_delegate_to_roles and not exists(select 1 from public.listings where id=p_project_id and created_by=auth.uid()) then
   raise exception using errcode='42501',message='Делегирование меняет только автор проекта.';
 end if;
 if p_mode<>'simple' and p_wip_mode='strict' and exists(
   select 1 from public.project_stages s where s.project_id=p_project_id and s.archived_at is null and s.wip_limit is not null
    and (select count(*) from public.tasks t where t.stage_id=s.id and t.status<>'done')>s.wip_limit) then
   raise exception using errcode='23514',message='Сначала устраните превышения WIP.';
 end if;
 if (v.mode,v.goal,v.definition_of_done,v.wip_mode,v.delegate_to_roles) is not distinct from
    (p_mode,p_goal,p_definition_of_done,p_wip_mode,p_delegate_to_roles) then return v; end if;
 update public.project_planning set mode=p_mode,goal=p_goal,definition_of_done=p_definition_of_done,
   wip_mode=p_wip_mode,delegate_to_roles=p_delegate_to_roles,version=version+1 where project_id=p_project_id returning * into v_after;
 if p_mode<>'simple' and not exists(select 1 from public.project_stages where project_id=p_project_id) then
   insert into public.project_stages(project_id,name,position,category) values
    (p_project_id,'К выполнению',0,'todo'),(p_project_id,'В работе',1,'doing'),(p_project_id,'Готово',2,'done');
 end if;
 perform public.planning_event_internal(p_project_id,'planning_changed',p_project_id,jsonb_build_object('old',to_jsonb(v),'new',to_jsonb(v_after)));
 return v_after;
end $$;

-- An assigned task cannot escape a configured workflow by PATCHing an arbitrary
-- status / clearing stage_id. Legacy unassigned/unknown tasks remain editable.
create or replace function public.planning_guard_task_internal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_stage public.project_stages; v_mode text; v_wip text; v_changed boolean;
begin
 if tg_op='UPDATE' and (new.id<>old.id or new.planning_version<>old.planning_version) then
   raise exception using errcode='23514',message='UUID и версия задачи управляются сервером.';
 end if;
 if tg_op='INSERT' and new.planning_version<>1 then raise exception using errcode='23514',message='Начальная версия задачи равна 1.'; end if;
 select mode,wip_mode into v_mode,v_wip from public.project_planning where project_id=new.project_id;
 if new.stage_id is not null and (tg_op='INSERT' or new.stage_id is distinct from old.stage_id) then
   select * into v_stage from public.project_stages where id=new.stage_id and project_id=new.project_id and archived_at is null;
   if not found then raise exception using errcode='23514',message='Этап недоступен или принадлежит другому проекту.'; end if;
   if tg_op='UPDATE' and new.status is distinct from old.status and new.status<>coalesce(v_stage.status_value,v_stage.category) then
     raise exception using errcode='23514',message='Этап и статус противоречат друг другу.';
   end if;
   new.status:=coalesce(v_stage.status_value,v_stage.category);
 elsif tg_op='INSERT' or new.status is distinct from old.status or new.stage_id is distinct from old.stage_id then
   select id into new.stage_id from public.project_stages where project_id=new.project_id and archived_at is null and coalesce(status_value,category)=new.status;
 end if;
 if tg_op='UPDATE' and v_mode<>'simple' and old.stage_id is not null and new.stage_id is null then
   raise exception using errcode='23514',message='Для задачи с этапом выберите активный этап процесса.';
 end if;
 if new.stage_id is not null then
   select * into v_stage from public.project_stages where id=new.stage_id and project_id=new.project_id and archived_at is null;
   if not found or new.status<>coalesce(v_stage.status_value,v_stage.category) then
     raise exception using errcode='23514',message='Этап и статус должны соответствовать друг другу.';
   end if;
   v_changed:=tg_op='INSERT' or new.stage_id is distinct from old.stage_id;
   if v_changed and v_mode<>'simple' and v_wip='strict' and v_stage.wip_limit is not null and new.status<>'done'
      and (select count(*) from public.tasks where stage_id=new.stage_id and id<>new.id and status<>'done')>=v_stage.wip_limit then
     raise exception using errcode='23514',message='Превышен строгий WIP-лимит этапа.';
   end if;
 end if;
 if new.status<>'done' then new.completed_at:=null;
 elsif tg_op='INSERT' or old.status<>'done' then new.completed_at:=statement_timestamp();
 elsif new.completed_at is distinct from old.completed_at then new.completed_at:=old.completed_at;
 end if;
 if tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then new.planning_version:=old.planning_version+1; end if;
 return new;
end $$;

do $acl$
declare r record;
begin
 for r in select oid,proname,proowner,oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
   and proname in ('reorder_project_stages','replace_project_lead','planning_claim_request_internal',
     'create_project_sprint_once','close_project_sprint_once','get_project_planning_request') loop
   if pg_get_userbyid(r.proowner)<>'postgres' then raise exception 'ER-012 integration: unexpected owner %',r.signature; end if;
   execute format('revoke all on function %s from public,anon,authenticated',r.signature);
   if r.proname<>'planning_claim_request_internal' then execute format('grant execute on function %s to authenticated',r.signature); end if;
   if has_function_privilege('anon',r.oid,'EXECUTE') or
     (r.proname='planning_claim_request_internal' and has_function_privilege('authenticated',r.oid,'EXECUTE')) then
     raise exception 'ER-012 integration: inherited EXECUTE prevents restriction of %',r.signature;
   end if;
 end loop;
 if has_table_privilege('authenticated','public.project_planning_requests','SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('anon','public.project_planning_requests','SELECT,INSERT,UPDATE,DELETE') then
   raise exception 'ER-012 integration: inherited access to private request receipts';
 end if;
 for r in select oid,oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and
   (proname like 'planning\_%\_internal' escape '\' or proname='append_project_activity_internal') loop
   if has_function_privilege('anon',r.oid,'EXECUTE') or has_function_privilege('authenticated',r.oid,'EXECUTE') then
     raise exception 'ER-012 integration: internal EXECUTE must remain closed: %',r.signature;
   end if;
 end loop;
end $acl$;
notify pgrst,'reload schema';
commit;
