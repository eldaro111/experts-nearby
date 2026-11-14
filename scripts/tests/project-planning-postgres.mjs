// One owned, isolated PostgreSQL container. No network, ports, env files, cloud
// client, external volumes or image downloads. Requires the existing local image.
// Preserves the stopped container, its NEW data directory and per-run synthetic DB.
import {spawn} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {bootstrap,migrations,planningMigration,sprintMigration,readMigration,owner,member} from './planning-db-helpers.mjs'
const container='experts-nearby-er012-postgres17'
const image='public.ecr.aws/supabase/postgres:17.6.1.166'
const label='experts-nearby.task'
const database=`er012_${Date.now()}`
const report=[]
const sessions=new Set()
let owned=false
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const log=s=>{report.push(s);console.log(s)}
function command(args,input='',acceptFailure=false) {
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']})
  let out='',err=''
  child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s)
  child.on('error',reject)
  child.on('close',code=>code===0||acceptFailure?resolve({code,out:out.trim(),err:err.trim()}):reject(new Error(`docker ${args[0]} failed: ${err.slice(-3000)}`)))
  child.stdin.on('error',()=>{});child.stdin.end(input)
 })
}
const psqlArgs=db=>['exec','-i',container,'psql','-h','/tmp','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',db]
const sql=async(text,db=database)=>(await command(psqlArgs(db),text)).out
const asUser=(id,text)=>`set request.jwt.claim.sub='${id}'; set role authenticated; ${text}`
const get=async(text)=>JSON.parse(await sql(text))
class Session {
 constructor(name,id){
  this.name=name;this.buffer='';this.err='';this.pending=null;this.closed=false
  this.child=spawn('docker',psqlArgs(database),{windowsHide:true,stdio:['pipe','pipe','pipe']})
  this.child.stdout.on('data',s=>{this.buffer+=s;this.flush()})
  this.child.stderr.on('data',s=>this.err+=s)
  this.child.stdin.on('error',()=>{})
  this.child.on('error',e=>this.pending?.reject(e))
  this.child.on('close',()=>{this.closed=true;this.pending?.reject(new Error(this.err||'psql closed'));this.pending=null;sessions.delete(this)})
  sessions.add(this)
  this.ready=this.request(`set application_name='${name}'; set statement_timeout='8s'; set lock_timeout='6s'; ${asUser(id,'')}`)
 }
 flush(){if(this.pending&&this.buffer.includes(this.pending.marker)){
  const [value,...rest]=this.buffer.split(this.pending.marker);this.buffer=rest.join(this.pending.marker)
  const p=this.pending;this.pending=null;p.resolve(value.trim())
 }}
 request(text){return new Promise((resolve,reject)=>{
  if(this.pending||this.closed){reject(new Error('Invalid session request'));return}
  const marker=`ER012_END_${Math.random().toString(16).slice(2)}`
  this.pending={marker,resolve,reject};this.child.stdin.write(`${text}\n\\echo ${marker}\n`)
 })}
 end(){this.child.stdin.end('\\q\n')}
}
const session=async(name,id=owner)=>{const s=new Session(name,id);await s.ready;return s}
async function blocked(name){
 const deadline=Date.now()+5000
 while(Date.now()<deadline){
  if(await sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`)==='1') return
  await pause(80)
 }
 throw new Error(`${name} did not wait on a database lock`)
}
const expectCode=async(promise,code)=>{const result=await promise;assert.match(result.error||'',new RegExp(`\\b${code}\\b`))}
const outcome=promise=>promise.then(value=>({value}),error=>({error:error.message}))
let fixtureIndex=0
async function fixture(mode='kanban') {
 const n=++fixtureIndex,p=`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 const a=`20000000-0000-4000-8000-${String(n*2).padStart(12,'0')}`,b=`20000000-0000-4000-8000-${String(n*2+1).padStart(12,'0')}`
 await sql(`insert into listings(id,user_id,created_by,title,visibility) values('${p}','${owner}','${owner}','Local concurrency','private');
 insert into applications(listing_id,user_id,status) values('${p}','${member}','accepted');`)
 await sql(asUser(owner,`select update_project_planning('${p}',0,'${mode}','','','soft',false);
 insert into tasks(id,project_id,title) values('${a}','${p}','Task A'),('${b}','${p}','Task B');`))
 return {p,a,b}
}
const row=async(table,id)=>get(`select to_jsonb(t) from ${table} t where id='${id}';`)
const planningVersion=async(p)=>Number(await sql(`select version from project_planning where project_id='${p}';`))
const addSQL=(s,t)=>`select add_tasks_to_sprint('${s.id}',${s.version},'[{"task_id":"${t.id}","expected_version":${t.planning_version}}]');`
const closeSQL=(s,t)=>`select close_project_sprint('${s.id}',${s.version},false,null,'[{"task_id":"${t}","destination":"backlog"}]');`
async function makeSprint(p,t){
 const s=await get(asUser(owner,`select to_jsonb(create_project_sprint('${p}',${await planningVersion(p)},'Sprint','','2026-12-01','2026-12-15'));`))
 await sql(asUser(owner,addSQL(s,await row('tasks',t))))
 return row('project_sprints',s.id)
}
async function check(name,fn){await fn();log(`PASS ${name}`)}
try {
 // Inspect only selected non-secret metadata. Never inspect Config.Env.
 await command(['image','inspect','--format','{{.Id}}',image])
 const found=await command(['container','inspect','--format',`{{index .Config.Labels "${label}"}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}`,container],'',true)
 if(found.code===0){
  assert.equal(found.out,'er012|none|536870912|1000000000','Refuse to touch a container with different ownership/limits')
  owned=true;await command(['start',container])
 } else {
  // Bypass the Supabase entrypoint completely. Start only plain PostgreSQL in a
  // fresh directory in this container's writable layer, no mounted volumes.
  await command(['create','--name',container,'--label',`${label}=er012`,'--memory','512m','--cpus','1','--network','none',
    '--user','postgres','--entrypoint','/bin/bash',image,'-ec',
    'if [ ! -s /tmp/er012-data/PG_VERSION ]; then initdb -D /tmp/er012-data -A trust -U postgres --no-locale --encoding=UTF8; fi; exec postgres -D /tmp/er012-data -c shared_preload_libraries= -c shared_buffers=64MB -c max_connections=12 -c work_mem=4MB -c unix_socket_directories=/tmp -c listen_addresses=127.0.0.1'])
  owned=true;await command(['start',container])
 }
 let ready=false
 for(let i=0;i<30;i++){
  const r=await command(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],'',true)
  if(r.code===0){ready=true;break}await pause(300)
 }
 assert.ok(ready,'PostgreSQL failed to start; no repeated container launch')
 // Roles are cluster-wide, databases are new and synthetic on every run.
 await sql(`do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
 end $$; create database ${database};`,'postgres')
 await sql(bootstrap.replace('create role anon; create role authenticated; create role service_role bypassrls;',''))
 for(const name of [...migrations,planningMigration,sprintMigration]) await sql(name.includes('baseline')?`begin;\n${readMigration(name)}\ncommit;`:readMigration(name))
 await sql(`insert into auth.users(id) values('${owner}'),('${member}');
 insert into profiles(user_id,display_name) values('${owner}','Synthetic owner'),('${member}','Synthetic member');`)
 log(`PostgreSQL ${await sql('show server_version;')}; ${container}; ${database}; network=none; RAM=512MiB; CPU=1`)
 const f=await fixture()
 const stage=await get(`select to_jsonb(s) from project_stages s where project_id='${f.p}' and category='doing';`)
 await sql(asUser(owner,`select upsert_project_stage('${f.p}',${await planningVersion(f.p)},'${stage.id}',${stage.version},'In work',1,'doing',null,'',1);
 select update_project_planning('${f.p}',${(await planningVersion(f.p))+1},'kanban','','','strict',false);`))
 await check('strict WIP: concurrent legacy UPDATE conflicts without deadlock; retry respects limit',async()=>{
  const a=await session('er012_wip_a',member),b=await session('er012_wip_b',member)
  await a.request(`begin; update tasks set status='doing' where id='${f.a}';`)
  await expectCode(outcome(b.request(`update tasks set status='doing' where id='${f.b}';`)),'PT409')
  await a.request('commit;');a.end()
  await expectCode(outcome(sql(asUser(member,`update tasks set status='doing' where id='${f.b}';`))),'23514')
  assert.equal(await sql(`select count(*) from tasks where project_id='${f.p}' and status='doing';`),'1')
 })
 await check('two RPC editors serialize, stale second version conflicts',async()=>{
  const t=await row('tasks',f.b),a=await session('er012_edit_a'),b=await session('er012_edit_b',member)
  await a.request(`begin; select edit_task_planning('${t.id}',${t.planning_version},'${t.stage_id}',3,null);`)
  const waiting=outcome(b.request(`select edit_task_planning('${t.id}',${t.planning_version},'${t.stage_id}',5,null);`))
  await blocked(b.name);await a.request('commit;');a.end();await expectCode(waiting,'PT409')
  assert.equal((await row('tasks',t.id)).story_points,3)
 })
 await check('membership revoked while RPC waits is rechecked after project lock',async()=>{
  const t=await row('tasks',f.b),a=await session('er012_revoke_a'),b=await session('er012_revoke_b',member)
  await a.request(`begin; update applications set status='rejected' where listing_id='${f.p}' and user_id='${member}';`)
  const waiting=outcome(b.request(`select edit_task_planning('${t.id}',${t.planning_version},'${t.stage_id}',8,null);`))
  await blocked(b.name);await a.request('commit;');a.end();await expectCode(waiting,'42501')
  assert.equal((await row('tasks',t.id)).story_points,3)
 })
 await check('project closure while RPC waits prevents a late edit',async()=>{
  await sql(asUser(owner,`update applications set status='accepted' where listing_id='${f.p}'; update tasks set status='done' where project_id='${f.p}';`))
  const t=await row('tasks',f.b),a=await session('er012_close_project_a'),b=await session('er012_close_project_b',member)
  await a.request(`begin; update listings set completed_at=now() where id='${f.p}';`)
  const waiting=outcome(b.request(`select edit_task_planning('${t.id}',${t.planning_version},'${t.stage_id}',13,null);`))
  await blocked(b.name);await a.request('commit;');a.end();await expectCode(waiting,'23514')
 })
 const sf=await fixture('scrum');let s1=await makeSprint(sf.p,sf.a),s2=await makeSprint(sf.p,sf.b)
 await check('concurrent starts leave exactly one active sprint',async()=>{
  const a=await session('er012_start_a'),b=await session('er012_start_b')
  await a.request(`begin; select start_project_sprint('${s1.id}',${s1.version});`)
  const waiting=outcome(b.request(`select start_project_sprint('${s2.id}',${s2.version});`))
  await blocked(b.name);await a.request('commit;');a.end();await expectCode(waiting,'23514')
  assert.equal(await sql(`select count(*) from project_sprints where project_id='${sf.p}' and state='active';`),'1')
  s1=await row('project_sprints',s1.id)
 })
 await check('concurrent estimate invalidates closing version; refreshed close snapshots committed value',async()=>{
  const a=await session('er012_snapshot_a',member),b=await session('er012_snapshot_b')
  await a.request(`begin; update tasks set story_points=13,planned_hours=2.25 where id='${sf.a}';`)
  const waiting=outcome(b.request(closeSQL(s1,sf.a)))
  await blocked(b.name);await a.request('commit;');a.end();await expectCode(waiting,'PT409')
  s1=await row('project_sprints',s1.id);await sql(asUser(owner,closeSQL(s1,sf.a)))
  const result=await row('project_sprints',s1.id);assert.equal(result.final_snapshot.totals.story_points,13);assert.equal(result.final_snapshot.totals.planned_hours,2.25)
 })
 await check('archive versus legacy stage assignment cannot attach to archived stage',async()=>{
  const f=await fixture(),t=await row('tasks',f.a)
  const doing=await sql(`select id from project_stages where project_id='${f.p}' and category='doing';`)
  const a=await session('er012_archive_a'),b=await session('er012_archive_b',member)
  await a.request(`begin; select archive_project_stage('${f.p}',${await planningVersion(f.p)},'${t.stage_id}',1,'${doing}');`)
  const waiting=outcome(b.request(`update tasks set stage_id='${t.stage_id}' where id='${f.a}';`))
  await blocked(b.name);await a.request('commit;');a.end();await expectCode(waiting,'23514')
  assert.equal((await row('tasks',f.a)).stage_id,doing)
 })
 log('7 PASS; separate psql connections, READ COMMITTED, synthetic PostgreSQL only')
} catch(error){log(`FAIL ${error.message}`);process.exitCode=1}
finally {
 for(const s of sessions) s.end()
 if(owned){
  try {await command(['stop','--time','10',container]);log(`STOPPED ${container}; container/data directory retained`)}
  catch(error){log(`STOP FAILED ${error.message}`);process.exitCode=1}
 }
 mkdirSync(new URL('../../test-results/',import.meta.url),{recursive:true})
 writeFileSync(new URL(`../../test-results/er012-postgres-${database}.txt`,import.meta.url),report.join('\n')+'\n')
}
