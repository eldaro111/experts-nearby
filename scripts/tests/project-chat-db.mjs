// Chat insert contract against the REAL baseline schema in PGlite (not PostgREST/Auth): a message id
// chosen by the client is accepted; repeating the same id is refused with 23505, so a resend after a
// lost answer can only find the saved row, never create a second one. Rights stay with RLS.
// Synthetic in-memory database only. Run: node scripts/tests/project-chat-db.mjs
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setup, owner, member, stranger, checks, fails } from './planning-db-helpers.mjs'

const { check, finish } = checks()
const env = await setup([])
const { q, user } = env
try {
  const p = await env.project()
  const id = randomUUID()
  const insert = (messageId, author, body = 'Синтетическое сообщение', parent = null) =>
    q('insert into project_messages(id,project_id,author_id,body,parent_message_id) values($1,$2,$3,$4,$5) returning *', [messageId, p, author, body, parent])

  await check('a member inserts a message with an id chosen by the client', async () => {
    await user(member)
    const [row] = await insert(id, member)
    assert.equal(row.id, id)
  })
  await check('the same id again is refused with 23505 (no duplicate on resend)', async () => {
    await fails(() => insert(id, member, 'Повтор'), '23505')
    await user(member)
    const rows = await q('select id, body from project_messages where id=$1', [id])
    assert.deepEqual(rows.map((r) => r.body), ['Синтетическое сообщение'], 'the saved text is unchanged')
  })
  await check('the saved row is found by id after an unknown outcome', async () => {
    await user(member)
    assert.equal((await q('select id from project_messages where id=$1', [id])).length, 1)
  })
  await check('rights unchanged: an outsider can neither insert nor read; a reply must stay in the project', async () => {
    await user(stranger)
    await assert.rejects(() => insert(randomUUID(), stranger))
    assert.equal((await q('select id from project_messages where id=$1', [id])).length, 0)
    await user(owner)
    const [reply] = await insert(randomUUID(), owner, 'Ответ', id)
    assert.equal(reply.parent_message_id, id)
  })
  // Server observations for the report. They describe the CURRENT schema, they are not requirements;
  // the chat never sends created_at and always sets edited_at.
  await check('OBSERVED (server, unchanged): an insert may set its own created_at, so a message can be backdated', async () => {
    await user(member)
    const [row] = await q("insert into project_messages(id,project_id,author_id,body,created_at) values($1,$2,$3,'Задним числом','2001-01-01T00:00:00Z') returning created_at", [randomUUID(), p, member])
    assert.equal(new Date(row.created_at).toISOString(), '2001-01-01T00:00:00.000Z')
  })
  await check('server requires edited_at for an edit, but takes its value from the client (any time; a later edit may keep the old mark)', async () => {
    await user(member)
    const edited = randomUUID()
    await insert(edited, member, 'Исходный текст')
    await fails(() => q("update project_messages set body='Без отметки' where id=$1", [edited]), 'P0001')
    const [first] = await q("update project_messages set body='Правка 1', edited_at='2001-01-01T00:00:00Z' where id=$1 returning edited_at", [edited])
    assert.equal(new Date(first.edited_at).toISOString(), '2001-01-01T00:00:00.000Z', 'OBSERVED: an arbitrary time is accepted')
    const [second] = await q("update project_messages set body='Правка 2' where id=$1 returning body, edited_at", [edited])
    assert.deepEqual([second.body, new Date(second.edited_at).toISOString()], ['Правка 2', '2001-01-01T00:00:00.000Z'], 'OBSERVED: the second edit keeps the old mark')
  })
  await check('hiding for oneself twice is 23505 (treated as already hidden by the chat)', async () => {
    await user(member)
    await q('insert into project_message_hidden(message_id,user_id) values($1,$2)', [id, member])
    await fails(() => q('insert into project_message_hidden(message_id,user_id) values($1,$2)', [id, member]), '23505')
  })
} finally {
  await env.db.close()
}
finish()
