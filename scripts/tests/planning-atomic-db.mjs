// Only synthetic in-memory PGlite. No env, network, cloud clients or draft test.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setup, readMigration, planningMigration, sprintMigration, atomicMigration, owner, member, stranger, checks, fails } from './planning-db-helpers.mjs'
const env=await setup([planningMigration,sprintMigration])
const {q,user,admin,project,task,configure,settings,stages,stage,edit,history}=env
const {check,finish}=checks()
const one=async(sql,args)=>(await q(sql,args))[0]
const fresh=async(t)=>one('select * from tasks where id=$1',[t.id])
const order=async(p,ids,version)=>(await q('select * from reorder_project_stages($1,$2,$3)',[p,version??(await settings(p)).version,ids]))[0]
const lead=async(p,who,role='product_owner',version)=>one('select * from replace_project_lead($1,$2,$3,$4)',[p,version??(await settings(p)).version,role,who])
const create=async(p,key,version,name='Same name')=>one('select * from create_project_sprint_once($1,$2,$3,$4,$5,$6,$7)',[key,p,version,name,'Synthetic goal',null,null])
const receipt=async(p,key)=>(await one('select get_project_planning_request($1,$2) r',[p,key])).r
const close=async(s,key,decisions=[],version=s.version)=>one('select * from close_project_sprint_once($1,$2,$3,$4,$5,$6)',[key,s.id,version,true,'Synthetic cancellation',JSON.stringify(decisions)])
try {
 await check('new migration preserves existing task rows and history byte-for-byte as JSON',async()=>{
   const p=await project();await task(p,{status:'legacy'});await task(p,{status:'done',story_points:5})
   const before=await q('select to_jsonb(t) row from tasks t order by id'), h=await history(p)
   await admin()
   const diagnostic=readFileSync(new URL('../../supabase/diagnostics/ER-012-ui-integration.sql',import.meta.url),'utf8')
   await env.db.exec(diagnostic);await env.db.exec(readMigration(atomicMigration));await env.db.exec(diagnostic);await user(owner)
   assert.deepEqual(await q('select to_jsonb(t) row from tasks t order by id'),before);assert.deepEqual(await history(p),h)
 })
 await check('choosing Kanban does not assign legacy tasks',async()=>{
   const p=await project(), t=await task(p,{status:'review'}), t2=await task(p,{status:'todo'})
   const before=await fresh(t), b2=await fresh(t2)
   await configure(p,{mode:'kanban'})
   assert.deepEqual(await fresh(t),before); assert.deepEqual(await fresh(t2),b2)
   const changed=await edit(t,{story_points:3});assert.equal(changed.stage_id,null);assert.equal(changed.status,'review')
 })
 await check('explicit stage move keeps dates/estimates, status/completion and emits one stage event; stale version refused',async()=>{
   const p=await project();await configure(p,{mode:'custom'})
   const review=await stage(p,{wip_limit:1}), done=(await stages(p)).find(s=>s.category==='done')
   const t=await task(p,{status:'legacy',story_points:5,start_at:'2026-12-01T04:15:13Z',due_at:'2026-12-02T09:12:17Z'})
   const count=(await history(p)).filter(e=>e.type==='task_stage_changed').length, moved=await edit(t,{stage_id:review.id})
   assert.equal(moved.status,'review');assert.equal(moved.stage_id,review.id);assert.equal(moved.completed_at,null)
   assert.equal(moved.story_points,5);assert.deepEqual([moved.start_at,moved.due_at],[t.start_at,t.due_at])
   assert.equal((await history(p)).filter(e=>e.type==='task_stage_changed').length,count+1)
   await fails(()=>edit(t,{stage_id:done.id}),'PT409')
   const complete=await edit(moved,{stage_id:done.id});assert.equal(complete.status,'done');assert.ok(complete.completed_at)
   const reopened=await edit(complete,{stage_id:review.id});assert.equal(reopened.completed_at,null)
 })
 await check('strict WIP on RPC and old UPDATE/INSERT; clearing stage/unmapped status cannot escape an assigned workflow',async()=>{
   const p=await project();await configure(p,{mode:'kanban',wip_mode:'strict'})
   const review=await stage(p,{wip_limit:1}), a=await task(p,{stage_id:review.id}), b=await task(p,{status:'todo'})
   const before=await fresh(b), h=await history(p)
   await fails(()=>edit(b,{stage_id:review.id}),'23514')
   await fails(()=>q("update tasks set status='review' where id=$1",[b.id]),'23514')
   await fails(()=>task(p,{status:'review'}),'23514')
   await fails(()=>q("update tasks set stage_id=null,status='escape' where id=$1",[a.id]),'23514')
   assert.deepEqual(await fresh(b),before);assert.deepEqual(await history(p),h)
   await q('update tasks set stage_id=null where id=$1',[a.id]);assert.equal((await fresh(a)).stage_id,review.id)
 })
 await check('soft WIP permits excess, simple remains compatible, unknown legacy tasks stay visible without a stage',async()=>{
   const p=await project();await configure(p,{mode:'kanban'});const review=await stage(p,{wip_limit:1})
   await task(p,{stage_id:review.id});await task(p,{stage_id:review.id})
   await fails(()=>configure(p,{wip_mode:'strict'}),'23514')
   await configure(p,{mode:'simple',wip_mode:'strict'})
   const a=await task(p,{stage_id:review.id});await q("update tasks set status='old-other' where id=$1",[a.id])
   assert.equal((await fresh(a)).stage_id,null)
 })
 await check('existing Gantt schedule RPC preserves stage/status, exact seconds, CAS and one schedule event',async()=>{
   const p=await project();await configure(p,{mode:'kanban'})
   const t=await task(p,{status:'doing',start_at:'2026-12-01T04:15:13.123Z',due_at:'2026-12-02T09:12:17.456Z'})
   const args=[t.id,t.start_at,t.due_at,'2026-12-02T04:15:13.123Z','2026-12-03T09:12:17.456Z']
   await user(member);const result=await one('select * from reschedule_task_secure($1,$2,$3,$4,$5)',args)
   assert.equal(result.stage_id,t.stage_id);assert.equal(result.status,t.status)
   assert.equal(new Date(result.start_at).toISOString(),args[3]);assert.equal(new Date(result.due_at).toISOString(),args[4])
   await fails(()=>q('select reschedule_task_secure($1,$2,$3,$4,$5)',args),'PT409')
   const events=(await history(p)).filter(e=>e.type==='task_schedule_changed')
   assert.equal(events.length,1);assert.equal(events[0].actor_id,member);await user(owner)
 })
 await check('rights, revoked membership, project boundary and archived stage enforced by task RPC and direct DML',async()=>{
   const p=await project(), p2=await project();await configure(p,{mode:'kanban'});await configure(p2,{mode:'kanban'})
   const t=await task(p,{status:'legacy'}), ss=await stages(p), other=(await stages(p2))[0]
   await fails(()=>edit(t,{stage_id:other.id}),'23514')
   await q('select archive_project_stage($1,$2,$3,$4,null)',[p,(await settings(p)).version,ss[0].id,ss[0].version])
   await fails(()=>edit(t,{stage_id:ss[0].id}),'23514')
   await user(stranger);await fails(()=>edit(t,{stage_id:ss[1].id}),'42501')
   assert.equal((await q("update tasks set status='doing' where id=$1 returning id",[t.id])).length,0)
   await user(null,'anon');await fails(()=>edit(t,{stage_id:ss[1].id}),'42501')
   await user(member);const changed=await edit(t,{stage_id:ss[1].id});assert.equal(changed.stage_id,ss[1].id)
   await user(owner);await q("update applications set status='rejected' where listing_id=$1 and user_id=$2",[p,member])
   await user(member);await fails(()=>edit(changed,{story_points:5}),'42501');await user(owner)
 })
 await check('stage reorder: complete set, CAS, no-op, one history event and no temporary positions',async()=>{
   const p=await project();await configure(p,{mode:'kanban'});const ss=await stages(p), ids=ss.map(s=>s.id), v=(await settings(p)).version, h=(await history(p)).length
   await fails(()=>order(p,[ids[0],ids[0],ids[1]],v),'23514')
   await fails(()=>order(p,ids.slice(1),v),'PT409')
   const next=await order(p,ids.slice().reverse(),v)
   assert.deepEqual((await stages(p)).map(s=>s.id),ids.slice().reverse());assert.deepEqual((await stages(p)).map(s=>s.position),[0,1,2])
   assert.equal(next.version,v+1);assert.equal((await history(p)).length,h+1)
   assert.equal((await order(p,ids.slice().reverse(),next.version)).version,next.version)
   await fails(()=>order(p,ids,v),'PT409')
   await user(member);await fails(()=>order(p,ids,next.version),'42501');await user(owner)
 })
 await check('lead replacement: one transaction/version/event, both unique roles and current membership',async()=>{
   const p=await project();await configure(p,{mode:'scrum'});await lead(p,member)
   const v=(await settings(p)).version, h=(await history(p)).length
   await fails(()=>lead(p,stranger),'23514')
   assert.equal((await q("select user_id from project_roles where project_id=$1 and role='product_owner'",[p]))[0].user_id,member)
   const changed=await lead(p,owner);assert.equal(changed.version,v+1);assert.equal((await history(p)).length,h+1)
   await fails(()=>lead(p,member,'product_owner',v),'PT409')
   await lead(p,member,'scrum_master');await lead(p,owner,'scrum_master')
   await user(member);await fails(()=>lead(p,member),'42501');await user(owner)
   const before=(await settings(p)).version;assert.equal((await lead(p,owner,'scrum_master')).version,before)
   await lead(p,null);assert.equal((await q("select * from project_roles where project_id=$1 and role='product_owner'",[p])).length,0)
 })
 await check('failure while writing history rolls back entire reorder and lead replacement',async()=>{
   const p=await project();await configure(p,{mode:'kanban'});await lead(p,member)
   const before=await stages(p), v=await settings(p), roles=await q('select * from project_roles where project_id=$1',[p]), h=await history(p)
   await admin();await env.db.exec("create function public.test_history_failure() returns trigger language plpgsql as $$begin raise exception using errcode='23514',message='synthetic history failure';end$$; create trigger test_history_failure before insert on public.project_activity for each row execute function public.test_history_failure();")
   await user(owner)
   try { await fails(()=>order(p,before.map(s=>s.id).reverse()),'23514');await fails(()=>lead(p,owner),'23514') }
   finally {await admin();await env.db.exec('drop trigger test_history_failure on public.project_activity;drop function public.test_history_failure();');await user(owner)}
   assert.deepEqual(await stages(p),before);assert.deepEqual(await settings(p),v);assert.deepEqual(await history(p),h)
   assert.deepEqual(await q('select * from project_roles where project_id=$1',[p]),roles)
 })
 await check('lost create response: exact retry returns original result, no duplicate/event/version; equal names remain distinct intents',async()=>{
   const p=await project();await configure(p,{mode:'scrum'});const key=randomUUID(), v=(await settings(p)).version
   const first=await create(p,key,v); // Simulate discarding a committed response.
   const h=await history(p), after=await settings(p)
   assert.deepEqual(await create(p,key,v),first);assert.deepEqual(await settings(p),after);assert.deepEqual(await history(p),h)
   assert.equal((await receipt(p,key)).result.id,first.id)
   const second=await create(p,randomUUID(),after.version);assert.notEqual(second.id,first.id)
   assert.equal(await receipt(p,randomUUID()),null)
 })
 await check('request identity bound to actor, project, all arguments and operation kind',async()=>{
   const p=await project(), p2=await project();await configure(p,{mode:'scrum',delegate_to_roles:true});await configure(p2,{mode:'scrum'})
   await lead(p,member);const key=randomUUID(), v=(await settings(p)).version,s=await create(p,key,v)
   await fails(()=>create(p,key,v,'Other name'),'22023');await fails(()=>create(p,key,v+1),'22023')
   await fails(()=>create(p2,key,(0)),'22023')
   await user(member);await fails(()=>create(p,key,v),'22023');await fails(()=>receipt(p,key),'42501');await user(owner)
   await fails(()=>receipt(p2,key),'42501');await fails(()=>close(s,key),'22023')
   assert.equal((await receipt(p,key)).result.id,s.id)
 })
 await check('failed operation creates neither a receipt nor sprint/history',async()=>{
   const p=await project();await configure(p,{mode:'scrum'});const key=randomUUID(), h=await history(p), v=await settings(p)
   await fails(()=>create(p,key,v.version-1),'PT409');assert.equal(await receipt(p,key),null)
   assert.deepEqual(await history(p),h);assert.deepEqual(await settings(p),v)
   assert.equal((await q('select * from project_sprints where project_id=$1',[p])).length,0)
 })
 await check('close receipt proves exact operation; retry does not change immutable snapshots even after task edits/deletion',async()=>{
   const p=await project();await configure(p,{mode:'scrum'});const t=await task(p,{story_points:5}), s=await create(p,randomUUID(),(await settings(p)).version)
   const added=await one('select * from add_tasks_to_sprint($1,$2,$3)',[s.id,s.version,JSON.stringify([{task_id:t.id,expected_version:t.planning_version}])])
   const key=randomUUID(), decisions=[{task_id:t.id,destination:'backlog'}], closed=await close(added,key,decisions), h=await history(p)
   assert.deepEqual(await close(added,key,decisions),closed);assert.deepEqual(await history(p),h)
   assert.equal((await receipt(p,key)).kind,'close_sprint');assert.deepEqual((await receipt(p,key)).result.final_snapshot,closed.final_snapshot)
   await edit(await fresh(t),{story_points:13});await q('delete from tasks where id=$1',[t.id])
   assert.deepEqual((await one('select * from project_sprints where id=$1',[s.id])).final_snapshot,closed.final_snapshot)
   assert.deepEqual((await receipt(p,key)).result.final_snapshot,closed.final_snapshot)
   await fails(()=>close(added,key,[]),'22023')
 })
 await check('closed project refuses new operations; own receipt remains readable; removed member loses access',async()=>{
   const p=await project();await configure(p,{mode:'scrum',delegate_to_roles:true});await lead(p,member)
   await user(member);const memberKey=randomUUID();await create(p,memberKey,(await settings(p)).version)
   await user(owner);await q("update applications set status='rejected' where listing_id=$1 and user_id=$2",[p,member])
   await user(member);await fails(()=>receipt(p,memberKey),'42501');await user(owner)
   await q("update applications set status='accepted' where listing_id=$1 and user_id=$2",[p,member])
   const key=randomUUID();await create(p,key,(await settings(p)).version)
   await q('update listings set completed_at=now() where id=$1',[p])
   const version=(await settings(p)).version, ids=(await stages(p)).map(s=>s.id)
   await fails(()=>create(p,randomUUID(),version),'23514');assert.ok(await receipt(p,key))
   await fails(()=>lead(p,member),'23514');await fails(()=>order(p,ids),'23514')
 })
 await check('private receipts/internal history stay inaccessible; only explicit new RPCs executable',async()=>{
   await user(owner);await fails(()=>q('select * from project_planning_requests'),'42501')
   await fails(()=>q("insert into project_activity(project_id,type,title) values(gen_random_uuid(),'stage_changed','forged')"),'42501')
   await admin()
   const internals=await q("select proname,has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') u from pg_proc where pronamespace='public'::regnamespace and (proname like 'planning_%_internal' or proname='append_project_activity_internal')")
   assert.ok(internals.length>5);assert.ok(internals.every(r=>!r.a&&!r.u))
   for(const name of ['reorder_project_stages','replace_project_lead','create_project_sprint_once','close_project_sprint_once','get_project_planning_request']) {
     const r=await one("select has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') u from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]);assert.deepEqual(r,{a:false,u:true})
   }
 })
} catch(error) {console.error('FAIL',error.code||'',error.message);process.exitCode=1}
finally {await env.db.close()}
finish()
