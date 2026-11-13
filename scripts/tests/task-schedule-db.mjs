// Isolated PGlite only: no .env, HTTP, cloud clients or imports of the unverified draft.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
const read = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const schedule = read('20261112090000_task_schedule.sql')
const market = read('20261112091000_market_system_text.sql')
const diagnostic = readFileSync(new URL('../../supabase/diagnostics/ER-001-task-schedule.sql', import.meta.url), 'utf8')
const owner='00000000-0000-4000-8000-000000000001', member='00000000-0000-4000-8000-000000000002', stranger='00000000-0000-4000-8000-000000000003'
const start='2026-11-12T02:30:12.345Z', due='2026-11-14T11:00:56.789Z'
const q=async(sql,params=[]) => (await db.query(sql,params)).rows
const user=async(id,role=id?'authenticated':'postgres')=>{
 await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']); await db.exec(`set role ${role}`)
}
const admin=()=>user(null)
let passed=0
const check=async(name,fn)=>{await fn(); console.log('PASS',name); passed++}
const fails=async(fn,code)=>{await assert.rejects(fn,e=>{assert.equal(e.code,code);return true})}
const history=async()=>{await admin();return q('select * from project_activity order by id')}
const acl=()=>q(`select p.oid,p.proname,p.proowner,p.proacl::text,p.proconfig,p.prosecdef from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid`)
const internalRights=()=>q(`select proname,has_function_privilege('anon',oid,'EXECUTE') as anon,
 has_function_privilege('authenticated',oid,'EXECUTE') as authenticated from pg_proc
 where pronamespace='public'::regnamespace and proname in ('append_project_activity_internal',
 'trusted_activity_from_task','trusted_activity_from_contribution','trusted_activity_from_project_file','trusted_activity_from_profile_review') order by proname`)
let project, task, legacy
const taskRow=async()=> (await q('select * from tasks where id=$1',[task]))[0]
const reschedule=(oldStart,oldDue,newStart,newDue,id=task)=>q('select * from reschedule_task_secure($1,$2,$3,$4,$5)',[id,oldStart,oldDue,newStart,newDue])
try {
 await db.exec(`create publication supabase_realtime;
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,created_at timestamptz default now());
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;`)
 for(const name of ['20260823110236_baseline_public.sql','20260823110300_project_files_storage.sql','20261004090000_pilot_feedback.sql','20261004150000_recommendations.sql','20261019160000_startup_projects.sql','20261101090000_project_file_compression.sql','20261110090000_project_activity_execute.sql'])
   await db.exec(name.includes('baseline')?`begin;\n${read(name)}\ncommit;`:read(name))
 for(const id of [owner,member,stranger]){ await q('insert into auth.users(id) values($1)',[id]);await q("insert into profiles(user_id,display_name) values($1,'Local test')",[id]) }
 project=(await q("insert into listings(user_id,created_by,title,visibility) values($1,$1,'Local schedule','private') returning id",[owner]))[0].id
 await q("insert into applications(listing_id,user_id,status) values($1,$2,'accepted')",[project,member])
 await user(owner)
 task=(await q("insert into tasks(project_id,title,start_at,due_at) values($1,'аукцион — пользовательский текст',$2,$3) returning id",[project,start,due]))[0].id
 legacy=(await q("insert into tasks(project_id,title,start_at,due_at) values($1,'Legacy incompatible',$2,$3) returning *",[project,due,start]))[0]
 const before=await history(), beforeACL=await acl(), rights=await internalRights()
 await check('preflight reports incompatible existing row without returning user data',async()=>{
   const result=await db.exec(diagnostic);assert.equal(Number(result[1].rows[0].incompatible_date_order),1)
 })
 await check('migration keeps legacy rows and existing history; constraint is NOT VALID',async()=>{
   await db.exec(schedule); await db.exec(market)
   assert.deepEqual(await history(),before)
   assert.deepEqual((await q('select * from tasks where id=$1',[legacy.id]))[0],legacy)
   assert.equal((await q("select convalidated from pg_constraint where conname='tasks_schedule_order_check'"))[0].convalidated,false)
   assert.deepEqual((await acl()).filter(r=>beforeACL.some(b=>b.oid===r.oid)),beforeACL)
   assert.deepEqual(await internalRights(),rights)
   assert.ok(rights.every(r=>!r.anon&&!r.authenticated))
 })
 await check('member RPC preserves exact timestamps and writes one authored schedule event',async()=>{
   await user(member); await reschedule(start,due,start,'2026-11-15T11:00:56.789Z')
   const events=(await history()).filter(r=>r.type==='task_schedule_changed')
   assert.equal(events.length,1);assert.equal(events[0].actor_id,member)
   assert.equal(new Date(events[0].metadata.old_due_at).toISOString(),due)
   assert.equal(new Date(events[0].metadata.new_due_at).toISOString(),'2026-11-15T11:00:56.789Z')
   assert.equal(new Date((await taskRow()).start_at).toISOString(),start)
 })
 await check('no-op creates no event; sequential stale second editor gets PT409 without changes',async()=>{
   await user(owner); const current=await taskRow();const events=await history()
   await user(owner);await reschedule(current.start_at,current.due_at,current.start_at,current.due_at)
   await fails(()=>reschedule(start,due,start,due),'PT409')
   assert.deepEqual(await taskRow(),current);assert.deepEqual(await history(),events)
 })
 await check('owner can set null/null, start-only, due-only and equal endpoints',async()=>{
   for(const dates of [[null,null],[start,null],[null,due],[start,start]]){
     await user(owner);const old=await taskRow();await reschedule(old.start_at,old.due_at,...dates)
     const current=await taskRow();assert.equal(current.start_at?.toISOString()??null,dates[0]);assert.equal(current.due_at?.toISOString()??null,dates[1])
   }
 })
 await check('invalid range rejected by RPC, direct UPDATE and INSERT; no history survives',async()=>{
   const before=await history();await user(member);const old=await taskRow()
   await fails(()=>reschedule(old.start_at,old.due_at,due,start),'23514')
   await fails(()=>q('update tasks set start_at=$1,due_at=$2 where id=$3',[due,start,task]),'23514')
   await fails(()=>q("insert into tasks(project_id,title,start_at,due_at) values($1,'Invalid',$2,$3)",[project,due,start]),'23514')
   assert.deepEqual(await taskRow(),old);assert.deepEqual(await history(),before)
 })
 await check('legacy direct update creates one schedule event; status event is independent',async()=>{
   const before=await history();await user(member)
   await q("update tasks set due_at=$1,status='doing' where id=$2",[due,task])
   const added=(await history()).filter(r=>!before.some(b=>b.id===r.id))
   assert.deepEqual(added.map(r=>r.type).sort(),['task_schedule_changed','task_status_changed'])
   await user(member);await q("update tasks set status='done',completed_at=now() where id=$1",[task])
   const all=await history();assert.equal(all.filter(r=>r.type==='task_schedule_changed').length,before.filter(r=>r.type==='task_schedule_changed').length+1)
 })
 await check('guest, outsider, pending and revoked members cannot call RPC or directly update tasks',async()=>{
   for(const [id,role] of [[null,'anon'],[stranger,'authenticated']]){
     await user(id,role);await fails(()=>reschedule(start,due,start,due),'42501')
     assert.equal((await q('update tasks set due_at=null where id=$1 returning id',[task])).length,0)
   }
   await admin();await q("update applications set status='pending' where listing_id=$1 and user_id=$2",[project,member])
   await user(member);await fails(()=>reschedule(start,due,start,due),'42501')
   assert.equal((await q('update tasks set due_at=null where id=$1 returning id',[task])).length,0)
   await admin();await q('delete from applications where listing_id=$1 and user_id=$2',[project,member])
   await user(member);await fails(()=>reschedule(start,due,start,due),'42501')
   await admin();await q("insert into applications(listing_id,user_id,status) values($1,$2,'accepted')",[project,member])
 })
 await check('history cannot be written directly and internal EXECUTE remains closed',async()=>{
   for(const id of [owner,member,stranger]){
     await user(id);await fails(()=>q("insert into project_activity(project_id,type,title) values($1,'task_created','Not allowed')",[project]),'42501')
   }
   await admin();assert.deepEqual(await internalRights(),rights)
 })
 await check('transaction rollback undoes task change and schedule event together',async()=>{
   const before=await history();await user(member);const current=await taskRow()
   await db.exec('begin');await reschedule(current.start_at,current.due_at,null,null);await db.exec('rollback')
   assert.deepEqual(await taskRow(),current);assert.deepEqual(await history(),before)
 })
 await check('market changes only 46 literals; user history/title and function ACLs preserved',async()=>{
   const baseline=read('20260823110236_baseline_public.sql').replaceAll('\r\n','\n')
   const defs=[...market.matchAll(/create or replace function public\.(\w+)[\s\S]*?\$function\$;/g)]
   assert.equal(defs.length,9);let changes=0
   for(const d of defs){
     const pos=baseline.indexOf(`create or replace function public.${d[1]}`)
     const old=baseline.slice(pos,baseline.indexOf('$function$;',pos)+11)
     const literal=/'(?:''|[^'])*'/g
     assert.equal(old.replace(literal,"''"),d[0].replace(literal,"''"),'non-literal SQL changed')
     const a=old.match(literal),b=d[0].match(literal);assert.equal(a.length,b.length)
     changes+=a.filter((s,i)=>s!==b[i]).length
   }
   assert.equal(changes,46);assert.equal((await taskRow()).title,'аукцион — пользовательский текст')
   const originals=(await history()).filter(r=>before.some(b=>b.id===r.id));assert.deepEqual(originals,before)
 })
 await check('market RPC lifecycle and retries still create one real membership event',async()=>{
   await user(owner);const auction=(await q("insert into auctions(owner_id,type,title) values($1,'request','Local market') returning id",[owner]))[0].id
   await user(member);const bid=(await q('select * from save_auction_bid_secure($1,$2,100)',[member,auction]))[0].bid_id
   await user(owner);const accepted=(await q('select * from accept_auction_bid_secure($1,$2)',[owner,bid]))[0]
   assert.equal((await q('select * from accept_auction_bid_secure($1,$2)',[owner,bid]))[0].already_completed,true)
   const events=await q("select * from project_activity where project_id=$1 and type='project_member_added_via_auction'",[accepted.project_id])
   assert.equal(events.length,1);assert.match(events[0].title,/объявления/)
 })
 await check('completed project blocks RPC and direct task edits',async()=>{
   await user(owner)
   const closed=(await q("insert into listings(user_id,created_by,title,visibility) values($1,$1,'Completed test','private') returning id",[owner]))[0].id
   await admin();await q("insert into applications(listing_id,user_id,status) values($1,$2,'accepted')",[closed,member]);await user(owner)
   const previousTask=task
   task=(await q("insert into tasks(project_id,title,status) values($1,'Complete','done') returning id",[closed]))[0].id
   await q('update listings set completed_at=now() where id=$1',[closed]);const current=await taskRow()
   await fails(()=>reschedule(current.start_at,current.due_at,null,null),'P0001')
   await fails(()=>q('update tasks set due_at=null where id=$1',[task]),'P0001')
   task=previousTask
 })
 await check('repeat both migrations preserves data, ACLs and single history trigger',async()=>{
   const before=await history(), a=await acl();await db.exec(schedule);await db.exec(market)
   assert.deepEqual(await history(),before);assert.deepEqual(await acl(),a)
   assert.equal(Number((await q("select count(*) as n from pg_trigger where tgrelid='tasks'::regclass and tgfoid='trusted_activity_from_task()'::regprocedure"))[0].n),1)
   await db.exec(diagnostic)
 })
 console.log(`${passed} checks passed; PGlite in memory; no remote database contacted. Parallel multi-connection races are not modeled.`)
}catch(e){console.error(e);process.exitCode=1}finally{await db.close()}
