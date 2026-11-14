// Contract of the planning client module (src/lib/planning.ts) against the REAL ER-012 SQL in PGlite.
//
// What this proves: the module calls the actual functions with their exact named arguments, parses the
// actual rows/JSON, maps the actual SQLSTATE codes, and the full sprint cycle works under the actual rights.
// What it does NOT prove: PostgREST, Supabase Auth/JWT, network, the browser. The tiny adapter below
// replaces PostgREST: RPC → `select to_jsonb(fn(arg => $1, …))`, table read → `select … where … order by`
// under `set role authenticated` with RLS. Synthetic in-memory database only; no env, URLs or cloud.
//
// Run: node --import tsx scripts/tests/planning-client-db.mjs
import assert from 'node:assert/strict'
import { setup, owner, member, stranger, checks, planningMigration, sprintMigration } from './planning-db-helpers.mjs'
import * as P from '../../src/lib/planning.ts'

const ident = (value) => { assert.match(value, /^[a-z_]+$/, `identifier ${value}`); return value }
/** uuid[] as a JS array, jsonb as JSON text, scalars unchanged — the same values supabase-js would send. */
const param = (value) => (Array.isArray(value) && value.every((item) => typeof item === 'string') ? value
  : value !== null && typeof value === 'object' ? JSON.stringify(value) : value)

function pgliteDb(q, { delayMs = 0 } = {}) {
  const wait = (signal) => (delayMs ? new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }) }) : null)
  return {
    calls: [],
    async rpc(fn, args, signal) {
      this.calls.push({ fn, args })
      const names = Object.keys(args)
      try {
        const rows = await q(`select to_jsonb(public.${ident(fn)}(${names.map((name, i) => `${ident(name)} => $${i + 1}`).join(', ')})) as result`, names.map((name) => param(args[name])))
        await wait(signal)
        if (signal.aborted) return { data: null, error: { code: '', message: 'AbortError: aborted' } }
        return { data: rows[0].result, error: null }
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } }
      }
    },
    async select(table, query) {
      const columns = query.columns === '*' ? '*' : query.columns.split(',').map((c) => ident(c.trim())).join(',')
      const where = []
      const params = []
      for (const [column, value] of Object.entries(query.eq ?? {})) { params.push(value); where.push(`${ident(column)}::text = $${params.length}`) }
      if (query.in) { params.push(query.in.values); where.push(`${ident(query.in.column)}::text = any($${params.length}::text[])`) }
      for (const column of query.isNull ?? []) where.push(`${ident(column)} is null`)
      const order = (query.order ?? []).map((o) => `${ident(o.column)} ${o.ascending ? 'asc' : 'desc'}`)
      const sql = `select to_jsonb(t) as row from (select ${columns} from public.${ident(table)}${where.length ? ` where ${where.join(' and ')}` : ''}${order.length ? ` order by ${order.join(', ')}` : ''}${query.limit ? ` limit ${Number(query.limit)}` : ''}) t`
      try {
        return { data: (await q(sql, params)).map((row) => row.row), error: null }
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } }
      }
    },
  }
}

const ok = (result, what) => { assert.ok(result.ok, `${what}: ${result.ok ? '' : `${result.error.kind} ${result.error.code} ${result.error.message}`}`); return result.data }
const refused = (result, kind, what) => { assert.ok(!result.ok, `${what}: expected ${kind}`); assert.equal(result.error.kind, kind, `${what}: ${result.error.code} ${result.error.message}`); return result.error }

const { check, finish } = checks()

// ---------------------------------------------------------------- Without the ER-012 migrations
{
  const env = await setup([])
  try {
    await check('without the migrations: settings and backlog report an unavailable server feature, not defaults', async () => {
      const p = await env.project()
      const db = pgliteDb(env.q)
      const settings = await P.loadSettings(db, p)
      refused(settings, 'unavailable', 'settings')
      refused(await P.loadBacklog(db, p), 'unavailable', 'backlog')
      refused(await P.loadSprints(db, p), 'unavailable', 'sprints')
    })
  } finally {
    await env.db.close()
  }
}

// ---------------------------------------------------------------- With both migrations
const env = await setup([planningMigration, sprintMigration])
const { q, user, admin } = env
const db = pgliteDb(q)
const taskRow = async (id) => P.parseTask((await q('select to_jsonb(t) as row from tasks t where id=$1', [id]))[0].row)
try {
  const p = await env.project()
  const a = await env.task(p, { status: 'todo' })
  const b = await env.task(p, { status: 'doing' })
  const c = await env.task(p, { status: 'todo' })
  const d = await env.task(p, { status: 'review' })
  let settings

  await check('legacy project: no settings row → simple, soft, version 0; estimates editable in simple', async () => {
    settings = ok(await P.loadSettings(db, p), 'settings')
    assert.deepEqual(settings, P.defaultSettings(p))
    assert.deepEqual(ok(await P.loadStages(db, p), 'stages'), [])
    const task = await taskRow(a.id)
    const saved = ok(await P.editTaskPlanning(db, a.id, task.planning_version, { stage_id: null, story_points: 5, planned_hours: 1.25 }), 'estimate')
    assert.equal(saved.story_points, 5)
    assert.equal(saved.planned_hours, 1.25)
    assert.equal(saved.planning_version, task.planning_version + 1)
    assert.equal(saved.status, 'todo', 'an estimate does not change the status')
    const call = db.calls.at(-1)
    assert.deepEqual(Object.keys(call.args), ['p_task_id', 'p_expected_version', 'p_stage_id', 'p_story_points', 'p_planned_hours'])
  })

  await check('settings: whole values with the expected version; stale version → conflict; same values → no-op', async () => {
    const draft = { mode: 'scrum', goal: 'Synthetic goal', definition_of_done: 'Synthetic DoD', wip_mode: 'soft', delegate_to_roles: false }
    settings = ok(await P.saveSettings(db, p, 0, draft), 'save')
    assert.equal(settings.mode, 'scrum')
    assert.equal(settings.version, 1)
    refused(await P.saveSettings(db, p, 0, { ...draft, goal: 'other' }), 'conflict', 'stale')
    const same = ok(await P.saveSettings(db, p, 1, draft), 'no-op')
    assert.equal(same.version, 1, 'same values keep the version')
    const stages = ok(await P.loadStages(db, p), 'stages')
    assert.deepEqual(stages.map((s) => [P.stageStatus(s), s.position]), [['todo', 0], ['doing', 1], ['done', 2]])
    const unknown = await taskRow(d.id)
    assert.equal(unknown.stage_id, null, 'an unknown status keeps no stage')
    assert.equal(unknown.status, 'review', 'an unknown status is not renamed')
  })

  await check('rights: a member cannot manage settings or assign roles; an outsider cannot read the backlog', async () => {
    await user(member)
    refused(await P.saveSettings(db, p, settings.version, { ...settings, goal: 'member' }), 'forbidden', 'member settings')
    refused(await P.setRole(db, p, settings.version, member, 'product_owner', true), 'forbidden', 'member role')
    ok(await P.loadBacklog(db, p), 'member reads the backlog')
    await user(stranger)
    refused(await P.loadBacklog(db, p), 'forbidden', 'outsider backlog')
    assert.deepEqual(ok(await P.loadSprints(db, p), 'outsider sprints'), [], 'RLS hides private sprints')
    await user(owner)
  })

  await check('roles and delegation: PO manages only with delegation; only the author changes delegation', async () => {
    settings = ok(await P.setRole(db, p, settings.version, member, 'product_owner', true), 'assign PO')
    assert.deepEqual(ok(await P.loadRoles(db, p), 'roles'), [{ user_id: member, role: 'product_owner' }])
    await user(member)
    let caps = P.capabilities({ userId: member, ownerId: owner, closed: false, settings, roles: [{ user_id: member, role: 'product_owner' }] })
    assert.equal(caps.canManage, false)
    assert.equal(caps.canReorderBacklog, true, 'PO orders the backlog regardless of delegation')
    refused(await P.saveSettings(db, p, settings.version, { ...settings, goal: 'PO' }), 'forbidden', 'PO without delegation')
    await user(owner)
    settings = ok(await P.saveSettings(db, p, settings.version, { ...settings, delegate_to_roles: true }), 'delegate')
    await user(member)
    caps = P.capabilities({ userId: member, ownerId: owner, closed: false, settings, roles: [{ user_id: member, role: 'product_owner' }] })
    assert.equal(caps.canManage, true)
    settings = ok(await P.saveSettings(db, p, settings.version, { ...settings, goal: 'PO goal' }), 'PO with delegation')
    refused(await P.saveSettings(db, p, settings.version, { ...settings, delegate_to_roles: false }), 'forbidden', 'PO changes delegation')
    await user(owner)
  })

  await check('stages and WIP: create/edit with versions, strict limit refuses a task with the server text, archive needs a target', async () => {
    const review = ok(await P.saveStage(db, p, settings.version, { id: null, version: 0, name: 'Проверка', position: 3, category: 'doing', status_value: 'review', policy: 'Проверяет второй участник', wip_limit: 1 }), 'create stage')
    refused(await P.saveStage(db, p, settings.version, { ...review, name: 'stale' }), 'conflict', 'stale planning version after a stage change')
    settings = ok(await P.loadSettings(db, p), 'reload settings')
    refused(await P.saveStage(db, p, settings.version, { id: null, version: 0, name: 'Дубль', position: 4, category: 'doing', status_value: 'review', policy: '', wip_limit: null }), 'taken', 'same effective status')
    settings = ok(await P.saveSettings(db, p, settings.version, { ...settings, wip_mode: 'strict' }), 'strict')
    const first = await taskRow(c.id)
    ok(await P.editTaskPlanning(db, c.id, first.planning_version, { stage_id: review.id, story_points: null, planned_hours: null }), 'first into review')
    const second = await taskRow(b.id)
    const refusal = refused(await P.editTaskPlanning(db, b.id, second.planning_version, { stage_id: review.id, story_points: 3, planned_hours: 2.5 }), 'rule', 'strict WIP')
    assert.match(refusal.message, /WIP/)
    const state = P.wipState(review, [await taskRow(c.id), await taskRow(b.id)], settings)
    assert.deepEqual([state.count, state.over], [1, false])
    const stages = ok(await P.loadStages(db, p), 'stages')
    const doing = stages.find((s) => s.category === 'doing' && !s.status_value)
    refused(await P.archiveStage(db, p, settings.version, review, null), 'rule', 'occupied stage without a target')
    const archived = ok(await P.archiveStage(db, p, settings.version, review, doing.id), 'archive')
    assert.ok(archived.archived_at)
    assert.equal((await taskRow(c.id)).status, 'doing', 'tasks moved to the target stage')
    settings = ok(await P.saveSettings(db, p, ok(await P.loadSettings(db, p), 's').version, { ...settings, wip_mode: 'soft' }), 'soft again')
  })

  await check('estimates: invalid points are a rule violation, a stale version a conflict', async () => {
    const task = await taskRow(b.id)
    refused(await P.editTaskPlanning(db, b.id, task.planning_version, { stage_id: task.stage_id, story_points: 4, planned_hours: null }), 'rule', 'points 4')
    refused(await P.editTaskPlanning(db, b.id, task.planning_version, { stage_id: task.stage_id, story_points: null, planned_hours: 1.234 }), 'rule', 'three decimals')
    const saved = ok(await P.editTaskPlanning(db, b.id, task.planning_version, { stage_id: task.stage_id, story_points: 3, planned_hours: 2.5 }), 'save')
    refused(await P.editTaskPlanning(db, b.id, task.planning_version, { stage_id: task.stage_id, story_points: 8, planned_hours: 2.5 }), 'conflict', 'stale')
    assert.equal(saved.story_points, 3)
    assert.deepEqual(P.parseStoryPoints('4'), { ok: false, message: P.parseStoryPoints('4').message })
  })

  await check('backlog order: full list with the version; a list missing a task is refused; the order survives a reload', async () => {
    const backlog = ok(await P.loadBacklog(db, p), 'backlog')
    const ids = backlog.tasks.map((t) => t.id)
    assert.equal(ids.length, 4)
    const reordered = P.moveInOrder(ids, ids.length - 1, 0)
    const saved = ok(await P.reorderBacklog(db, p, backlog.version, reordered), 'reorder')
    assert.deepEqual(saved.tasks.map((t) => t.id), reordered)
    refused(await P.reorderBacklog(db, p, backlog.version, ids), 'conflict', 'stale version')
    refused(await P.reorderBacklog(db, p, saved.version, reordered.slice(1)), 'conflict', 'missing task')
    assert.deepEqual(ok(await P.loadBacklog(db, p), 'reload').tasks.map((t) => t.id), reordered)
    await user(stranger)
    refused(await P.reorderBacklog(db, p, saved.version, reordered), 'forbidden', 'outsider')
    await user(owner)
  })

  let s1
  let s2
  await check('sprint: create, edit dates, add existing tasks with versions, start with a snapshot', async () => {
    settings = ok(await P.loadSettings(db, p), 'settings')
    s1 = ok(await P.createSprint(db, p, settings.version, { name: 'Спринт 1', goal: 'Первая сборка', start_at: null, end_at: null }), 'create')
    assert.equal(s1.state, 'planned')
    refused(await P.createSprint(db, p, settings.version, { name: 'Повтор', goal: '', start_at: null, end_at: null }), 'conflict', 'blind repeat of a create')
    const backlog = ok(await P.loadBacklog(db, p), 'backlog')
    const chosen = backlog.tasks.filter((t) => [a.id, b.id, c.id].includes(t.id))
    s1 = ok(await P.addTasksToSprint(db, s1.id, s1.version, chosen.map((t) => ({ task_id: t.id, expected_version: t.planning_version }))), 'add')
    const items = ok(await P.loadOpenItems(db, [s1.id]), 'items')
    assert.equal(items.length, 3)
    assert.equal(P.startBlocker(s1, items.length, false), 'Для старта укажите дату начала и окончания.')
    refused(await P.startSprint(db, s1.id, s1.version), 'rule', 'start without dates')
    refused(await P.updateSprint(db, s1.id, s1.version, { name: 'Спринт 1', goal: '', start_at: '2026-12-10T00:00:00Z', end_at: '2026-12-01T00:00:00Z' }), 'rule', 'end before start')
    s1 = ok(await P.updateSprint(db, s1.id, s1.version, { name: 'Спринт 1', goal: 'Первая сборка', start_at: '2026-12-01T02:00:00.000Z', end_at: '2026-12-15T10:30:00.000Z' }), 'dates')
    assert.equal(new Date(s1.start_at).toISOString(), '2026-12-01T02:00:00.000Z', 'time of day kept')
    await user(stranger)
    refused(await P.startSprint(db, s1.id, s1.version), 'forbidden', 'outsider start')
    await user(owner)
    s1 = ok(await P.startSprint(db, s1.id, s1.version), 'start')
    assert.equal(s1.state, 'active')
    assert.equal(s1.start_snapshot.totals.tasks, 3)
    assert.equal(s1.start_snapshot.totals.story_points, 8, 'points 5 + 3; unestimated counted apart')
    assert.equal(s1.start_snapshot.totals.unestimated_points, 1)
    assert.equal(s1.start_snapshot.totals.planned_hours, 3.75)
  })

  await check('close: exactly one decision per unfinished task; stale target conflicts; summary then one atomic call', async () => {
    settings = ok(await P.loadSettings(db, p), 'settings')
    s2 = ok(await P.createSprint(db, p, settings.version, { name: 'Спринт 2', goal: '', start_at: null, end_at: null }), 'planned target')
    await admin()
    await q("update tasks set status='done' where id=$1", [a.id])
    await user(owner)
    const sprints = ok(await P.loadSprints(db, p), 'sprints')
    s1 = sprints.find((s) => s.id === s1.id)
    s2 = sprints.find((s) => s.id === s2.id)
    const items = ok(await P.loadOpenItems(db, [s1.id]), 'items')
    const tasks = await Promise.all([a.id, b.id, c.id].map(taskRow))
    const unfinished = P.unfinishedScope(items, s1.id, tasks)
    assert.deepEqual(unfinished.map((t) => t.id).sort(), [b.id, c.id].sort())
    assert.deepEqual(P.buildDecisions({ [b.id]: 'backlog' }, unfinished.map((t) => t.id), [s2]), { ok: false, message: 'Выберите решение для каждой незавершённой задачи.' })
    const partial = [{ task_id: b.id, destination: 'backlog' }]
    refused(await P.closeSprint(db, s1.id, s1.version, { cancel: false, reason: null, decisions: partial }), 'rule', 'missing decision')
    const built = P.buildDecisions({ [b.id]: 'backlog', [c.id]: s2.id }, unfinished.map((t) => t.id), [s2])
    assert.ok(built.ok)
    const stale = built.value.map((d) => (d.destination === 'sprint' ? { ...d, expected_sprint_version: d.expected_sprint_version - 1 } : d))
    refused(await P.closeSprint(db, s1.id, s1.version, { cancel: false, reason: null, decisions: stale }), 'conflict', 'stale target')
    assert.deepEqual(P.summarizeClose(tasks, built.value), { done: 1, toBacklog: 1, moved: [{ sprintId: s2.id, count: 1 }], unfinished: 2 })
    const closed = ok(await P.closeSprint(db, s1.id, s1.version, { cancel: false, reason: null, decisions: built.value }), 'complete')
    assert.equal(closed.state, 'completed')
    const outcome = Object.fromEntries(closed.final_snapshot.items.map((item) => [item.task_id, item.outcome]))
    assert.deepEqual(outcome, { [a.id]: 'done', [b.id]: 'backlog', [c.id]: 'moved' })
    assert.equal(closed.final_snapshot.completed.tasks, 1)
    refused(await P.closeSprint(db, s1.id, closed.version, { cancel: false, reason: null, decisions: [] }), 'rule', 'closing a closed sprint with its current version')
    assert.equal((await taskRow(b.id)).status, 'doing', 'statuses are not changed automatically')
    const moved = ok(await P.loadOpenItems(db, [s2.id]), 'moved scope')
    assert.deepEqual(moved.map((i) => i.task_id), [c.id], 'same task UUID in the planned sprint')
    s1 = closed
  })

  await check('closed results stay as saved after later estimates and deletion of a task', async () => {
    const before = ok(await P.loadSprints(db, p), 'before').find((s) => s.id === s1.id)
    const task = await taskRow(a.id)
    ok(await P.editTaskPlanning(db, a.id, task.planning_version, { stage_id: task.stage_id, story_points: 21, planned_hours: 9 }), 'later estimate')
    await q('delete from tasks where id=$1', [a.id])
    const after = ok(await P.loadSprints(db, p), 'after').find((s) => s.id === s1.id)
    assert.deepEqual(after.final_snapshot, before.final_snapshot)
    assert.deepEqual(after.start_snapshot, before.start_snapshot)
    const items = ok(await P.loadSprintItems(db, s1.id), 'items')
    const deleted = items.find((i) => i.task_id === a.id)
    assert.equal(deleted.live_task_id, null, 'live link cleared, original task id kept')
    const events = ok(await P.loadSprintEvents(db, s1.id), 'events')
    assert.deepEqual(events.map((e) => e.kind).slice(0, 3), ['created', 'scope_added', 'updated'])
    assert.ok(events.every((e, i) => i === 0 || e.id > events[i - 1].id), 'ordered by id')
  })

  await check('cancel needs a reason; a planned sprint can be cancelled to return its tasks', async () => {
    s2 = ok(await P.loadSprints(db, p), 'sprints').find((s) => s.id === s2.id)
    assert.equal(P.checkCloseReason(true, '  '), 'Для отмены спринта укажите причину.')
    const decisions = [{ task_id: c.id, destination: 'backlog' }]
    refused(await P.closeSprint(db, s2.id, s2.version, { cancel: true, reason: '', decisions }), 'rule', 'no reason')
    const cancelled = ok(await P.closeSprint(db, s2.id, s2.version, { cancel: true, reason: 'Приоритеты изменились', decisions }), 'cancel')
    assert.equal(cancelled.state, 'cancelled')
    assert.equal(cancelled.close_reason, 'Приоритеты изменились')
    assert.ok(ok(await P.loadBacklog(db, p), 'backlog').tasks.some((t) => t.id === c.id), 'task back in the backlog')
  })

  await check('a timeout is reported as unknown, never retried; reading again shows the real outcome', async () => {
    settings = ok(await P.loadSettings(db, p), 'settings')
    let s3 = ok(await P.createSprint(db, p, settings.version, { name: 'Спринт 3', goal: '', start_at: null, end_at: null }), 'create')
    const slow = pgliteDb(q, { delayMs: 200 })
    const result = await P.closeSprint(slow, s3.id, s3.version, { cancel: true, reason: 'Проверка таймаута', decisions: [] }, { timeoutMs: 30 })
    refused(result, 'timeout', 'slow close')
    assert.equal(slow.calls.length, 1, 'sent once')
    s3 = ok(await P.loadSprints(db, p), 'reload').find((s) => s.id === s3.id)
    assert.equal(s3.state, 'cancelled', 'the server had committed: the UI must show this, not send again')
  })

  await check('closed project: planning writes are refused with the closed-project rule, reading stays', async () => {
    const p3 = await env.project()
    const t = await env.task(p3, { status: 'done' })
    let s3 = ok(await P.saveSettings(db, p3, 0, { mode: 'kanban', goal: '', definition_of_done: '', wip_mode: 'soft', delegate_to_roles: false }), 'kanban')
    await q('update listings set completed_at=now() where id=$1', [p3])
    s3 = ok(await P.loadSettings(db, p3), 'settings')
    const refusal = refused(await P.saveSettings(db, p3, s3.version, { ...s3, goal: 'after close' }), 'rule', 'closed project')
    assert.match(refusal.message, /заверш/i)
    const task = await taskRow(t.id)
    refused(await P.editTaskPlanning(db, t.id, task.planning_version, { stage_id: task.stage_id, story_points: 1, planned_hours: null }), 'rule', 'estimate in a closed project')
    ok(await P.loadBacklog(db, p3), 'reading stays allowed')
    assert.equal(P.capabilities({ userId: owner, ownerId: owner, closed: true, settings: s3, roles: [] }).readOnly, true)
  })

  await check('actual hours come from contributions; none → null', async () => {
    const p2 = await env.project()
    const t = await env.task(p2, {})
    const db2 = pgliteDb(q)
    assert.deepEqual(ok(await P.loadTaskActualHours(db2, t.id), 'none'), { hours: null, contributions: 0 })
    await admin()
    await q("insert into contributions(project_id,user_id,task_id,title,hours) values($1,$2,$3,'Synthetic',1.5),($1,$2,$3,'Synthetic',2.25),($1,$2,$3,'Synthetic',null)", [p2, member, t.id])
    await user(member)
    assert.deepEqual(ok(await P.loadTaskActualHours(db2, t.id), 'sum'), { hours: 3.75, contributions: 3 })
  })
} finally {
  await env.db.close()
}
finish()
