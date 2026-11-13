import assert from 'node:assert/strict'
import {setup,owner,member,stranger,checks,fails,planningMigration,sprintMigration} from './planning-db-helpers.mjs'
const {check,finish}=checks()
const {db,q,user,admin,project,task,settings,configure,edit,history}=await setup([planningMigration,sprintMigration])
const sprint=async(id)=>(await q('select * from project_sprints where id=$1',[id]))[0]
const current=async(id)=>(await q('select * from tasks where id=$1',[id]))[0]
const backlog=async(p)=>(await q('select get_project_backlog($1) as value',[p]))[0].value
const create=async(p,fields={},expected)=>{
 const s={name:'Synthetic sprint',goal:'Synthetic goal',start:'2026-12-01T01:02:03.456Z',end:'2026-12-15T04:05:06.789Z',...fields}
 return (await q('select * from create_project_sprint($1,$2,$3,$4,$5,$6)',[p,expected??(await settings(p)).version,s.name,s.goal,s.start,s.end]))[0]
}
const add=async(s,tasks)=>(await q('select * from add_tasks_to_sprint($1,$2,$3)',[s.id,s.version,JSON.stringify(tasks.map(t=>({task_id:t.id,expected_version:t.planning_version})))]))[0]
const start=async(s)=>(await q('select * from start_project_sprint($1,$2)',[s.id,s.version]))[0]
const close=async(s,decisions=[],cancel=false,reason=null)=>(await q('select * from close_project_sprint($1,$2,$3,$4,$5)',[s.id,s.version,cancel,reason,JSON.stringify(decisions)]))[0]
const events=async(id)=>q('select * from project_sprint_events where sprint_id=$1 order by id',[id])
try {
 const p=await project();await configure(p,{mode:'scrum'})
 const a=await task(p,{story_points:5,planned_hours:1.25}),b=await task(p),c=await task(p,{story_points:3,planned_hours:2.5})
 let s1,s2
 await check('backlog includes live unfinished tasks, stable order and independent version',async()=>{
  const bl=await backlog(p);assert.deepEqual(bl.tasks.map(t=>t.id).sort(),[a.id,b.id,c.id].sort());assert.equal(bl.version,3)
  const next=(await q('select reorder_project_backlog($1,$2,$3) as value',[p,bl.version,[c.id,a.id,b.id]]))[0].value
  assert.deepEqual(next.tasks.map(t=>t.id),[c.id,a.id,b.id]);assert.equal(next.version,4)
  const before=await history(p)
  await q('select reorder_project_backlog($1,$2,$3)',[p,next.version,[c.id,a.id,b.id]])
  assert.deepEqual(await history(p),before)
  await fails(()=>q('select reorder_project_backlog($1,$2,$3)',[p,bl.version,[c.id,a.id,b.id]]),'PT409')
 })
 await check('only owner/current Product Owner reorder; removed PO cannot restore access',async()=>{
  await user(member);const bl=await backlog(p)
  await fails(()=>q('select reorder_project_backlog($1,$2,$3)',[p,bl.version,[a.id,b.id,c.id]]),'42501')
  await user(owner);await q('select set_project_role($1,$2,$3,$4,true)',[p,(await settings(p)).version,member,'product_owner'])
  await user(member);await q('select reorder_project_backlog($1,$2,$3)',[p,bl.version,[a.id,b.id,c.id]])
  await user(owner);await q("update applications set status='rejected' where listing_id=$1 and user_id=$2",[p,member])
  await user(member);await fails(()=>backlog(p),'42501')
  await fails(()=>q('select reorder_project_backlog($1,$2,$3)',[p,bl.version,[a.id,b.id,c.id]]),'42501')
  await user(owner);await q("update applications set status='accepted' where listing_id=$1 and user_id=$2",[p,member])
 })
 await check('create checks mode, dates, permissions and expected container version',async()=>{
  const simple=await project();await fails(()=>create(simple),'23514')
  await fails(()=>create(p,{end:'2026-11-01'}),'23514')
  await user(member);await fails(async()=>create(p,{},(await settings(p)).version),'42501')
  await user(owner);const version=(await settings(p)).version
  s1=await create(p,{},version);assert.equal(s1.number,1)
  await fails(()=>create(p,{},version),'PT409');s2=await create(p,{name:'Destination'});assert.equal(s2.number,2)
 })
 await check('planned sprint scope accepts members; tasks excluded from backlog, no-op does not duplicate',async()=>{
  await user(member);s1=await add(s1,[a,b]);s2=await add(s2,[c]);assert.equal((await backlog(p)).tasks.length,0)
  const before=await events(s1.id);assert.deepEqual(await add(s1,[a,b]),s1);assert.deepEqual(await events(s1.id),before)
  await fails(()=>add(s2,[a]),'23514')
 })
 await check('cross-project/deleted/stale task references and mixed batch fail atomically',async()=>{
  const other=await project(),foreign=await task(other)
  await fails(()=>add(s1,[foreign]),'23514')
  const d=await task(p);const changed=await edit(d,{story_points:8})
  const deleted=await task(p);await q('delete from tasks where id=$1',[deleted.id]);await fails(()=>add(s1,[deleted]),'23514')
  await fails(()=>add(s1,[d]),'PT409')
  await fails(()=>add(s1,[changed,foreign]),'23514')
  assert.equal((await backlog(p)).tasks.length,1)
 })
 await check('start snapshots scope and NULL estimates; one active sprint enforced',async()=>{
  s1=await start(s1);assert.equal(s1.state,'active')
  assert.equal(s1.start_snapshot.totals.tasks,2);assert.equal(s1.start_snapshot.totals.story_points,5)
  assert.equal(s1.start_snapshot.totals.planned_hours,1.25);assert.equal(s1.start_snapshot.totals.unestimated_points,1)
  assert.equal(new Date(s1.start_at).toISOString(),'2026-12-01T01:02:03.456Z')
  await fails(()=>start(s2),'23514')
  await fails(()=>configure(p,{mode:'kanban'}),'23514')
  const before=await events(s1.id);assert.deepEqual(await start(s1),s1);assert.deepEqual(await events(s1.id),before)
 })
 await check('active scope/removal/task deletion require manager; legacy edits still allowed/audited',async()=>{
  await user(member);const extra=await task(p)
  await fails(()=>add(s1,[extra]),'42501')
  await fails(()=>q('select remove_task_from_sprint($1,$2,$3,$4)',[s1.id,s1.version,a.id,a.planning_version]),'42501')
  await fails(()=>q('delete from tasks where id=$1',[a.id]),'42501')
  const initial=s1.start_snapshot
  await q("update tasks set status='done',story_points=8,planned_hours=4.5 where id=$1",[a.id])
  const now=await sprint(s1.id);assert.equal(now.version,s1.version+1);assert.deepEqual(now.start_snapshot,initial)
  assert.equal((await events(s1.id)).filter(e=>e.kind==='task_changed').length,1)
  await fails(()=>close(s1,[]),'42501')
  await user(owner);await fails(()=>close(s1,[]),'PT409');s1=now
 })
 await check('close requires exact decisions and current destination version; failures preserve all state',async()=>{
  const before=await events(s1.id)
  await fails(()=>close(s1,[]),'23514')
  await fails(()=>close(s1,[{task_id:b.id,destination:'backlog'},{task_id:a.id,destination:'backlog'}]),'23514')
  await fails(()=>close(s1,[{task_id:b.id,destination:'backlog'},{task_id:b.id,destination:'backlog'}]),'23514')
  await fails(()=>close(s1,[{task_id:b.id,destination:'sprint',sprint_id:s2.id,expected_sprint_version:s2.version-1}]),'PT409')
  assert.deepEqual(await events(s1.id),before);assert.deepEqual(await sprint(s1.id),s1)
 })
 await check('completion transfers same UUID and preserves final snapshots with separate points/hours',async()=>{
  const beforeCount=(await q('select count(*)::int as n from tasks where project_id=$1',[p]))[0].n
  s1=await close(s1,[{task_id:b.id,destination:'sprint',sprint_id:s2.id,expected_sprint_version:s2.version}])
  assert.equal(s1.state,'completed');assert.equal(s1.final_snapshot.completed.tasks,1)
  assert.equal(s1.final_snapshot.completed.story_points,8);assert.equal(s1.final_snapshot.completed.planned_hours,4.5)
  assert.equal(s1.final_snapshot.totals.unestimated_hours,1)
  assert.equal((await q('select count(*)::int as n from tasks where project_id=$1',[p]))[0].n,beforeCount)
  const moved=(await q("select * from project_sprint_items where sprint_id=$1 and task_id=$2",[s1.id,b.id]))[0]
  assert.equal(moved.outcome,'moved');assert.equal(moved.destination_sprint_id,s2.id)
  assert.equal((await q('select * from project_sprint_items where sprint_id=$1 and live_task_id=$2 and removed_at is null',[s2.id,b.id])).length,1)
  s2=await sprint(s2.id)
 })
 await check('sprint edits require versions, preserve exact dates, no-op leaves audit unchanged',async()=>{
  const before=await events(s2.id)
  const update=(s,name=s.name,start=s.start_at,end=s.end_at)=>q('select * from update_project_sprint($1,$2,$3,$4,$5,$6)',[s.id,s.version,name,s.goal,start,end])
  await update(s2);assert.deepEqual(await events(s2.id),before)
  await user(member);await fails(()=>update(s2,'Not allowed'),'42501');await user(owner)
  await fails(()=>update(s2,s2.name,s2.end_at,s2.start_at),'23514')
  const old=s2;s2=(await update(s2,'Updated destination'))[0]
  assert.equal(s2.version,old.version+1);assert.deepEqual(s2.start_at,old.start_at)
  await fails(()=>update(old,'Updated destination'),'PT409')
 })
 await check('closed results survive reopening, re-estimation and task deletion',async()=>{
  const result=s1.final_snapshot,startResult=s1.start_snapshot,log=await events(s1.id)
  await q("update tasks set status='todo',story_points=21,planned_hours=null where id=$1",[a.id])
  assert.ok((await backlog(p)).tasks.some(t=>t.id===a.id))
  await q('delete from tasks where id=$1',[a.id])
  const after=await sprint(s1.id);assert.deepEqual(after.final_snapshot,result);assert.deepEqual(after.start_snapshot,startResult)
  assert.deepEqual(await events(s1.id),log)
  const old=(await q('select * from project_sprint_items where sprint_id=$1 and task_id=$2',[s1.id,a.id]))[0]
  assert.equal(old.live_task_id,null);assert.equal(old.outcome,'done');assert.equal(old.exit_snapshot.story_points,8)
  await fails(()=>q('select update_project_sprint($1,$2,$3,$4,$5,$6)',[s1.id,after.version,'Rewrite','',after.start_at,after.end_at]),'23514')
  await fails(()=>close(after,[]),'23514')
 })
 await check('active removal/re-addition retains scope history without changing original start snapshot',async()=>{
  s2=await start(s2);const baseline=s2.start_snapshot
  const t=await current(c.id)
  s2=(await q('select * from remove_task_from_sprint($1,$2,$3,$4)',[s2.id,s2.version,t.id,t.planning_version]))[0]
  assert.ok((await backlog(p)).tasks.some(t=>t.id===c.id))
  s2=await add(s2,[t]);assert.deepEqual(s2.start_snapshot,baseline)
  const membership=await q('select * from project_sprint_items where sprint_id=$1 and task_id=$2',[s2.id,c.id])
  assert.equal(membership.length,2);assert.equal(membership.filter(i=>i.outcome==='removed').length,1)
 })
 await check('deleted active tasks retain their last values and bump sprint version',async()=>{
  const before=s2.version;await q('delete from tasks where id=$1',[c.id]);s2=await sprint(s2.id)
  assert.equal(s2.version,before+1)
  const removed=(await q("select * from project_sprint_items where sprint_id=$1 and task_id=$2 and outcome='deleted'",[s2.id,c.id]))[0]
  assert.equal(removed.live_task_id,null);assert.equal(removed.exit_snapshot.story_points,3)
  assert.equal((await events(s2.id)).filter(e=>e.kind==='task_deleted').length,1)
 })
 await check('cancellation requires reason and decisions; no auto-completion; graphs keep deletions',async()=>{
  await fails(()=>close(s2,[{task_id:b.id,destination:'backlog'}],true,''),'23514')
  await fails(()=>close(s2,[],true,'Cancelled by owner'),'23514')
  s2=await close(s2,[{task_id:b.id,destination:'backlog'}],true,'Cancelled by owner')
  assert.equal(s2.state,'cancelled');assert.equal((await current(b.id)).status,'todo')
  assert.ok((await backlog(p)).tasks.some(t=>t.id===b.id))
  assert.ok(s2.final_snapshot.items.some(i=>i.outcome==='deleted'))
  assert.equal(s2.final_snapshot.totals.story_points,null);assert.equal(s2.final_snapshot.totals.unestimated_points,1)
 })
 await check('planned cancellation works after leaving scrum; estimates and history retained',async()=>{
  let planned=await create(p,{start:null,end:null})
  planned=await add(planned,[await current(b.id)])
  await fails(()=>start(planned),'23514')
  await configure(p,{mode:'simple'})
  planned=await close(planned,[{task_id:b.id,destination:'backlog'}],true,'No longer using scrum')
  assert.equal(planned.start_snapshot,null);assert.equal(planned.final_snapshot.totals.unestimated_points,1)
  assert.ok((await backlog(p)).tasks.some(t=>t.id===b.id))
 })
 await check('snapshot/event writes roll back together with close and transfers',async()=>{
  await configure(p,{mode:'scrum'});let s=await create(p);s=await add(s,[await current(b.id)]);s=await start(s)
  const before=await events(s.id)
  await db.exec('begin');await close(s,[{task_id:b.id,destination:'backlog'}]);await db.exec('rollback')
  assert.deepEqual(await sprint(s.id),s);assert.deepEqual(await events(s.id),before)
  await close(s,[{task_id:b.id,destination:'backlog'}])
 })
 await check('cross-project transfer rejected; active target rejected; delegated manager can close',async()=>{
  const other=await project();await configure(other,{mode:'scrum'});let otherSprint=await create(other);const foreign=await task(other)
  otherSprint=await add(otherSprint,[foreign]);otherSprint=await start(otherSprint)
  let s=await create(p);s=await add(s,[await current(b.id)]);s=await start(s)
  await fails(()=>close(s,[{task_id:b.id,destination:'sprint',sprint_id:otherSprint.id,expected_sprint_version:otherSprint.version}]),'23514')
  await fails(()=>close(s,[{task_id:b.id,destination:'sprint',sprint_id:s.id,expected_sprint_version:s.version}]),'23514')
  await q('select set_project_role($1,$2,$3,$4,true)',[p,(await settings(p)).version,member,'scrum_master'])
  await configure(p,{delegate_to_roles:true})
  await user(member);s=await close(s,[{task_id:b.id,destination:'backlog'}]);assert.equal(s.state,'completed')
  await q("update applications set status='rejected' where listing_id=$1 and user_id=$2",[p,member])
  await fails(()=>backlog(p),'42501')
  await user(owner);assert.equal((await q('select * from project_roles where project_id=$1',[p])).length,0)
  await q("update applications set status='accepted' where listing_id=$1 and user_id=$2",[p,member])
 })
 await check('project cannot close with active sprint even if all tasks done',async()=>{
  let s=await create(p);s=await add(s,[await current(b.id)]);s=await start(s)
  await q("update tasks set status='done' where project_id=$1",[p])
  await fails(()=>q('update listings set completed_at=now() where id=$1',[p]),'23514')
  s=await close(await sprint(s.id),[])
  await q('update listings set completed_at=now() where id=$1',[p])
  await fails(()=>create(p),'23514');assert.equal((await backlog(p)).tasks.length,0)
 })
 await check('new tables and history private; anon/outsider cannot read/call/mutate',async()=>{
  for(const table of ['project_backlogs','project_sprints','project_sprint_items','project_sprint_events']) {
   await user(owner);await fails(()=>q(`delete from ${table} where project_id=$1`,[p]),'42501')
   await user(stranger);assert.equal((await q(`select * from ${table} where project_id=$1`,[p])).length,0)
  }
  await fails(()=>backlog(p),'42501');await fails(()=>start(s1),'42501')
  await user(null,'anon');await fails(()=>backlog(p),'42501');await fails(()=>start(s1),'42501')
  await admin();const rights=await q(`select proname,has_function_privilege('anon',oid,'EXECUTE') as anon,
   has_function_privilege('authenticated',oid,'EXECUTE') as authenticated from pg_proc where pronamespace='public'::regnamespace
   and (proname like 'planning_%' or proname in ('append_project_activity_internal','trusted_activity_from_task'))`)
  assert.ok(rights.every(r=>!r.anon&&!r.authenticated))
 })
 finish()
} finally {await db.close()}
