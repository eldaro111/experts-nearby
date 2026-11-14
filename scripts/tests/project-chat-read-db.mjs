// Actual Supabase query builder + an in-process, SELECT-only SQL adapter over synthetic PGlite.
// Verifies keyset expressions/order with PostgreSQL timestamps. NOT HTTP PostgREST or Realtime.
// node --import tsx scripts/tests/project-chat-read-db.mjs
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { readChatPage, readChatWindow } from '../../src/lib/projectChatRead.ts'
import { mergeMessages } from '../../src/lib/projectChat.ts'
const db = new PGlite()
let calls = 0
const project = '00000000-0000-4000-8000-000000000001'
const client = createClient('https://chat-test.invalid','synthetic-public-key', { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}, global:{fetch:async (input) => {
  const u=new URL(String(input));assert.equal(u.hostname,'chat-test.invalid');assert.equal(u.pathname,'/rest/v1/project_messages')
  assert.equal(u.searchParams.get('order'),'created_at.desc,id.desc')
  const args=[u.searchParams.get('project_id').slice(3)]
  let where='project_id=$1'
  const filter=u.searchParams.get('or')
  if(filter){
    const m=/^\(created_at\.lt\."([^"]+)",and\(created_at\.eq\."([^"]+)",id\.lt\."([^"]+)"\)\)$/.exec(filter)
    assert.ok(m);assert.equal(m[1],m[2]);args.push(m[1],m[3]);where+=' and (created_at,id)<($2::timestamptz,$3::uuid)'
  }
  const floor=u.searchParams.get('created_at')
  if(floor){assert.ok(floor.startsWith('gte.'));args.push(floor.slice(4));where+=` and created_at>=$${args.length}::timestamptz`}
  args.push(Number(u.searchParams.get('limit')))
  const {rows}=await db.query(`select to_jsonb(m) as row from project_messages m where ${where} order by created_at desc,id desc limit $${args.length}`,args)
  calls++
  return new Response(JSON.stringify(rows.map(r=>r.row)),{status:200,headers:{'Content-Type':'application/json'}})
} } })
try {
  await db.exec('create table project_messages(id uuid primary key,project_id uuid,body text,created_at timestamptz,edited_at timestamptz,is_deleted_for_all boolean default false)')
  await db.query("insert into project_messages(id,project_id,body,created_at) select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,$1,'Tie '||i,'2026-11-14Z' from generate_series(1,170) i",[project])
  let cursor, history=[]
  do {const page=await readChatPage(client,project,cursor);history=mergeMessages(history,page);cursor=page.at(-1);if(page.length<50)break}while(true)
  assert.equal(history.length,170);assert.equal(new Set(history.map(r=>r.id)).size,170)
  console.log('PASS 170 equal timestamps across four pages, no gaps/duplicates, stable UUID order')
  const previous=history.slice(-50)
  await db.query("insert into project_messages(id,project_id,body,created_at) select ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,$1,'New '||i,'2026-11-15Z'::timestamptz+i*interval '1 microsecond' from generate_series(1,125) i",[project])
  const refreshed=mergeMessages([],await readChatWindow(client,project,previous[0],()=>true))
  assert.equal(refreshed.length,295)
  assert.equal(refreshed.filter(r=>r.body.startsWith('New')).length,125)
  assert.equal(refreshed.at(-1).body,'New 125')
  console.log('PASS 125 arrivals between refreshes; all boundary ties and microsecond order retained')
  await db.query("update project_messages set body='Edited old',edited_at=clock_timestamp() where id=$1",[previous[0].id])
  const next=await readChatWindow(client,project,previous[0],()=>true)
  assert.equal(next.find(r=>r.id===previous[0].id).body,'Edited old')
  assert.equal((await readChatWindow(client,project,undefined,()=>true)).length,295)
  console.log('PASS old loaded edit reconciled; empty-to-busy refresh does not drop messages after 50')
  const oldCalls=calls
  assert.equal(await readChatWindow(client,project,previous[0],()=>false),null)
  assert.equal(calls,oldCalls)
  console.log('PASS cancelled session performs no further page reads; 4 PASS')
} finally {await db.close()}
