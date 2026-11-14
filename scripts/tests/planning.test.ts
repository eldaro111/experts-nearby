// Unit tests of the pure parts of src/lib/planning.ts (no network, no database).
// The calls against the real SQL are in scripts/tests/planning-client-db.mjs (PGlite).
// Run: node --import tsx --test scripts/tests/planning.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as P from '../../src/lib/planning'

const U = '00000000-0000-4000-8000-0000000000a1'
const OWNER = '00000000-0000-4000-8000-0000000000a2'

test('error codes map to explicit outcomes; server rule texts are kept', () => {
  assert.equal(P.classifyError({ code: 'PT409', message: 'Спринт изменился.' }).kind, 'conflict')
  assert.equal(P.classifyError({ code: '42501', message: 'Нет прав' }).kind, 'forbidden')
  const rule = P.classifyError({ code: '23514', message: 'Превышен строгий WIP-лимит этапа.' })
  assert.deepEqual([rule.kind, rule.message], ['rule', 'Превышен строгий WIP-лимит этапа.'])
  assert.equal(P.classifyError({ code: '23505', message: 'duplicate key' }).kind, 'taken')
  assert.equal(P.classifyError({ code: 'P0001', message: 'Проект завершён: состав команды и задачи зафиксированы' }).kind, 'closed_project')
  for (const code of ['PGRST202', 'PGRST205', '42P01', '42883']) assert.equal(P.classifyError({ code, message: 'x' }).kind, 'unavailable', code)
  assert.equal(P.classifyError({ code: '', message: 'TypeError: Failed to fetch' }).kind, 'network')
  assert.equal(P.classifyError({ code: '', message: 'AbortError' }, true).kind, 'timeout')
  // A raw technical message of an unknown error is not shown as if it were an explanation.
  assert.equal(P.classifyError({ code: 'XX000', message: 'internal' }).message, P.ERROR_TEXT.unknown)
})

test('settings: a missing row is simple/soft/version 0; unknown mode values are rejected', () => {
  assert.deepEqual(P.defaultSettings('p'), { project_id: 'p', mode: 'simple', goal: '', definition_of_done: '', wip_mode: 'soft', delegate_to_roles: false, version: 0, stored: false })
  const row = { project_id: 'p', mode: 'scrum', goal: 'g', definition_of_done: 'd', wip_mode: 'strict', delegate_to_roles: true, version: '7' }
  assert.equal(P.parseSettings(row).version, 7, 'bigint as string is accepted')
  assert.throws(() => P.parseSettings({ ...row, mode: 'hard' }))
  assert.throws(() => P.parseSettings({ ...row, wip_mode: 'hard' }), 'the strict mode is called strict, not hard')
})

test('snapshots: NULL sums stay NULL, unestimated counters stay apart', () => {
  const snapshot = P.parseSnapshot({
    captured_at: '2026-12-01T00:00:00+00:00',
    items: [{ item_id: 'i', task_id: 't', added_at: '2026-11-30T00:00:00+00:00', removed_at: null, outcome: null, destination_sprint_id: null,
      task: { task_id: 't', title: 'T', status: 'todo', stage_id: null, story_points: null, planned_hours: null, version: 2, assignee_id: null, start_at: null, due_at: null, completed_at: null } }],
    totals: { tasks: 1, story_points: null, planned_hours: null, unestimated_points: 1, unestimated_hours: 1 },
    completed: { tasks: 0, story_points: null, planned_hours: null, unestimated_points: 0, unestimated_hours: 0 },
  })
  assert.equal(snapshot.totals.story_points, null)
  assert.equal(snapshot.totals.unestimated_points, 1)
  assert.throws(() => P.parseSnapshot({ captured_at: 'x', items: [], totals: {}, completed: {} }))
  assert.deepEqual(P.sumEstimates([{ story_points: 3, planned_hours: null }, { story_points: null, planned_hours: 1.25 }, { story_points: 5, planned_hours: 2.5 }]),
    { tasks: 3, story_points: 8, planned_hours: 3.75, unestimated_points: 1, unestimated_hours: 1 })
  assert.deepEqual(P.sumEstimates([]), { tasks: 0, story_points: null, planned_hours: null, unestimated_points: 0, unestimated_hours: 0 })
})

test('estimates: points 1/2/3/5/8/13/21; hours > 0, ≤ 2000, two decimals, comma accepted, no rounding', () => {
  assert.deepEqual(P.parseStoryPoints(''), { ok: true, value: null })
  assert.deepEqual(P.parseStoryPoints('13'), { ok: true, value: 13 })
  for (const bad of ['4', '0', '1.5', 'x']) assert.equal(P.parseStoryPoints(bad).ok, false, bad)
  assert.deepEqual(P.parsePlannedHours(' '), { ok: true, value: null })
  assert.deepEqual(P.parsePlannedHours('1,25'), { ok: true, value: 1.25 })
  assert.deepEqual(P.parsePlannedHours('2000'), { ok: true, value: 2000 })
  for (const bad of ['0', '2000.01', '1.234', '-1', '1e3', 'abc']) assert.equal(P.parsePlannedHours(bad).ok, false, bad)
  assert.deepEqual(P.parseWipLimit(''), { ok: true, value: null })
  assert.equal(P.parseWipLimit('0').ok, false)
})

test('sprint rules shown before sending: dates, start blockers, cancel reason', () => {
  const draft = { name: 'S', goal: '', start_at: '2026-12-01T00:00:00Z', end_at: '2026-12-01T00:00:00Z' }
  assert.equal(P.checkSprintDraft(draft), 'Конец спринта должен быть позже начала.')
  assert.equal(P.checkSprintDraft({ ...draft, start_at: null, end_at: null }), null, 'planned dates may be empty')
  assert.equal(P.checkSprintDraft({ ...draft, name: '  ' }), 'Название спринта: от 1 до 120 символов.')
  const sprint = { state: 'planned', start_at: '2026-12-01T00:00:00Z', end_at: '2026-12-02T00:00:00Z' } as P.Sprint
  assert.equal(P.startBlocker(sprint, 0, false), 'Добавьте в спринт хотя бы одну задачу.')
  assert.equal(P.startBlocker(sprint, 1, true), 'В проекте уже есть активный спринт.')
  assert.equal(P.startBlocker({ ...sprint, end_at: null }, 1, false), 'Для старта укажите дату начала и окончания.')
  assert.equal(P.startBlocker(sprint, 1, false), null)
  assert.equal(P.checkCloseReason(false, ''), null)
  assert.equal(P.checkCloseReason(true, ' '), 'Для отмены спринта укажите причину.')
})

test('close decisions: one per unfinished task, only planned targets, versions attached', () => {
  const items = [
    { sprint_id: 'S1', removed_at: null, live_task_id: 'a' },
    { sprint_id: 'S1', removed_at: null, live_task_id: 'b' },
    { sprint_id: 'S1', removed_at: null, live_task_id: null },
    { sprint_id: 'S2', removed_at: null, live_task_id: 'c' },
  ] as P.SprintItem[]
  const tasks = [{ id: 'a', status: 'done' }, { id: 'b', status: 'review' }, { id: 'c', status: 'todo' }]
  assert.deepEqual(P.unfinishedScope(items, 'S1', tasks).map((t) => t.id), ['b'], 'done and deleted tasks need no decision; unknown statuses do')
  const planned = [{ id: 'S3', version: 4, state: 'planned' as const }, { id: 'S4', version: 1, state: 'active' as const }]
  assert.deepEqual(P.buildDecisions({ b: 'S3' }, ['b'], planned), { ok: true, value: [{ task_id: 'b', destination: 'sprint', sprint_id: 'S3', expected_sprint_version: 4 }] })
  assert.equal(P.buildDecisions({ b: 'S4' }, ['b'], planned).ok, false, 'not into an active sprint')
  assert.equal(P.buildDecisions({}, ['b'], planned).ok, false)
  assert.deepEqual(P.buildDecisions({}, [], planned), { ok: true, value: [] })
})

test('rights: author, member, PO/SM with and without delegation, closed project', () => {
  const base = { ownerId: OWNER, closed: false, settings: { delegate_to_roles: false }, roles: [] as P.PlanningRole[] }
  const author = P.capabilities({ ...base, userId: OWNER })
  assert.deepEqual([author.canManage, author.canAssignRoles, author.canReorderBacklog, author.canEditTasks], [true, true, true, true])
  const plain = P.capabilities({ ...base, userId: U })
  assert.deepEqual([plain.canManage, plain.canAssignRoles, plain.canReorderBacklog, plain.canEditTasks], [false, false, false, true])
  const po = P.capabilities({ ...base, userId: U, roles: [{ user_id: U, role: 'product_owner' }] })
  assert.deepEqual([po.canManage, po.canReorderBacklog], [false, true])
  const sm = P.capabilities({ ...base, userId: U, settings: { delegate_to_roles: true }, roles: [{ user_id: U, role: 'scrum_master' }] })
  assert.deepEqual([sm.canManage, sm.canReorderBacklog, sm.canChangeDelegation, sm.canAssignRoles], [true, false, false, false])
  const closed = P.capabilities({ ...base, userId: OWNER, closed: true })
  assert.deepEqual([closed.canManage, closed.canEditTasks, closed.readOnly], [false, false, true])
  assert.equal(P.capabilities({ ...base, userId: null }).readOnly, true)
})

test('WIP: counted from unfinished tasks of the stage; simple mode does not apply it', () => {
  const stage = { id: 's', wip_limit: 2 }
  const tasks = [{ stage_id: 's', status: 'doing' }, { stage_id: 's', status: 'doing' }, { stage_id: 's', status: 'doing' }, { stage_id: 's', status: 'done' }, { stage_id: 'x', status: 'doing' }]
  assert.deepEqual(P.wipState(stage, tasks, { mode: 'kanban', wip_mode: 'soft' }), { count: 3, limit: 2, applies: true, over: true, strict: false })
  assert.equal(P.wipState(stage, tasks, { mode: 'simple', wip_mode: 'strict' }).over, false)
  assert.equal(P.wipState({ id: 's', wip_limit: null }, tasks, { mode: 'kanban', wip_mode: 'soft' }).applies, false)
})

test('backlog order: moves and re-applying a local order to a fresh list without losing new tasks', () => {
  assert.deepEqual(P.moveInOrder(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  assert.deepEqual(P.moveInOrder(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'], 'out of range is ignored')
  assert.deepEqual(P.reapplyOrder(['c', 'a', 'b'], ['a', 'b', 'd']), ['a', 'b', 'd'], 'c left the backlog, d is new and follows')
  assert.deepEqual(P.reapplyOrder(['b', 'a'], ['a', 'b', 'd']), ['b', 'a', 'd'])
})

test('task planning fields are optional before the migration', () => {
  assert.equal(P.readTaskPlanning({ id: 't', status: 'todo' }), null)
  assert.deepEqual(P.readTaskPlanning({ stage_id: null, story_points: 5, planned_hours: '1.5', planning_version: 3 }), { stage_id: null, story_points: 5, planned_hours: 1.5, planning_version: 3 })
})

test('local date inputs keep the time of day in the device zone', () => {
  const iso = P.fromLocalInput('2026-12-01T09:30')
  assert.ok(iso)
  assert.equal(P.toLocalInput(iso), '2026-12-01T09:30')
  assert.equal(P.fromLocalInput(''), null)
})
