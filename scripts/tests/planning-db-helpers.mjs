// Synthetic, in-memory database only. No env files, URLs, Supabase clients or draft test.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
export const migrations = [
 '20260823110236_baseline_public.sql','20260823110300_project_files_storage.sql',
 '20261004090000_pilot_feedback.sql','20261004150000_recommendations.sql',
 '20261019160000_startup_projects.sql','20261101090000_project_file_compression.sql',
 '20261110090000_project_activity_execute.sql','20261112090000_task_schedule.sql',
 '20261112091000_market_system_text.sql',
]
export const planningMigration='20261114090000_project_planning.sql'
export const sprintMigration='20261114100000_project_sprints.sql'
export const readMigration=name=>readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8')
export const bootstrap=`create publication supabase_realtime;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;`
export const owner='00000000-0000-4000-8000-000000000001'
export const member='00000000-0000-4000-8000-000000000002'
export const stranger='00000000-0000-4000-8000-000000000003'
export async function setup(extra=[planningMigration]) {
 const db=new PGlite()
 try {
  await db.exec(bootstrap)
  for(const name of [...migrations,...extra]) await db.exec(name.includes('baseline')?`begin;\n${readMigration(name)}\ncommit;`:readMigration(name))
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows
  const user=async(id,role=id?'authenticated':'postgres')=>{
   assert.ok(['anon','authenticated','postgres'].includes(role))
   await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec(`set role ${role}`)
  }
  const admin=()=>user(null)
  for(const id of [owner,member,stranger]) {
   await q('insert into auth.users(id) values($1)',[id])
   await q("insert into profiles(user_id,display_name) values($1,'Local synthetic')",[id])
  }
  const project=async()=>{
   await admin()
   const p=(await q("insert into listings(user_id,created_by,title,visibility) values($1,$1,'Synthetic planning','private') returning id",[owner]))[0].id
   await q("insert into applications(listing_id,user_id,status) values($1,$2,'accepted')",[p,member])
   await user(owner);return p
  }
  const task=async(p,fields={})=>{
   const columns=['project_id','title',...Object.keys(fields)]
   assert.ok(columns.every(c=>['project_id','title','status','stage_id','story_points','planned_hours','completed_at','start_at','due_at'].includes(c)))
   return (await q(`insert into tasks(${columns.join(',')}) values(${columns.map((_,i)=>`$${i+1}`).join(',')}) returning *`,[p,'Synthetic task',...Object.values(fields)]))[0]
  }
  const settings=async(p)=> (await q('select * from project_planning where project_id=$1',[p]))[0]||{version:0,mode:'simple',goal:'',definition_of_done:'',wip_mode:'soft',delegate_to_roles:false}
  const configure=async(p,fields={},expected)=>{
   const s={...await settings(p),...fields}
   return (await q('select * from update_project_planning($1,$2,$3,$4,$5,$6,$7)',[p,expected??s.version,s.mode,s.goal,s.definition_of_done,s.wip_mode,s.delegate_to_roles]))[0]
  }
  const stages=async(p)=>q('select * from project_stages where project_id=$1 order by position',[p])
  const stage=async(p,fields={},previous=null)=>{
   const s={name:'Review',position:10,category:'doing',status_value:'review',policy:'Review policy',wip_limit:null,...previous,...fields}
   return (await q('select * from upsert_project_stage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p,(await settings(p)).version,previous?.id||null,previous?.version||0,s.name,s.position,s.category,s.status_value,s.policy,s.wip_limit]))[0]
  }
  const edit=async(t,fields={},expected=t.planning_version)=> {
   const s={...t,...fields}
   return (await q('select * from edit_task_planning($1,$2,$3,$4,$5)',[t.id,expected,s.stage_id,s.story_points,s.planned_hours]))[0]
  }
  const history=async(p)=>q('select * from project_activity where project_id=$1 order by id',[p])
  return {db,q,user,admin,project,task,settings,configure,stages,stage,edit,history}
 } catch(e) {await db.close();throw e}
}
export const fails=(fn,code)=>assert.rejects(fn,e=>{assert.equal(e.code,code, e.message);return true})
export function checks(){let passed=0;return {
 check:async(name,fn)=>{await fn();passed++;console.log('PASS',name)},
 finish:()=>console.log(`${passed} PASS`),
}}
