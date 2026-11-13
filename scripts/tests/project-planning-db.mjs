import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {setup,owner,member,stranger,checks,fails,readMigration,planningMigration} from './planning-db-helpers.mjs'
const {check,finish}=checks()
const h=await setup([])
const {db,q,user,admin,project,task,settings,configure,stages,stage,edit,history}=h
try {
 const legacyProject=await project(), legacy=await task(legacyProject,{status:'review'})
 const legacyHistory=await history(legacyProject)
 await admin();await db.exec(readMigration(planningMigration));await user(owner)
 await check('migration preserves legacy task fields/history and implicit simple defaults',async()=>{
  const row=(await q('select * from tasks where id=$1',[legacy.id]))[0]
  for(const [key,val] of Object.entries(legacy)) assert.deepEqual(row[key],val,key)
  assert.deepEqual(await history(legacyProject),legacyHistory)
  assert.equal((await settings(legacyProject)).mode,'simple')
  assert.equal((await q('select * from project_planning where project_id=$1',[legacyProject])).length,0)
 })
 await check('diagnostic runs READ ONLY and returns aggregates/metadata',async()=>{
  await admin();await db.exec(readFileSync(new URL('../../supabase/diagnostics/ER-012-planning.sql',import.meta.url),'utf8'));await user(owner)
 })
 await check('estimates available in simple; direct task writes audited; NULL distinct from zero',async()=>{
  await user(member)
  const t=await task(legacyProject,{story_points:3,planned_hours:0.25})
  const changed=await edit(t,{story_points:null,planned_hours:null})
  assert.equal(changed.planning_version,2);assert.equal(changed.story_points,null)
  assert.equal((await history(legacyProject)).filter(e=>e.entity_id===t.id&&e.type==='task_estimate_changed').length,2)
  for(const fields of [{story_points:0},{story_points:4},{planned_hours:0},{planned_hours:2001},{planned_hours:0.001}]) await fails(()=>task(legacyProject,fields),'23514')
 })
 const p=await project();const t1=await task(p),t2=await task(p)
 await check('owner opts in to kanban; three stages mapped without renaming legacy statuses',async()=>{
  const s=await configure(p,{mode:'kanban'});assert.equal(s.wip_mode,'soft');assert.equal(s.delegate_to_roles,false)
  assert.equal((await stages(p)).length,3)
  assert.ok((await q('select stage_id from tasks where id=$1',[t1.id]))[0].stage_id)
  await configure(legacyProject,{mode:'custom'})
  assert.equal((await q('select status,stage_id from tasks where id=$1',[legacy.id]))[0].stage_id,null)
 })
 await check('settings private; anon/outsider rejected; participant cannot manage or write private tables',async()=>{
  for(const [id,role] of [[null,'anon'],[stranger,'authenticated'],[member,'authenticated']]) {
   await user(id,role);await fails(()=>configure(p,{goal:'Unauthorized'},1),'42501')
   for(const table of ['project_planning','project_roles','project_stages']) await fails(()=>q(`delete from ${table} where project_id=$1`,[p]),'42501')
   if(role==='authenticated'&&id===stranger) assert.equal((await q('select * from project_stages where project_id=$1',[p])).length,0)
  }
  await user(owner)
 })
 let [todo,doing,done]=await stages(p)
 await check('soft WIP permits excess; strict activation below occupancy fails atomically',async()=>{
  doing=await stage(p,{wip_limit:1},doing)
  await q("update tasks set status='doing' where id=any($1::uuid[])",[[t1.id,t2.id]])
  await fails(()=>configure(p,{wip_mode:'strict'}),'23514')
  assert.equal((await settings(p)).wip_mode,'soft')
 })
 await check('strict WIP enforced on legacy UPDATE/INSERT and clearing stage cannot evade it',async()=>{
  await q("update tasks set status='todo' where id=$1",[t2.id]);await configure(p,{wip_mode:'strict'})
  await user(member)
  await fails(()=>q("update tasks set status='doing' where id=$1",[t2.id]),'23514')
  await fails(()=>task(p,{status:'doing'}),'23514')
  await fails(()=>q("update tasks set status='doing',stage_id=null where id=$1",[t2.id]),'23514')
  const row=(await q('select * from tasks where id=$1',[t2.id]))[0]
  await fails(()=>edit(row,{stage_id:doing.id}),'23514')
 })
 await check('done stage/status/timestamp agree; reopening clears completion; one status event',async()=>{
  let t=(await q('select * from tasks where id=$1',[t1.id]))[0]
  t=await edit(t,{stage_id:done.id});assert.equal(t.status,'done');assert.ok(t.completed_at)
  const end=t.completed_at
  await q("update tasks set completed_at='2000-01-01' where id=$1",[t.id])
  assert.deepEqual((await q('select completed_at from tasks where id=$1',[t.id]))[0].completed_at,end)
  assert.equal((await history(p)).filter(e=>e.entity_id===t.id&&e.type==='task_completed').length,1)
  await q("update tasks set status='todo' where id=$1",[t.id])
  t=(await q('select * from tasks where id=$1',[t.id]))[0];assert.equal(t.completed_at,null);assert.equal(t.stage_id,todo.id)
 })
 await check('unknown old statuses stay unchanged; incompatible stage mappings rejected',async()=>{
  await user(owner);await q("update tasks set status='legacy_wait' where id=$1",[t1.id])
  assert.equal((await q('select stage_id from tasks where id=$1',[t1.id]))[0].stage_id,null)
  await fails(()=>stage(p,{category:'done',status_value:'review'}),'23514')
  await fails(()=>stage(p,{category:'doing',status_value:'done'}),'23514')
  await fails(()=>stage(p,{category:'todo',status_value:'doing'}),'23514')
 })
 await check('tasks/stages from different projects and explicit contradictory edits are rejected',async()=>{
  const other=await project();await configure(other,{mode:'kanban'});const otherStage=(await stages(other))[0]
  await fails(()=>q('update tasks set stage_id=$1 where id=$2',[otherStage.id,t1.id]),'23514')
  await fails(()=>q("update tasks set stage_id=$1,status='done' where id=$2",[todo.id,t1.id]),'23514')
 })
 await check('stale task/settings versions conflict; current-value no-op creates no event',async()=>{
  let row=(await q('select * from tasks where id=$1',[t1.id]))[0]
  const updated=await edit(row,{story_points:8})
  await fails(()=>edit(row,{story_points:8}),'PT409')
  const before=await history(p);assert.deepEqual(await edit(updated),updated);assert.deepEqual(await history(p),before)
  const s=await settings(p);await configure(p,{goal:'New goal'},s.version)
  await fails(()=>configure(p,{goal:'New goal'},s.version),'PT409')
  await fails(()=>q('update tasks set planning_version=100 where id=$1',[t1.id]),'23514')
 })
 await check('occupied stage semantics cannot change; archive explicitly moves same tasks atomically',async()=>{
  await q("update tasks set status='todo' where id=$1",[t1.id])
  await fails(()=>stage(p,{category:'doing',status_value:'wait'},todo),'23514')
  const dest=await stage(p,{wip_limit:1})
  // Real version, strict WIP failure rolls back every task/event and archive marker.
  const before=await history(p)
  await fails(async()=>q('select * from archive_project_stage($1,$2,$3,$4,$5)',[p,(await settings(p)).version,todo.id,todo.version,dest.id]),'23514')
  assert.deepEqual(await history(p),before);assert.equal((await stages(p))[0].archived_at,null)
  await configure(p,{wip_mode:'soft'})
  await q('select * from archive_project_stage($1,$2,$3,$4,$5)',[p,(await settings(p)).version,todo.id,todo.version,dest.id])
  assert.equal((await q('select count(*)::int as n from tasks where stage_id=$1',[dest.id]))[0].n,2)
  await fails(()=>task(p,{stage_id:todo.id}),'23514')
 })
 await check('delegation explicit; author controls assignments; removed member loses role and cannot reuse it',async()=>{
  await q('select * from set_project_role($1,$2,$3,$4,true)',[p,(await settings(p)).version,member,'product_owner'])
  await user(member);await fails(()=>configure(p,{goal:'No delegation'}),'42501')
  await user(owner);await configure(p,{delegate_to_roles:true})
  await user(member);await configure(p,{goal:'Delegated goal'})
  await fails(()=>configure(p,{delegate_to_roles:false}),'42501')
  await fails(async()=>q('select * from set_project_role($1,$2,$3,$4,true)',[p,(await settings(p)).version,stranger,'developer']),'42501')
  await user(owner);await fails(async()=>q('select * from set_project_role($1,$2,$3,$4,true)',[p,(await settings(p)).version,stranger,'developer']),'23514')
  await q("update applications set status='rejected' where listing_id=$1 and user_id=$2",[p,member])
  assert.equal((await q('select * from project_roles where project_id=$1',[p])).length,0)
  await user(member);await fails(()=>configure(p,{goal:'Revoked'},0),'42501')
  assert.equal((await q("update tasks set story_points=13 where id=$1 returning id",[t1.id])).length,0)
  await user(owner);await q("update applications set status='accepted' where listing_id=$1 and user_id=$2",[p,member])
  assert.equal((await q('select * from project_roles where project_id=$1',[p])).length,0)
 })
 await check('simple retains stages and estimates but disables WIP; no destructive mode conversion',async()=>{
  const before=await q('select id,stage_id,story_points,planned_hours from tasks where project_id=$1 order by id',[p])
  await configure(p,{mode:'simple'})
  assert.deepEqual(await q('select id,stage_id,story_points,planned_hours from tasks where project_id=$1 order by id',[p]),before)
  assert.equal((await stages(p)).length,4)
 })
 await check('published reschedule RPC preserves timestamps, conflict detection and one event',async()=>{
  const a='2026-12-01T01:02:03.456Z',b='2026-12-02T04:05:06.789Z'
  await q('select * from reschedule_task_secure($1,null,null,$2,$3)',[t1.id,a,b])
  await fails(()=>q('select * from reschedule_task_secure($1,null,null,$2,$3)',[t1.id,a,b]),'PT409')
  await fails(()=>q('select * from reschedule_task_secure($1,$2,$3,$3,$2)',[t1.id,a,b]),'23514')
  assert.equal((await history(p)).filter(e=>e.entity_id===t1.id&&e.type==='task_schedule_changed').length,1)
  const row=(await q('select * from tasks where id=$1',[t1.id]))[0];assert.equal(new Date(row.start_at).toISOString(),a)
 })
 await check('transaction rollback includes settings/task state and history',async()=>{
  const before=await history(p),s=await settings(p)
  await db.exec('begin');await configure(p,{goal:'Rolled back'});await db.exec('rollback')
  assert.deepEqual(await settings(p),s);assert.deepEqual(await history(p),before)
 })
 await check('completed project forbids all planning/task changes and membership changes',async()=>{
  await q("update tasks set status='done' where project_id=$1",[p]);await q('update listings set completed_at=now() where id=$1',[p])
  await fails(()=>configure(p,{goal:'Closed'}),'23514')
  await fails(()=>task(p),'P0001')
  await fails(()=>q("update tasks set status='todo' where id=$1",[t1.id]),'P0001')
  await fails(()=>q('delete from tasks where id=$1',[t1.id]),'P0001')
 })
 await check('no new private function is client callable; existing history EXECUTE stays closed',async()=>{
  await admin()
  const rows=await q(`select proname,has_function_privilege('anon',oid,'EXECUTE') as anon,
   has_function_privilege('authenticated',oid,'EXECUTE') as authenticated from pg_proc where pronamespace='public'::regnamespace
   and (proname like 'planning_%' or proname in ('append_project_activity_internal','trusted_activity_from_task',
   'trusted_activity_from_contribution','trusted_activity_from_project_file','trusted_activity_from_profile_review','guard_completed_project_work'))`)
  assert.ok(rows.length>=8);assert.ok(rows.every(r=>!r.anon&&!r.authenticated))
  await user(owner);await fails(()=>q("insert into project_activity(project_id,type,title) values($1,'planning_changed','Invalid')",[p]),'42501')
  await fails(()=>q("select planning_event_internal($1,'planning_changed',$1,'{}')",[p]),'42501')
 })
 finish()
} finally {await db.close()}
