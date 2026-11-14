// Minimal synthetic PostgreSQL 17 + PostgREST. Existing local images ONLY.
// Internal isolated network, API bound to 127.0.0.1:3018. No env files, cloud,
// external volumes, full Supabase, image downloads or existing ER-007 containers.
// Own containers are stopped (not removed); their new /tmp PG data is retained.
// Current verification is INCOMPLETE: schema bootstrap succeeded, HTTP readiness
// did not; none of the six HTTP scenarios below passed. See ER-012-ui-integration.md.
// node --import tsx scripts/tests/planning-postgrest.mjs
import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { bootstrap, migrations, planningMigration, sprintMigration, atomicMigration, readMigration, owner, member, stranger } from './planning-db-helpers.mjs'
import * as P from '../../src/lib/planning.ts'
const suffix = Date.now(), pg = `er012-ui-pg-${suffix}`, rest = `er012-ui-rest-${suffix}`, network = `er012-ui-${suffix}`
const pgImage = 'public.ecr.aws/supabase/postgres:17.6.1.166', restImage = 'postgrest/postgrest:v14.18'
const url = 'http://127.0.0.1:3018', secret = 'er012-synthetic-local-jwt-not-production', report = [], owned = []
const pause = ms => new Promise(r=>setTimeout(r,ms))
const log = text => {report.push(text);console.log(text)}
function docker(args,input='') {
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err=''
  child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);child.stdin.on('error',()=>{})
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(`docker ${args[0]} failed: ${err.slice(-1600)}`)));child.stdin.end(input)
 })
}
const sql = text => docker(['exec','-i',pg,'psql','-h','/tmp','-U','postgres','-d','synthetic','-X','-qAt','-v','ON_ERROR_STOP=1'],text)
const asUser = text => `set request.jwt.claim.sub='${owner}';set role authenticated;${text}`
function token(user) {
 const body=[{alg:'HS256',typ:'JWT'},{role:'authenticated',sub:user,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
 return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`
}
async function request(path,args,user=owner,method='POST') {
 const response=await fetch(`${url}/${path}`,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${token(user)}`}:{})},...(args===undefined?{}:{body:JSON.stringify(args)}),signal:AbortSignal.timeout(15000)})
 const text=await response.text();const data=text?JSON.parse(text):null
 return {status:response.status,data,error:response.ok?null:data}
}
const db = user => ({rpc:async(fn,args)=>{const r=await request(`rpc/${fn}`,args,user);return {data:r.error?null:r.data,error:r.error}},select:()=>{throw new Error('Use explicit REST reads in this harness')}})
const ok = r => {assert.ok(r.ok,JSON.stringify(r));return r.data}
async function check(name,fn){await fn();log(`PASS ${name}`)}
const p=randomUUID(),p2=randomUUID(),a=randomUUID(),b=randomUUID()
let stages,settings
try {
 for(const image of [pgImage,restImage]) await docker(['image','inspect','--format','{{.Id}}',image])
 await docker(['network','create','--internal','--label','experts-nearby.task=er012-ui',network])
 await docker(['create','--pull','never','--name',pg,'--label','experts-nearby.task=er012-ui','--memory','512m','--cpus','1','--network',network,
 '--user','postgres','--entrypoint','/bin/bash',pgImage,'-ec',
 'initdb -D /tmp/er012-ui-data -A trust -U postgres --no-locale --encoding=UTF8 >/tmp/initdb.log\nprintf "host all all all trust\\n" >> /tmp/er012-ui-data/pg_hba.conf\nexec postgres -D /tmp/er012-ui-data -c shared_preload_libraries= -c shared_buffers=64MB -c max_connections=16 -c work_mem=4MB -c unix_socket_directories=/tmp -c listen_addresses=0.0.0.0'])
 owned.push(pg);await docker(['start',pg])
 let ready=false
 for(let i=0;i<30;i++){try {await docker(['exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break}catch{await pause(300)}}
 assert.ok(ready,'PG startup failed; do not retry launch without investigating')
 await docker(['exec',pg,'createdb','-h','/tmp','-U','postgres','synthetic'])
 await sql(bootstrap)
 await sql(`create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create role authenticator login noinherit;grant anon,authenticated to authenticator;`)
 for(const name of [...migrations,planningMigration,sprintMigration,atomicMigration]) await sql(name.includes('baseline')?`begin;\n${readMigration(name)}\ncommit;`:readMigration(name))
 await sql(`insert into auth.users(id) values('${owner}'),('${member}'),('${stranger}');
 insert into profiles(user_id,display_name) values('${owner}','Synthetic owner'),('${member}','Synthetic member'),('${stranger}','Synthetic outsider');
 insert into listings(id,user_id,created_by,title,visibility) values('${p}','${owner}','${owner}','Synthetic','private'),('${p2}','${owner}','${owner}','Other synthetic','private');
 insert into applications(listing_id,user_id,status) values('${p}','${member}','accepted');`)
 await sql(asUser(`insert into tasks(id,project_id,title,status) values('${a}','${p}','A','legacy'),('${b}','${p}','B','todo');`))
 await docker(['create','--pull','never','--name',rest,'--label','experts-nearby.task=er012-ui','--memory','128m','--cpus','0.5','--network',network,'-p','127.0.0.1:3018:3000',
 '-e',`PGRST_DB_URI=postgres://authenticator@${pg}:5432/synthetic`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${secret}`,'-e','PGRST_DB_POOL=6',restImage])
 owned.push(rest);await docker(['start',rest])
 ready=false
 for(let i=0;i<30;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(500)})).ok){ready=true;break}}catch{}await pause(300)}
 assert.ok(ready,'PostgREST startup failed')
 log(`PG ${await sql('show server_version;')}; PostgREST image ${restImage}; RAM 512+128 MiB; CPU 1+0.5; internal network; loopback API`)
 await check('real JWT role switch, named RPC arguments and stage move persist through REST reads',async()=>{
  settings=ok(await P.saveSettings(db(owner),p,0,{mode:'kanban',goal:'',definition_of_done:'',wip_mode:'strict',delegate_to_roles:false}))
  stages=(await request(`project_stages?project_id=eq.${p}&order=position`,undefined,owner,'GET')).data
  const stage=stages.find(s=>s.category==='doing')
  ok(await P.saveStage(db(owner),p,settings.version,{...stage,wip_limit:1}))
  const moved=ok(await P.editTaskPlanning(db(member),a,1,{stage_id:stage.id,story_points:5,planned_hours:1.25}))
  const row=(await request(`tasks?id=eq.${a}`,undefined,owner,'GET')).data[0]
  assert.equal(row.stage_id,stage.id);assert.equal(row.status,'doing');assert.equal(row.planning_version,moved.planning_version)
 })
 await check('strict WIP on RPC AND legacy PATCH; anon/outsider denied; stale task conflict',async()=>{
  const doing=stages.find(s=>s.category==='doing'),done=stages.find(s=>s.category==='done')
  const failed=await P.editTaskPlanning(db(member),b,1,{stage_id:doing.id,story_points:null,planned_hours:null});assert.equal(failed.error?.code,'23514')
  assert.equal((await request(`tasks?id=eq.${b}`,{status:'doing'},member,'PATCH')).error?.code,'23514')
  assert.equal((await P.editTaskPlanning(db(owner),a,1,{stage_id:done.id,story_points:5,planned_hours:1.25})).error?.code,'PT409')
  assert.equal((await P.editTaskPlanning(db(stranger),a,2,{stage_id:done.id,story_points:5,planned_hours:1.25})).error?.code,'42501')
  assert.equal((await request('rpc/reorder_project_stages',{p_project_id:p,p_expected_planning_version:2,p_stage_ids:stages.map(s=>s.id)},null)).status,401)
  assert.equal((await request('rpc/planning_claim_request_internal',{p_request_id:randomUUID(),p_project_id:p,p_kind:'create_sprint',p_payload:{}},owner)).status,403)
 })
 await check('atomic stage order and lead replacement; stale order/member refusal preserve previous result',async()=>{
  settings=ok(await P.reorderStages(db(owner),p,2,stages.map(s=>s.id).reverse()))
  assert.equal((await P.reorderStages(db(owner),p,2,stages.map(s=>s.id))).error?.code,'PT409')
  settings=ok(await P.replaceLead(db(owner),p,settings.version,'product_owner',member))
  assert.equal((await P.replaceLead(db(owner),p,settings.version,'product_owner',stranger)).error?.code,'23514')
  const roles=(await request(`project_roles?project_id=eq.${p}`,undefined,owner,'GET')).data
  assert.equal(roles.length,1);assert.equal(roles[0].user_id,member)
  settings=ok(await P.saveSettings(db(owner),p,settings.version,{mode:'scrum',goal:'',definition_of_done:'',wip_mode:'strict',delegate_to_roles:false}))
 })
 let created,creation
 await check('two separate HTTP requests with same UUID return one sprint/event; replay and mismatched content',async()=>{
  creation={requestId:randomUUID(),projectId:p,expectedVersion:settings.version,draft:{name:'Same name',goal:'',start_at:null,end_at:null}}
  const replies=await Promise.all([P.createSprintOnce(db(owner),creation),P.createSprintOnce(db(owner),creation)])
  created=ok(replies[0]);assert.equal(ok(replies[1]).id,created.id)
  assert.equal(await sql(`select count(*) from project_sprints where project_id='${p}';`),'1')
  assert.equal(await sql(`select count(*) from project_sprint_events where sprint_id='${created.id}' and kind='created';`),'1')
  assert.deepEqual(ok(await P.createSprintOnce(db(owner),creation)),created)
  assert.equal((await P.createSprintOnce(db(owner),{...creation,draft:{...creation.draft,goal:'Changed'}})).error?.code,'22023')
  assert.equal(ok(await P.loadRequest(db(owner),p,creation.requestId)).result.id,created.id)
  assert.equal((await P.loadRequest(db(member),p,creation.requestId)).error?.code,'42501')
  assert.equal((await request('project_planning_requests',undefined,owner,'GET')).status,403)
 })
 await check('competing HTTP creates with different UUIDs and same version: one commit, one conflict',async()=>{
  const version=Number(await sql(`select version from project_planning where project_id='${p}';`))
  const results=await Promise.all([1,2].map(()=>P.createSprintOnce(db(owner),{...creation,requestId:randomUUID(),expectedVersion:version})))
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error.code,'PT409')
 })
 await check('close confirmation and replay survive later task edits; missing receipt remains unconfirmed',async()=>{
  const t=(await request(`tasks?id=eq.${a}`,undefined,owner,'GET')).data[0]
  created=ok(await P.addTasksToSprint(db(owner),created.id,created.version,[{task_id:a,expected_version:t.planning_version}]))
  const close={requestId:randomUUID(),sprintId:created.id,expectedVersion:created.version,close:{cancel:true,reason:'Synthetic',decisions:[{task_id:a,destination:'backlog'}]}}
  const first=ok(await P.closeSprintOnce(db(owner),close)) // Discarded response is retrieved using the exact operation UUID.
  assert.deepEqual(ok(await P.loadRequest(db(owner),p,close.requestId)).result,first)
  ok(await P.editTaskPlanning(db(owner),a,t.planning_version,{stage_id:t.stage_id,story_points:13,planned_hours:null}))
  assert.deepEqual(ok(await P.closeSprintOnce(db(owner),close)),first)
  assert.equal(ok(await P.loadRequest(db(owner),p,randomUUID())),null)
 })
 log('6 PASS; real local PostgREST/PG, synthetic JWT/auth schema only. No real Supabase Auth/mail.')
} catch(e) {log(`FAIL ${e.message}`);process.exitCode=1}
finally {
 for(const name of owned.reverse()) {try {await docker(['stop','--time','10',name]);log(`STOPPED ${name}; container/data retained`)}catch(e){log(`STOP FAILED ${name}: ${e.message}`);process.exitCode=1}}
 mkdirSync(new URL('../../test-results/',import.meta.url),{recursive:true})
 writeFileSync(new URL(`../../test-results/planning-postgrest-${suffix}.txt`,import.meta.url),report.join('\n')+'\n')
}
