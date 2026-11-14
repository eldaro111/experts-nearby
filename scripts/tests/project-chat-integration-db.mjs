// Full repository migration chain, synthetic in-memory PGlite only. No env, URLs or Docker.
// --before reproduces the timestamp/pagination observations before the two additive migrations.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setup, owner, member, stranger, planningMigration, sprintMigration, atomicMigration, readMigration, checks, fails } from './planning-db-helpers.mjs'

const timestamps = '20261114130000_project_message_server_time.sql'
const publication = '20261114131000_project_message_realtime.sql'
const { check, finish } = checks()
const env = await setup([planningMigration, sprintMigration, atomicMigration])
const { db, q, user, admin } = env
const before = process.argv.includes('--before')
try {
  const p = await env.project(), p2 = await env.project(), id = randomUUID()
  const insert = (messageId = randomUUID(), author = member, project = p, parent = null) =>
    q('insert into project_messages(id,project_id,author_id,body,parent_message_id) values($1,$2,$3,$4,$5) returning *', [messageId, project, author, 'Synthetic message', parent])
  await user(member)
  await q("insert into project_messages(id,project_id,author_id,body,created_at,edited_at) values($1,$2,$3,'Legacy','2001-01-01Z','2002-01-01Z')", [id, p, member])
  await user(owner)
  await env.task(p)
  await user(member)
  const oldRows = await q('select * from project_messages order by id')
  const oldHistory = await env.history(p)
  assert.ok(oldHistory.length > 0, 'preservation test must contain real pre-existing history')
  if (before) {
    await check('BEFORE: full chain accepts client created_at and edited_at on INSERT', async () => {
      assert.equal(new Date(oldRows[0].created_at).getUTCFullYear(), 2001)
      assert.equal(new Date(oldRows[0].edited_at).getUTCFullYear(), 2002)
    })
    await check('BEFORE: UPDATE refuses created_at but trusts edited_at, including a reused date', async () => {
      await fails(() => q("update project_messages set created_at='2003-01-01Z' where id=$1", [id]), 'P0001')
      await q("update project_messages set body='Edit one', edited_at='2004-01-01Z' where id=$1", [id])
      const [row] = await q("update project_messages set body='Edit two' where id=$1 returning edited_at", [id])
      assert.equal(new Date(row.edited_at).getUTCFullYear(), 2004)
    })
    await check('BEFORE: project_messages is absent from the publication', async () => {
      assert.equal((await q("select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='project_messages'")).length, 0)
    })
    await check('BEFORE: latest-only refresh skips 25 of 75 arrivals; timestamp-only history stalls on 170 ties', async () => {
      await q("insert into project_messages(project_id,author_id,body,created_at) select $1,$2,'Arrival '||i,'2026-11-14Z'::timestamptz+i*interval '1 second' from generate_series(1,75) i", [p, member])
      const latest = await q('select * from project_messages where project_id=$1 order by created_at desc limit 50', [p])
      assert.equal(latest.filter(r => r.body.startsWith('Arrival')).length, 50)
      assert.equal((await q('select count(*)::int as n from project_messages where project_id=$1', [p]))[0].n - latest.length - 1, 25)
      await q("insert into project_messages(project_id,author_id,body,created_at) select $1,$2,'Tie '||i,'2026-11-14Z' from generate_series(1,170) i", [p2, member])
      const first = await q('select * from project_messages where project_id=$1 order by created_at desc limit 50', [p2])
      const older = await q('select * from project_messages where project_id=$1 and created_at<=$2 order by created_at desc limit 50', [p2, first[0].created_at])
      const repeat = await q('select * from project_messages where project_id=$1 and created_at<=$2 order by created_at desc limit 50', [p2, first[0].created_at])
      const known = new Set([...first, ...older].map(r => r.id))
      assert.ok(known.size < 170, 'the unordered tie boundary cannot reach the whole history')
      assert.equal(repeat.filter(r => !known.has(r.id)).length, 0, 'same cursor, no added rows: the old client disables older history')
    })
  } else {
    await admin()
    const guard = (await q("select pg_get_functiondef('phase8_guard_project_message_row()'::regprocedure) as def"))[0].def
    const policies = await q("select * from pg_policies where tablename in ('project_messages','project_message_hidden') order by policyname")
    const acl = await q("select relname,relacl::text from pg_class where oid in ('project_messages'::regclass,'project_message_hidden'::regclass) order by relname")
    await db.exec(readMigration(timestamps))
    await db.exec(readMigration(publication))
    await check('migrations preserve all old messages/history, guard definition, RLS and table ACL', async () => {
      await user(member)
      assert.deepEqual(await q('select * from project_messages order by id'), oldRows)
      assert.deepEqual(await env.history(p), oldHistory)
      assert.equal((await q("select pg_get_functiondef('phase8_guard_project_message_row()'::regprocedure) as def"))[0].def, guard)
      assert.deepEqual(await q("select * from pg_policies where tablename in ('project_messages','project_message_hidden') order by policyname"), policies)
      assert.deepEqual(await q("select relname,relacl::text from pg_class where oid in ('project_messages'::regclass,'project_message_hidden'::regclass) order by relname"), acl)
    })
    let fresh
    await check('INSERT replaces past/future/null client times with server time; normal old-client INSERT works', async () => {
      for (const clientDate of ['1900-01-01Z','2200-01-01Z', null]) {
        const [r] = await q('insert into project_messages(project_id,author_id,body,created_at,edited_at) values($1,$2,\'Synthetic\',$3,$3) returning *,abs(extract(epoch from created_at-clock_timestamp()))<2 as server_time', [p, member, clientDate])
        assert.equal(r.server_time, true); assert.equal(r.edited_at, null)
      }
      fresh = (await insert())[0]
      assert.equal(fresh.edited_at, null)
    })
    await check('UPDATE cannot move created_at or forge edited_at; edits with/without old-client mark use server time', async () => {
      for (const mark of ['1900-01-01Z', null]) {
        const [r] = await q('update project_messages set body=$2,created_at=\'2200-01-01Z\',edited_at=$3 where id=$1 returning *,abs(extract(epoch from edited_at-clock_timestamp()))<2 as server_time', [fresh.id, `Edit ${mark}`, mark])
        assert.deepEqual(r.created_at, fresh.created_at); assert.equal(r.server_time,true)
      }
      const [r] = await q("update project_messages set body='No client mark' where id=$1 returning *,abs(extract(epoch from edited_at-clock_timestamp()))<2 as server_time", [fresh.id])
      assert.equal(r.server_time, true)
      const [noop] = await q("update project_messages set edited_at='1800-01-01Z',created_at=null where id=$1 returning created_at,edited_at", [fresh.id])
      assert.deepEqual(noop, {created_at:r.created_at,edited_at:r.edited_at})
    })
    await check('replies, author edit, soft delete, hide/unhide still work; restore/identity/cross-project reply fail', async () => {
      const [reply] = await insert(undefined, member, p, fresh.id)
      await fails(() => insert(undefined, member, p2, fresh.id), 'P0001')
      await fails(() => q('update project_messages set project_id=$2 where id=$1',[reply.id,p2]),'P0001')
      await fails(() => q('update project_messages set author_id=$2 where id=$1',[reply.id,owner]),'P0001')
      await q('insert into project_message_hidden(message_id,user_id) values($1,$2)',[reply.id,member])
      assert.equal((await q('delete from project_message_hidden where message_id=$1 returning id',[reply.id])).length,1)
      const [deleted] = await q("update project_messages set body='',is_deleted_for_all=true,edited_at='1900-01-01Z' where id=$1 returning *,abs(extract(epoch from edited_at-clock_timestamp()))<2 as server_time",[reply.id])
      assert.equal(deleted.server_time,true)
      await fails(() => q("update project_messages set body='restore',is_deleted_for_all=false where id=$1",[reply.id]),'P0001')
      const [noop] = await q('update project_messages set edited_at=null where id=$1 returning edited_at',[reply.id])
      assert.deepEqual(noop.edited_at,deleted.edited_at)
    })
    await check('UUID repeat stays 23505; success requires an accessible row; different author cannot edit/delete', async () => {
      await fails(() => insert(fresh.id), '23505')
      assert.equal((await q('select id from project_messages where id=$1',[fresh.id])).length,1)
      await user(owner)
      assert.equal((await q("update project_messages set body='Other author' where id=$1 returning id",[fresh.id])).length,0)
      assert.equal((await q('delete from project_messages where id=$1 returning id',[fresh.id])).length,0)
    })
    await check('anon/stranger/excluded member cannot read content or write; current member and owner can read', async () => {
      for (const actor of [null,stranger]) {
        await user(actor,actor?'authenticated':'anon')
        assert.equal((await q('select * from project_messages where project_id=$1',[p])).length,0)
        await assert.rejects(() => insert(undefined,actor||member))
        assert.equal((await q("update project_messages set body='No access' where id=$1 returning id",[fresh.id])).length,0)
      }
      await admin(); await q("update applications set status='rejected' where listing_id=$1 and user_id=$2",[p,member])
      await user(member)
      assert.equal((await q('select * from project_messages where project_id=$1',[p])).length,0)
      await assert.rejects(() => insert())
      await admin(); await q("update applications set status='accepted' where listing_id=$1 and user_id=$2",[p,member])
      for (const actor of [member,owner]) {await user(actor);assert.ok((await q('select id from project_messages where project_id=$1',[p])).length>0)}
    })
    await check('publication includes messages and keeps notifications; internal history EXECUTE stays closed', async () => {
      assert.deepEqual((await q("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).map(r=>r.tablename),['notifications','project_messages'])
      for(const role of ['anon','authenticated']) {
        assert.equal((await q("select has_function_privilege($1,'public.project_message_server_time()','EXECUTE') as allowed",[role]))[0].allowed,false)
        assert.equal((await q("select has_function_privilege($1,'public.append_project_activity_internal(uuid,text,text,text,text,uuid,jsonb)','EXECUTE') as allowed",[role]))[0].allowed,false)
      }
    })
    await check('diagnostic is metadata-only/read-only; publication migration can be reapplied without data changes', async () => {
      await admin()
      const rows=await q('select * from project_messages order by id')
      await db.exec(readFileSync(new URL('../../supabase/diagnostics/project-chat.sql',import.meta.url),'utf8'))
      await db.exec(readMigration(publication))
      assert.deepEqual(await q('select * from project_messages order by id'),rows)
    })
  }
} finally { await db.close() }
finish()
