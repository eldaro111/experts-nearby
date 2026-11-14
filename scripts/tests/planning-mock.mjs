// MOCK of the ER-012 planning API for browser tests — a transport stand-in, NOT the database.
// It mirrors the documented contract (docs/reports/ER-012-scrum-ui-task.md): rights, expected versions,
// SQLSTATE codes and HTTP statuses as PostgREST would send them, snapshots and close decisions.
// The real SQL rules are tested separately in PGlite (planning-client-db.mjs, project-*-db.mjs).
// Known simplification: board PATCHes handled by ui-harness.mjs do not bump planning versions (the
// server triggers would); tests that need it change versions explicitly.
//
// The user of a request is read from its bearer token (`sub`), so an account switch in the browser
// is seen exactly as the server would see it.
import { randomUUID } from 'node:crypto'

const TABLES = ['project_planning', 'project_roles', 'project_stages', 'project_backlogs', 'project_sprints', 'project_sprint_items', 'project_sprint_events']
const RPCS = new Set(['update_project_planning', 'set_project_role', 'upsert_project_stage', 'archive_project_stage', 'edit_task_planning', 'get_project_backlog',
  'reorder_project_backlog', 'create_project_sprint', 'update_project_sprint', 'add_tasks_to_sprint', 'remove_task_from_sprint', 'start_project_sprint', 'close_project_sprint'])
const STATUS = { PT409: 409, 42501: 403, 23514: 400, 23505: 409, P0001: 400 }

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fail = (code, message) => { throw new ApiError(code, message) }
const clone = (value) => structuredClone(value)
const now = () => new Date().toISOString()

export function createPlanningMock(tables, { installed = true, sprintsInstalled = true } = {}) {
  for (const name of TABLES) tables[name] ||= []
  let eventId = 0
  const mock = {
    tables,
    calls: [],
    /** { fn, mode: 'drop' } — apply, then lose the response (network error); { fn, delayMs } — slow answer. */
    faults: [],
    install: (context) => context.route('https://pilot-test.supabase.co/rest/v1/**', (route) => handle(route)),
  }

  const listing = (id) => tables.listings.find((row) => row.id === id)
  const isMember = (project, user) => Boolean(user) && (listing(project)?.created_by === user
    || (tables.applications || []).some((a) => a.listing_id === project && a.user_id === user && a.status === 'accepted'))
  const settingsOf = (project) => tables.project_planning.find((row) => row.project_id === project)
  const ensureSettings = (project) => {
    let row = settingsOf(project)
    if (!row) { row = { project_id: project, mode: 'simple', goal: '', definition_of_done: '', wip_mode: 'soft', delegate_to_roles: false, version: 0 }; tables.project_planning.push(row) }
    return row
  }
  const hasRole = (project, user, roles) => tables.project_roles.some((r) => r.project_id === project && r.user_id === user && roles.includes(r.role))
  const canManage = (project, user) => isMember(project, user) && (listing(project)?.created_by === user
    || (Boolean(settingsOf(project)?.delegate_to_roles) && hasRole(project, user, ['product_owner', 'scrum_master'])))
  const lock = (project, user, manage = false) => {
    if (!user || !isMember(project, user)) fail('42501', 'Проект недоступен.')
    if (listing(project)?.completed_at) fail('23514', 'Проект завершён: планирование зафиксировано.')
    if (manage && !canManage(project, user)) fail('42501', 'Нет прав управления планированием.')
  }
  const planningVersion = (project, expected) => {
    const row = ensureSettings(project)
    if (expected !== row.version) fail('PT409', 'Планирование изменилось. Обновите данные.')
    return row
  }
  const task = (id) => tables.tasks.find((row) => row.id === id)
  const stage = (id) => tables.project_stages.find((row) => row.id === id)
  const effective = (s) => s.status_value ?? s.category
  const snapshotTask = (t) => ({ task_id: t.id, title: t.title, status: t.status, stage_id: t.stage_id ?? null, story_points: t.story_points ?? null, planned_hours: t.planned_hours ?? null,
    version: t.planning_version, assignee_id: t.assignee_id ?? null, start_at: t.start_at ?? null, due_at: t.due_at ?? null, completed_at: t.completed_at ?? null })
  const openItem = (taskId) => tables.project_sprint_items.find((i) => i.live_task_id === taskId && !i.removed_at)
  const touchBacklog = (project) => {
    let row = tables.project_backlogs.find((b) => b.project_id === project)
    if (!row) { row = { project_id: project, version: 0, task_order: [] }; tables.project_backlogs.push(row) }
    row.version += 1
  }
  const sprintEvent = (sprint, kind, data, user) => tables.project_sprint_events.push({ id: ++eventId, project_id: sprint.project_id, sprint_id: sprint.id, kind, actor_id: user, created_at: now(), data })
  const backlogOf = (project) => {
    const row = tables.project_backlogs.find((b) => b.project_id === project)
    const order = row?.task_order ?? []
    const rank = (t) => { const i = order.indexOf(t.id); return i < 0 ? Number.MAX_SAFE_INTEGER : i }
    const list = tables.tasks.filter((t) => t.project_id === project && t.status !== 'done' && !openItem(t.id))
      .sort((a, b) => rank(a) - rank(b) || String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))
    return { project_id: project, version: row?.version ?? 0, tasks: clone(list) }
  }
  const totals = (list) => {
    const points = list.filter((v) => v.story_points !== null)
    const hours = list.filter((v) => v.planned_hours !== null)
    return { tasks: list.length, story_points: points.length ? points.reduce((s, v) => s + v.story_points, 0) : null,
      planned_hours: hours.length ? Math.round(hours.reduce((s, v) => s + Number(v.planned_hours), 0) * 100) / 100 : null,
      unestimated_points: list.length - points.length, unestimated_hours: list.length - hours.length }
  }
  const sprintSnapshot = (sprint, start) => {
    const scope = tables.project_sprint_items.filter((i) => i.sprint_id === sprint.id && (!start || !i.removed_at))
      .map((i) => ({ ...i, value: i.exit_snapshot ?? (task(i.live_task_id) ? snapshotTask(task(i.live_task_id)) : i.entry_snapshot) }))
    const counted = scope.filter((i) => start || ['done', 'backlog', 'moved'].includes(i.outcome))
    return {
      captured_at: now(),
      items: scope.map((i) => ({ item_id: i.id, task_id: i.task_id, added_at: i.added_at, removed_at: i.removed_at, outcome: i.outcome, destination_sprint_id: i.destination_sprint_id, task: i.value })),
      totals: totals(counted.map((i) => i.value)),
      completed: totals(counted.filter((i) => i.value.status === 'done').map((i) => i.value)),
    }
  }
  const sprintLock = (id, expected, user, manage, requireScrum = true) => {
    const sprint = tables.project_sprints.find((s) => s.id === id)
    if (!sprint) fail('PT409', 'Спринт изменился. Обновите данные.')
    lock(sprint.project_id, user, manage)
    if (requireScrum && settingsOf(sprint.project_id)?.mode !== 'scrum') fail('23514', 'Операция требует режима scrum.')
    if (sprint.version !== expected) fail('PT409', 'Спринт изменился. Обновите данные.')
    return sprint
  }
  const bumpTask = (t) => {
    t.planning_version += 1
    for (const item of tables.project_sprint_items.filter((i) => i.live_task_id === t.id && !i.removed_at)) {
      const sprint = tables.project_sprints.find((s) => s.id === item.sprint_id)
      sprint.version += 1
    }
    touchBacklog(t.project_id)
  }

  const rpc = {
    update_project_planning(a, user) {
      lock(a.p_project_id, user, true)
      const v = planningVersion(a.p_project_id, a.p_expected_version)
      const owner = listing(a.p_project_id).created_by === user
      if (v.delegate_to_roles !== a.p_delegate_to_roles && !owner) fail('42501', 'Делегирование меняет только автор проекта.')
      if (a.p_mode !== 'scrum' && tables.project_sprints.some((s) => s.project_id === a.p_project_id && s.state === 'active')) fail('23514', 'Сначала завершите или отмените активный спринт.')
      const same = v.mode === a.p_mode && v.goal === a.p_goal && v.definition_of_done === a.p_definition_of_done && v.wip_mode === a.p_wip_mode && v.delegate_to_roles === a.p_delegate_to_roles
      if (same) return clone(v)
      Object.assign(v, { mode: a.p_mode, goal: a.p_goal, definition_of_done: a.p_definition_of_done, wip_mode: a.p_wip_mode, delegate_to_roles: a.p_delegate_to_roles, version: v.version + 1 })
      if (a.p_mode !== 'simple' && !tables.project_stages.some((s) => s.project_id === a.p_project_id)) {
        const make = (name, position, category) => ({ id: randomUUID(), project_id: a.p_project_id, name, position, category, status_value: null, policy: '', wip_limit: null, archived_at: null, version: 1 })
        const created = [make('К выполнению', 0, 'todo'), make('В работе', 1, 'doing'), make('Готово', 2, 'done')]
        tables.project_stages.push(...created)
        for (const t of tables.tasks.filter((t) => t.project_id === a.p_project_id)) {
          const match = created.find((s) => s.category === t.status)
          if (match) { t.stage_id = match.id; bumpTask(t) }
        }
      }
      return clone(v)
    },
    set_project_role(a, user) {
      lock(a.p_project_id, user)
      if (listing(a.p_project_id).created_by !== user) fail('42501', 'Роли назначает автор проекта.')
      const v = planningVersion(a.p_project_id, a.p_expected_version)
      if (a.p_assigned && !isMember(a.p_project_id, a.p_user_id)) fail('23514', 'Роль требует действующего членства.')
      const exists = hasRole(a.p_project_id, a.p_user_id, [a.p_role])
      if (exists === a.p_assigned) return clone(v)
      if (a.p_assigned) {
        if (a.p_role !== 'developer' && tables.project_roles.some((r) => r.project_id === a.p_project_id && r.role === a.p_role)) fail('23505', 'duplicate key value violates unique constraint "project_roles_one_lead"')
        tables.project_roles.push({ project_id: a.p_project_id, user_id: a.p_user_id, role: a.p_role })
      } else tables.project_roles = tables.project_roles.filter((r) => !(r.project_id === a.p_project_id && r.user_id === a.p_user_id && r.role === a.p_role))
      v.version += 1
      return clone(v)
    },
    upsert_project_stage(a, user) {
      lock(a.p_project_id, user, true)
      const planning = planningVersion(a.p_project_id, a.p_expected_planning_version)
      const active = tables.project_stages.filter((s) => s.project_id === a.p_project_id && !s.archived_at && s.id !== a.p_stage_id)
      if (active.some((s) => s.position === a.p_position) || active.some((s) => effective(s) === (a.p_status_value ?? a.p_category))) fail('23505', 'duplicate key value violates unique constraint "project_stages_active_position"')
      let row
      if (!a.p_stage_id) {
        if (a.p_expected_version !== 0) fail('PT409', 'Версия нового этапа должна быть 0.')
        row = { id: randomUUID(), project_id: a.p_project_id, name: a.p_name, position: a.p_position, category: a.p_category, status_value: a.p_status_value, policy: a.p_policy ?? '', wip_limit: a.p_wip_limit, archived_at: null, version: 1 }
        tables.project_stages.push(row)
      } else {
        row = stage(a.p_stage_id)
        if (!row || row.archived_at) fail('23514', 'Этап недоступен.')
        if (row.version !== a.p_expected_version) fail('PT409', 'Этап изменился.')
        if ((row.category !== a.p_category || row.status_value !== a.p_status_value) && tables.tasks.some((t) => t.stage_id === row.id)) fail('23514', 'Создайте новый этап и явно перенесите задачи при архивировании старого.')
        if (planning.mode !== 'simple' && planning.wip_mode === 'strict' && a.p_wip_limit !== null && tables.tasks.filter((t) => t.stage_id === row.id && t.status !== 'done').length > a.p_wip_limit) fail('23514', 'Лимит меньше текущего числа задач.')
        const same = row.name === a.p_name && row.position === a.p_position && row.category === a.p_category && row.status_value === a.p_status_value && row.policy === a.p_policy && row.wip_limit === a.p_wip_limit
        if (same) return clone(row)
        Object.assign(row, { name: a.p_name, position: a.p_position, category: a.p_category, status_value: a.p_status_value, policy: a.p_policy, wip_limit: a.p_wip_limit, version: row.version + 1 })
      }
      planning.version += 1
      return clone(row)
    },
    archive_project_stage(a, user) {
      lock(a.p_project_id, user, true)
      const planning = planningVersion(a.p_project_id, a.p_expected_planning_version)
      const row = stage(a.p_stage_id)
      if (!row) fail('23514', 'Этап недоступен.')
      if (row.version !== a.p_expected_version) fail('PT409', 'Этап изменился.')
      const used = tables.tasks.filter((t) => t.stage_id === row.id)
      if (used.length && !a.p_target_stage_id) fail('23514', 'Укажите этап для существующих задач.')
      const target = a.p_target_stage_id ? stage(a.p_target_stage_id) : null
      for (const t of used) { t.stage_id = target.id; t.status = effective(target); bumpTask(t) }
      Object.assign(row, { archived_at: now(), version: row.version + 1 })
      planning.version += 1
      return clone(row)
    },
    edit_task_planning(a, user) {
      const t = task(a.p_task_id)
      if (!t) fail('PT409', 'Задача удалена.')
      lock(t.project_id, user)
      if (t.planning_version !== a.p_expected_version) fail('PT409', 'Задача изменилась. Обновите данные.')
      if (a.p_story_points !== null && ![1, 2, 3, 5, 8, 13, 21].includes(a.p_story_points)) fail('23514', 'new row for relation "tasks" violates check constraint "tasks_story_points_check"')
      if ((t.stage_id ?? null) === a.p_stage_id && (t.story_points ?? null) === a.p_story_points && (t.planned_hours ?? null) === a.p_planned_hours) return clone(t)
      if (a.p_stage_id && a.p_stage_id !== t.stage_id) {
        const s = stage(a.p_stage_id)
        const planning = settingsOf(t.project_id)
        if (planning?.mode !== 'simple' && planning?.wip_mode === 'strict' && s.wip_limit !== null && effective(s) !== 'done'
          && tables.tasks.filter((x) => x.stage_id === s.id && x.id !== t.id && x.status !== 'done').length >= s.wip_limit) fail('23514', 'Превышен строгий WIP-лимит этапа.')
        t.status = effective(s)
      }
      Object.assign(t, { stage_id: a.p_stage_id, story_points: a.p_story_points, planned_hours: a.p_planned_hours })
      bumpTask(t)
      return clone(t)
    },
    get_project_backlog(a, user) {
      if (!isMember(a.p_project_id, user)) fail('42501', 'Проект недоступен.')
      return backlogOf(a.p_project_id)
    },
    reorder_project_backlog(a, user) {
      lock(a.p_project_id, user)
      if (listing(a.p_project_id).created_by !== user && !hasRole(a.p_project_id, user, ['product_owner'])) fail('42501', 'Порядок бэклога меняют автор и действующий Product Owner.')
      const current = backlogOf(a.p_project_id)
      if (current.version !== a.p_expected_version) fail('PT409', 'Бэклог изменился. Обновите данные.')
      const ids = current.tasks.map((t) => t.id)
      if (a.p_task_ids.length !== ids.length || !ids.every((id) => a.p_task_ids.includes(id))) fail('PT409', 'Состав бэклога изменился или содержит чужие задачи.')
      let row = tables.project_backlogs.find((b) => b.project_id === a.p_project_id)
      if (!row) { row = { project_id: a.p_project_id, version: 0, task_order: [] }; tables.project_backlogs.push(row) }
      if (a.p_task_ids.join() === ids.join()) return backlogOf(a.p_project_id)
      Object.assign(row, { task_order: [...a.p_task_ids], version: row.version + 1 })
      return backlogOf(a.p_project_id)
    },
    create_project_sprint(a, user) {
      lock(a.p_project_id, user, true)
      const planning = planningVersion(a.p_project_id, a.p_expected_planning_version)
      if (planning.mode !== 'scrum') fail('23514', 'Создание спринта требует режима scrum.')
      if (a.p_start_at && a.p_end_at && new Date(a.p_end_at) <= new Date(a.p_start_at)) fail('23514', 'new row for relation "project_sprints" violates check constraint')
      const number = Math.max(0, ...tables.project_sprints.filter((s) => s.project_id === a.p_project_id).map((s) => s.number)) + 1
      const row = { id: randomUUID(), project_id: a.p_project_id, number, name: a.p_name, goal: a.p_goal ?? '', start_at: a.p_start_at, end_at: a.p_end_at, state: 'planned', version: 1,
        created_at: now(), created_by: user, started_at: null, closed_at: null, close_reason: null, start_snapshot: null, final_snapshot: null }
      tables.project_sprints.push(row)
      planning.version += 1
      sprintEvent(row, 'created', clone(row), user)
      return clone(row)
    },
    update_project_sprint(a, user) {
      const s = sprintLock(a.p_sprint_id, a.p_expected_version, user, true)
      if (!['planned', 'active'].includes(s.state)) fail('23514', 'Закрытый спринт неизменяем.')
      if (a.p_start_at && a.p_end_at && new Date(a.p_end_at) <= new Date(a.p_start_at)) fail('23514', 'new row for relation "project_sprints" violates check constraint')
      if (s.name === a.p_name && s.goal === a.p_goal && s.start_at === a.p_start_at && s.end_at === a.p_end_at) return clone(s)
      const old = clone(s)
      Object.assign(s, { name: a.p_name, goal: a.p_goal, start_at: a.p_start_at, end_at: a.p_end_at, version: s.version + 1 })
      sprintEvent(s, 'updated', { old, new: clone(s) }, user)
      return clone(s)
    },
    add_tasks_to_sprint(a, user) {
      const s = sprintLock(a.p_sprint_id, a.p_expected_version, user, false)
      if (!['planned', 'active'].includes(s.state)) fail('23514', 'Закрытый спринт неизменяем.')
      if (s.state === 'active' && !canManage(s.project_id, user)) fail('42501', 'Активным составом управляет автор или делегат.')
      const added = []
      for (const item of [...a.p_tasks].sort((x, y) => x.task_id.localeCompare(y.task_id))) {
        const t = task(item.task_id)
        if (!t || t.project_id !== s.project_id) fail('23514', 'Задача недоступна или принадлежит другому проекту.')
        if (t.planning_version !== item.expected_version) fail('PT409', 'Задача изменилась. Обновите состав.')
        const open = openItem(t.id)
        if (open && open.sprint_id === s.id) continue
        if (t.status === 'done' || open) fail('23514', 'Задача завершена или уже включена в другой спринт.')
        added.push(t)
      }
      for (const t of added) tables.project_sprint_items.push({ id: randomUUID(), project_id: s.project_id, sprint_id: s.id, task_id: t.id, live_task_id: t.id, added_at: now(), added_by: user, removed_at: null, removed_by: null, outcome: null, destination_sprint_id: null, entry_snapshot: snapshotTask(t), exit_snapshot: null })
      if (!added.length) return clone(s)
      s.version += 1
      touchBacklog(s.project_id)
      sprintEvent(s, 'scope_added', { task_ids: added.map((t) => t.id), version: s.version }, user)
      return clone(s)
    },
    remove_task_from_sprint(a, user) {
      const s = sprintLock(a.p_sprint_id, a.p_expected_version, user, false)
      if (!['planned', 'active'].includes(s.state)) fail('23514', 'Закрытый спринт неизменяем.')
      if (s.state === 'active' && !canManage(s.project_id, user)) fail('42501', 'Активным составом управляет автор или делегат.')
      const t = task(a.p_task_id)
      if (!t) fail('23514', 'Задача недоступна.')
      if (t.planning_version !== a.p_expected_task_version) fail('PT409', 'Задача изменилась.')
      const item = tables.project_sprint_items.find((i) => i.sprint_id === s.id && i.live_task_id === t.id && !i.removed_at)
      if (!item) return clone(s)
      Object.assign(item, { removed_at: now(), removed_by: user, outcome: 'removed', exit_snapshot: snapshotTask(t) })
      s.version += 1
      touchBacklog(s.project_id)
      sprintEvent(s, 'scope_removed', { task_id: t.id, version: s.version }, user)
      return clone(s)
    },
    start_project_sprint(a, user) {
      const s = sprintLock(a.p_sprint_id, a.p_expected_version, user, true)
      if (s.state === 'active') return clone(s)
      if (s.state !== 'planned' || !s.start_at || !s.end_at) fail('23514', 'Для старта нужен планируемый спринт с датами.')
      if (tables.project_sprints.some((x) => x.project_id === s.project_id && x.state === 'active')) fail('23514', 'В проекте уже есть активный спринт.')
      if (!tables.project_sprint_items.some((i) => i.sprint_id === s.id && !i.removed_at)) fail('23514', 'Пустой спринт нельзя начать.')
      Object.assign(s, { state: 'active', started_at: now(), start_snapshot: sprintSnapshot(s, true), version: s.version + 1 })
      sprintEvent(s, 'started', { snapshot: s.start_snapshot, version: s.version }, user)
      return clone(s)
    },
    close_project_sprint(a, user) {
      const s = sprintLock(a.p_sprint_id, a.p_expected_version, user, true, false)
      const decisions = a.p_decisions
      if (typeof a.p_cancel !== 'boolean' || !Array.isArray(decisions)) fail('23514', 'Нужны тип закрытия и массив решений.')
      if (!['planned', 'active'].includes(s.state) || (!a.p_cancel && s.state !== 'active')) fail('23514', 'Нельзя закрыть спринт в этом состоянии.')
      if (a.p_cancel && !(a.p_reason ?? '').trim()) fail('23514', 'Для отмены нужна причина.')
      const bad = decisions.some((d) => !d.task_id || !['backlog', 'sprint'].includes(d.destination)
        || (d.destination === 'backlog' && (d.sprint_id != null || d.expected_sprint_version != null))
        || (d.destination === 'sprint' && (!d.sprint_id || d.expected_sprint_version == null || d.sprint_id === s.id)))
      if (bad || new Set(decisions.map((d) => d.task_id)).size !== decisions.length) fail('23514', 'Некорректные или повторные решения.')
      const targets = new Map()
      for (const d of decisions.filter((d) => d.destination === 'sprint')) {
        const target = tables.project_sprints.find((x) => x.id === d.sprint_id && x.project_id === s.project_id)
        if (!target || target.state !== 'planned') fail('23514', 'Цель переноса должна быть планируемым спринтом того же проекта.')
        if (target.version !== d.expected_sprint_version) fail('PT409', 'Целевой спринт изменился.')
        targets.set(target.id, target)
      }
      const open = tables.project_sprint_items.filter((i) => i.sprint_id === s.id && !i.removed_at)
      const unfinished = open.map((i) => task(i.live_task_id)).filter((t) => t && t.status !== 'done').map((t) => t.id).sort()
      if (unfinished.join() !== decisions.map((d) => d.task_id).sort().join()) fail('23514', 'Решение требуется ровно для каждой незавершённой задачи.')
      for (const item of open) {
        const t = task(item.live_task_id)
        const d = decisions.find((x) => x.task_id === t.id)
        const outcome = t.status === 'done' ? 'done' : d.destination === 'sprint' ? 'moved' : 'backlog'
        Object.assign(item, { removed_at: now(), removed_by: user, outcome, destination_sprint_id: outcome === 'moved' ? d.sprint_id : null, exit_snapshot: snapshotTask(t) })
        if (outcome === 'moved') tables.project_sprint_items.push({ id: randomUUID(), project_id: s.project_id, sprint_id: d.sprint_id, task_id: t.id, live_task_id: t.id, added_at: now(), added_by: user, removed_at: null, removed_by: null, outcome: null, destination_sprint_id: null, entry_snapshot: snapshotTask(t), exit_snapshot: null })
      }
      for (const target of targets.values()) { target.version += 1; sprintEvent(target, 'scope_added', { from_sprint_id: s.id, version: target.version }, user) }
      const final = sprintSnapshot(s, false)
      Object.assign(s, { state: a.p_cancel ? 'cancelled' : 'completed', closed_at: now(), close_reason: a.p_reason, final_snapshot: final, version: s.version + 1 })
      touchBacklog(s.project_id)
      sprintEvent(s, a.p_cancel ? 'cancelled' : 'completed', { reason: a.p_reason, decisions, snapshot: final, version: s.version }, user)
      return clone(s)
    },
  }

  const userOf = (req) => {
    const token = (req.headers().authorization || '').replace(/^Bearer\s+/i, '')
    try { return JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString()).sub || null } catch { return null }
  }
  const respond = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) })

  async function handle(route) {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fallback()
    const url = new URL(req.url())
    const name = url.pathname.split('/').at(-1)
    const isRpc = url.pathname.includes('/rpc/')
    const user = userOf(req)
    // Deleting a task: the server trigger records the outcome in an open sprint first.
    if (!isRpc && name === 'tasks' && req.method() === 'DELETE' && installed) {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./, '')
      const t = task(id)
      for (const item of tables.project_sprint_items.filter((i) => i.live_task_id === id && !i.removed_at)) {
        const sprint = tables.project_sprints.find((s) => s.id === item.sprint_id)
        if (sprint.state === 'active' && !canManage(sprint.project_id, user)) return respond(route, 403, { code: '42501', message: 'Удаление задачи меняет активный состав: нужны права управляющего.' })
        Object.assign(item, { removed_at: now(), removed_by: user, outcome: 'deleted', exit_snapshot: snapshotTask(t), live_task_id: null })
        sprint.version += 1
      }
      for (const item of tables.project_sprint_items.filter((i) => i.live_task_id === id)) item.live_task_id = null
      return route.fallback()
    }
    if (!(isRpc ? RPCS.has(name) : TABLES.includes(name))) return route.fallback()
    const missing = !installed || (!sprintsInstalled && (['project_backlogs', 'project_sprints', 'project_sprint_items', 'project_sprint_events'].includes(name)
      || ['get_project_backlog', 'reorder_project_backlog', 'create_project_sprint', 'update_project_sprint', 'add_tasks_to_sprint', 'remove_task_from_sprint', 'start_project_sprint', 'close_project_sprint'].includes(name)))
    if (missing) {
      return isRpc
        ? respond(route, 404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` })
        : respond(route, 404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` })
    }
    const fault = mock.faults.find((f) => f.fn === name)
    if (fault) mock.faults.splice(mock.faults.indexOf(fault), 1)
    if (fault?.delayMs) await new Promise((resolve) => setTimeout(resolve, fault.delayMs))
    if (isRpc) {
      const args = req.postDataJSON() || {}
      mock.calls.push({ fn: name, user, args })
      try {
        const data = rpc[name](args, user)
        if (fault?.mode === 'drop') return route.abort('failed')
        return respond(route, 200, data)
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        return respond(route, STATUS[error.code] || 400, { code: error.code, message: error.message, details: null, hint: null })
      }
    }
    // Table read with RLS: members only.
    let rows = tables[name].filter((row) => isMember(row.project_id, user))
    for (const [key, raw] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue
      if (raw === 'is.null') rows = rows.filter((row) => row[key] == null)
      else if (raw.startsWith('eq.')) rows = rows.filter((row) => String(row[key]) === raw.slice(3))
      else if (raw.startsWith('in.(')) { const list = raw.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, '')); rows = rows.filter((row) => list.includes(String(row[key]))) }
    }
    const order = url.searchParams.get('order')
    if (order) {
      const keys = order.split(',').map((part) => { const [column, dir] = part.split('.'); return { column, desc: dir === 'desc' } })
      rows = [...rows].sort((x, y) => { for (const { column, desc } of keys) { if (x[column] < y[column]) return desc ? 1 : -1; if (x[column] > y[column]) return desc ? -1 : 1 } return 0 })
    }
    if (url.searchParams.has('limit')) rows = rows.slice(0, Number(url.searchParams.get('limit')))
    return respond(route, 200, clone(rows))
  }

  return mock
}
