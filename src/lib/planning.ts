// ER-012 planning client: project modes, stages, estimates, backlog and sprints.
//
// The server is the only source of rights, versions and history
// (supabase/migrations/20261114090000_project_planning.sql, 20261114100000_project_sprints.sql,
// docs/reports/ER-012-scrum-ui-task.md). This module:
// - calls every RPC with the exact named arguments of the SQL signatures and whole values (no patches);
// - parses every answer before the UI sees it (no unchecked casts in components);
// - maps SQLSTATE codes to explicit outcomes: PT409 conflict, 42501 forbidden, 23514 rule, 23505 taken,
//   P0001 closed project, missing relation/function — the server feature is not installed yet;
// - never retries a write by itself. After a timeout the caller reads the state again.
//
// It has no Supabase import: the transport is passed in (`PlanningDb`), so the same code runs against
// the browser client (planningClient.ts) and, in tests, against PGlite with the real migrations.

export type PlanningMode = 'simple' | 'kanban' | 'scrum' | 'custom'
export type WipMode = 'soft' | 'strict'
export type PlanningRoleName = 'product_owner' | 'scrum_master' | 'developer'
export type StageCategory = 'todo' | 'doing' | 'done'
export type SprintState = 'planned' | 'active' | 'completed' | 'cancelled'
export type SprintOutcome = 'done' | 'backlog' | 'moved' | 'removed' | 'deleted'

export const PLANNING_MODES: PlanningMode[] = ['simple', 'kanban', 'scrum', 'custom']
export const STORY_POINTS = [1, 2, 3, 5, 8, 13, 21] as const
export const MAX_PLANNED_HOURS = 2000
export const MAX_BACKLOG = 5000
export const GOAL_MAX = 4000
export const DOD_MAX = 8000
export const POLICY_MAX = 8000
export const SPRINT_GOAL_MAX = 4000
export const REASON_MAX = 2000

export interface PlanningSettings {
  project_id: string
  mode: PlanningMode
  goal: string
  definition_of_done: string
  wip_mode: WipMode
  delegate_to_roles: boolean
  version: number
  /** false — no row yet: the defaults of an existing project (simple, version 0). */
  stored: boolean
}

export type SettingsDraft = Pick<PlanningSettings, 'mode' | 'goal' | 'definition_of_done' | 'wip_mode' | 'delegate_to_roles'>

export interface PlanningRole { user_id: string; role: PlanningRoleName }

export interface ProjectStage {
  id: string
  project_id: string
  name: string
  position: number
  category: StageCategory
  status_value: string | null
  policy: string
  wip_limit: number | null
  archived_at: string | null
  version: number
}

export interface StageDraft {
  id: string | null
  /** 0 for a new stage. */
  version: number
  name: string
  position: number
  category: StageCategory
  status_value: string | null
  policy: string
  wip_limit: number | null
}

/** Planning fields of a task row (present once the first migration is applied). */
export interface TaskPlanning {
  stage_id: string | null
  story_points: number | null
  planned_hours: number | null
  planning_version: number
}

export interface PlanningTask extends TaskPlanning {
  id: string
  project_id: string
  title: string
  description: string | null
  status: string
  assignee_id: string | null
  created_at: string
  start_at: string | null
  due_at: string | null
  completed_at: string | null
}

export interface Backlog { project_id: string; version: number; tasks: PlanningTask[] }

export interface SnapshotTask {
  task_id: string
  title: string
  status: string
  stage_id: string | null
  story_points: number | null
  planned_hours: number | null
  version: number | null
  assignee_id: string | null
  start_at: string | null
  due_at: string | null
  completed_at: string | null
}

export interface SnapshotItem {
  item_id: string
  task_id: string
  added_at: string
  removed_at: string | null
  outcome: SprintOutcome | null
  destination_sprint_id: string | null
  task: SnapshotTask
}

/** Sums are NULL when nothing is estimated; the unestimated counters stand next to them. */
export interface SnapshotTotals {
  tasks: number
  story_points: number | null
  planned_hours: number | null
  unestimated_points: number
  unestimated_hours: number
}

export interface SprintSnapshot {
  captured_at: string
  items: SnapshotItem[]
  totals: SnapshotTotals
  completed: SnapshotTotals
}

export interface Sprint {
  id: string
  project_id: string
  number: number
  name: string
  goal: string
  start_at: string | null
  end_at: string | null
  state: SprintState
  version: number
  created_at: string
  created_by: string | null
  started_at: string | null
  closed_at: string | null
  close_reason: string | null
  start_snapshot: SprintSnapshot | null
  final_snapshot: SprintSnapshot | null
}

export interface SprintDraft { name: string; goal: string; start_at: string | null; end_at: string | null }

export interface SprintItem {
  id: string
  project_id: string
  sprint_id: string
  task_id: string
  /** NULL after the task was deleted; `task_id` stays. */
  live_task_id: string | null
  added_at: string
  added_by: string | null
  removed_at: string | null
  removed_by: string | null
  outcome: SprintOutcome | null
  destination_sprint_id: string | null
  entry_snapshot: SnapshotTask
  exit_snapshot: SnapshotTask | null
}

export interface SprintEvent {
  id: number
  sprint_id: string
  kind: string
  actor_id: string | null
  created_at: string
  data: unknown
}

export type CloseDecision =
  | { task_id: string; destination: 'backlog' }
  | { task_id: string; destination: 'sprint'; sprint_id: string; expected_sprint_version: number }

// ---------------------------------------------------------------------------------------------
// Transport

export interface DbError { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }
export interface DbResult { data: unknown; error: DbError | null }

export type PlanningTable =
  | 'project_planning' | 'project_roles' | 'project_stages' | 'project_sprints'
  | 'project_sprint_items' | 'project_sprint_events' | 'contributions'

export interface SelectQuery {
  columns: string
  eq?: Record<string, string>
  in?: { column: string; values: string[] }
  isNull?: string[]
  order?: { column: string; ascending: boolean }[]
  limit?: number
}

export type PlanningRpc =
  | 'update_project_planning' | 'set_project_role' | 'upsert_project_stage' | 'archive_project_stage'
  | 'edit_task_planning' | 'get_project_backlog' | 'reorder_project_backlog' | 'create_project_sprint'
  | 'update_project_sprint' | 'add_tasks_to_sprint' | 'remove_task_from_sprint' | 'start_project_sprint'
  | 'close_project_sprint'
  | 'reorder_project_stages' | 'replace_project_lead' | 'create_project_sprint_once'
  | 'close_project_sprint_once' | 'get_project_planning_request'

/** The two operations this module needs; see planningClient.ts for the Supabase implementation. */
export interface PlanningDb {
  rpc(fn: PlanningRpc, args: Record<string, unknown>, signal: AbortSignal): Promise<DbResult>
  select(table: PlanningTable, query: SelectQuery, signal: AbortSignal): Promise<DbResult>
}

// ---------------------------------------------------------------------------------------------
// Errors

export type PlanningErrorKind =
  | 'conflict' | 'forbidden' | 'rule' | 'taken' | 'closed_project' | 'unavailable'
  | 'network' | 'timeout' | 'invalid_response' | 'unknown'

export interface PlanningError {
  kind: PlanningErrorKind
  code: string
  /** Server text (already user-facing in the SQL) or a client explanation. */
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: PlanningError }

const UNAVAILABLE_CODES = new Set(['PGRST202', 'PGRST205', 'PGRST200', '42P01', '42883', '42703'])

export const ERROR_TEXT: Record<PlanningErrorKind, string> = {
  conflict: 'Данные уже изменились. Показаны актуальные данные — проверьте их и повторите действие.',
  forbidden: 'Недостаточно прав для этого действия.',
  rule: 'Действие нарушает правило планирования.',
  taken: 'Роль, позиция или статус уже заняты.',
  closed_project: 'Проект завершён: планирование доступно только для чтения.',
  unavailable: 'Планирование пока недоступно на сервере: обновление базы данных ещё не применено.',
  network: 'Нет связи с сервером. Изменение могло не сохраниться — проверьте актуальные данные.',
  timeout: 'Сервер не ответил вовремя. Результат неизвестен — проверьте актуальные данные.',
  invalid_response: 'Сервер вернул неожиданный ответ. Обновите данные.',
  unknown: 'Не удалось выполнить действие.',
}

export function classifyError(error: DbError | null | undefined, timedOut = false): PlanningError {
  const code = String(error?.code ?? '').trim()
  const serverMessage = String(error?.message ?? '').trim()
  if (timedOut) return { kind: 'timeout', code, message: ERROR_TEXT.timeout }
  const kind: PlanningErrorKind =
    code === 'PT409' ? 'conflict'
      : code === '42501' ? 'forbidden'
        : code === '23514' || code === '22023' ? 'rule'
          : code === '23505' ? 'taken'
            : code === 'P0001' ? (/заверш/i.test(serverMessage) ? 'closed_project' : 'rule')
              : UNAVAILABLE_CODES.has(code) ? 'unavailable'
                : !code && /fetch|network|load failed|abort/i.test(serverMessage) ? 'network'
                  : code === '23503' || code === '22P02' || code === '23502' || code === '22023' ? 'rule'
                    : 'unknown'
  // Rule and right violations carry a precise Russian text from the SQL; keep it.
  const keepServer = (kind === 'rule' || kind === 'forbidden' || kind === 'conflict' || kind === 'closed_project') && serverMessage
  return { kind, code, message: keepServer ? serverMessage : ERROR_TEXT[kind] }
}

const invalid = (what: string): PlanningError => ({ kind: 'invalid_response', code: '', message: `${ERROR_TEXT.invalid_response} (${what})` })

// ---------------------------------------------------------------------------------------------
// Safe parsing

class ParseError extends Error {}
type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value)
const fail = (field: string): never => { throw new ParseError(field) }
const str = (o: Obj, k: string): string => (typeof o[k] === 'string' ? (o[k] as string) : fail(k))
const strOrNull = (o: Obj, k: string): string | null => (o[k] === null || o[k] === undefined ? null : str(o, k))
const toNumber = (value: unknown, k: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fail(k)
}
const num = (o: Obj, k: string): number => toNumber(o[k], k)
const numOrNull = (o: Obj, k: string): number | null => (o[k] === null || o[k] === undefined ? null : num(o, k))
const bool = (o: Obj, k: string): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : fail(k))
const oneOf = <T extends string>(o: Obj, k: string, values: readonly T[]): T => {
  const value = str(o, k)
  return (values as readonly string[]).includes(value) ? (value as T) : fail(k)
}
const oneOfOrNull = <T extends string>(o: Obj, k: string, values: readonly T[]): T | null => (o[k] === null || o[k] === undefined ? null : oneOf(o, k, values))
const obj = (value: unknown, k: string): Obj => (isObj(value) ? value : fail(k))
const list = (value: unknown, k: string): unknown[] => (Array.isArray(value) ? value : fail(k))

const OUTCOMES: SprintOutcome[] = ['done', 'backlog', 'moved', 'removed', 'deleted']
const STATES: SprintState[] = ['planned', 'active', 'completed', 'cancelled']
const ROLES: PlanningRoleName[] = ['product_owner', 'scrum_master', 'developer']

export const defaultSettings = (projectId: string): PlanningSettings => ({
  project_id: projectId, mode: 'simple', goal: '', definition_of_done: '', wip_mode: 'soft', delegate_to_roles: false, version: 0, stored: false,
})

export function parseSettings(value: unknown): PlanningSettings {
  const o = obj(value, 'project_planning')
  return {
    project_id: str(o, 'project_id'),
    mode: oneOf(o, 'mode', PLANNING_MODES),
    goal: str(o, 'goal'),
    definition_of_done: str(o, 'definition_of_done'),
    wip_mode: oneOf(o, 'wip_mode', ['soft', 'strict'] as const),
    delegate_to_roles: bool(o, 'delegate_to_roles'),
    version: num(o, 'version'),
    stored: true,
  }
}

export function parseRole(value: unknown): PlanningRole {
  const o = obj(value, 'project_roles')
  return { user_id: str(o, 'user_id'), role: oneOf(o, 'role', ROLES) }
}

export function parseStage(value: unknown): ProjectStage {
  const o = obj(value, 'project_stages')
  return {
    id: str(o, 'id'),
    project_id: str(o, 'project_id'),
    name: str(o, 'name'),
    position: num(o, 'position'),
    category: oneOf(o, 'category', ['todo', 'doing', 'done'] as const),
    status_value: strOrNull(o, 'status_value'),
    policy: typeof o.policy === 'string' ? o.policy : '',
    wip_limit: numOrNull(o, 'wip_limit'),
    archived_at: strOrNull(o, 'archived_at'),
    version: num(o, 'version'),
  }
}

/** The effective status of a stage: the task status it stands for. */
export const stageStatus = (stage: Pick<ProjectStage, 'status_value' | 'category'>) => stage.status_value ?? stage.category

export function parseTask(value: unknown): PlanningTask {
  const o = obj(value, 'tasks')
  return {
    id: str(o, 'id'),
    project_id: str(o, 'project_id'),
    title: str(o, 'title'),
    description: strOrNull(o, 'description'),
    status: str(o, 'status'),
    assignee_id: strOrNull(o, 'assignee_id'),
    created_at: str(o, 'created_at'),
    start_at: strOrNull(o, 'start_at'),
    due_at: strOrNull(o, 'due_at'),
    completed_at: strOrNull(o, 'completed_at'),
    stage_id: strOrNull(o, 'stage_id'),
    story_points: numOrNull(o, 'story_points'),
    planned_hours: numOrNull(o, 'planned_hours'),
    planning_version: num(o, 'planning_version'),
  }
}

/** Planning fields of a task row from the regular `select *`; null before the migration. */
export function readTaskPlanning(value: unknown): TaskPlanning | null {
  if (!isObj(value) || value.planning_version === undefined) return null
  try {
    return {
      stage_id: strOrNull(value, 'stage_id'),
      story_points: numOrNull(value, 'story_points'),
      planned_hours: numOrNull(value, 'planned_hours'),
      planning_version: num(value, 'planning_version'),
    }
  } catch {
    return null
  }
}

export function parseBacklog(value: unknown): Backlog {
  const o = obj(value, 'backlog')
  return { project_id: str(o, 'project_id'), version: num(o, 'version'), tasks: list(o.tasks, 'tasks').map(parseTask) }
}

function parseSnapshotTask(value: unknown): SnapshotTask {
  const o = obj(value, 'snapshot.task')
  return {
    task_id: str(o, 'task_id'),
    title: typeof o.title === 'string' ? o.title : '',
    status: typeof o.status === 'string' ? o.status : '',
    stage_id: strOrNull(o, 'stage_id'),
    story_points: numOrNull(o, 'story_points'),
    planned_hours: numOrNull(o, 'planned_hours'),
    version: numOrNull(o, 'version'),
    assignee_id: strOrNull(o, 'assignee_id'),
    start_at: strOrNull(o, 'start_at'),
    due_at: strOrNull(o, 'due_at'),
    completed_at: strOrNull(o, 'completed_at'),
  }
}

function parseTotals(value: unknown, k: string): SnapshotTotals {
  const o = obj(value, k)
  return {
    tasks: num(o, 'tasks'),
    story_points: numOrNull(o, 'story_points'),
    planned_hours: numOrNull(o, 'planned_hours'),
    unestimated_points: num(o, 'unestimated_points'),
    unestimated_hours: num(o, 'unestimated_hours'),
  }
}

export function parseSnapshot(value: unknown): SprintSnapshot {
  const o = obj(value, 'snapshot')
  return {
    captured_at: str(o, 'captured_at'),
    items: list(o.items, 'snapshot.items').map((raw) => {
      const item = obj(raw, 'snapshot.item')
      return {
        item_id: str(item, 'item_id'),
        task_id: str(item, 'task_id'),
        added_at: str(item, 'added_at'),
        removed_at: strOrNull(item, 'removed_at'),
        outcome: oneOfOrNull(item, 'outcome', OUTCOMES),
        destination_sprint_id: strOrNull(item, 'destination_sprint_id'),
        task: parseSnapshotTask(item.task),
      }
    }),
    totals: parseTotals(o.totals, 'snapshot.totals'),
    completed: parseTotals(o.completed, 'snapshot.completed'),
  }
}

export function parseSprint(value: unknown): Sprint {
  const o = obj(value, 'project_sprints')
  return {
    id: str(o, 'id'),
    project_id: str(o, 'project_id'),
    number: num(o, 'number'),
    name: str(o, 'name'),
    goal: typeof o.goal === 'string' ? o.goal : '',
    start_at: strOrNull(o, 'start_at'),
    end_at: strOrNull(o, 'end_at'),
    state: oneOf(o, 'state', STATES),
    version: num(o, 'version'),
    created_at: str(o, 'created_at'),
    created_by: strOrNull(o, 'created_by'),
    started_at: strOrNull(o, 'started_at'),
    closed_at: strOrNull(o, 'closed_at'),
    close_reason: strOrNull(o, 'close_reason'),
    start_snapshot: o.start_snapshot == null ? null : parseSnapshot(o.start_snapshot),
    final_snapshot: o.final_snapshot == null ? null : parseSnapshot(o.final_snapshot),
  }
}

export function parseSprintItem(value: unknown): SprintItem {
  const o = obj(value, 'project_sprint_items')
  return {
    id: str(o, 'id'),
    project_id: str(o, 'project_id'),
    sprint_id: str(o, 'sprint_id'),
    task_id: str(o, 'task_id'),
    live_task_id: strOrNull(o, 'live_task_id'),
    added_at: str(o, 'added_at'),
    added_by: strOrNull(o, 'added_by'),
    removed_at: strOrNull(o, 'removed_at'),
    removed_by: strOrNull(o, 'removed_by'),
    outcome: oneOfOrNull(o, 'outcome', OUTCOMES),
    destination_sprint_id: strOrNull(o, 'destination_sprint_id'),
    entry_snapshot: parseSnapshotTask(o.entry_snapshot),
    exit_snapshot: o.exit_snapshot == null ? null : parseSnapshotTask(o.exit_snapshot),
  }
}

export function parseSprintEvent(value: unknown): SprintEvent {
  const o = obj(value, 'project_sprint_events')
  return { id: num(o, 'id'), sprint_id: str(o, 'sprint_id'), kind: str(o, 'kind'), actor_id: strOrNull(o, 'actor_id'), created_at: str(o, 'created_at'), data: o.data ?? null }
}

/** PostgREST returns a composite as an object; a defensive client also accepts a one-row array. */
const single = (data: unknown): unknown => (Array.isArray(data) ? (data.length === 1 ? data[0] : fail('single row')) : data)

// ---------------------------------------------------------------------------------------------
// Calls

export const DEFAULT_TIMEOUT_MS = 20_000

async function run<T>(request: (signal: AbortSignal) => Promise<DbResult>, parse: (data: unknown) => T, timeoutMs: number, what: string): Promise<Result<T>> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const { data, error } = await request(controller.signal)
    if (error) return { ok: false, error: classifyError(error, timedOut) }
    if (timedOut) return { ok: false, error: classifyError(null, true) }
    try {
      return { ok: true, data: parse(data) }
    } catch (cause) {
      return { ok: false, error: invalid(cause instanceof ParseError ? `${what}: ${cause.message}` : what) }
    }
  } catch (cause) {
    return { ok: false, error: classifyError({ message: cause instanceof Error ? cause.message : String(cause) }, timedOut) }
  } finally {
    clearTimeout(timer)
  }
}

export interface CallOptions { timeoutMs?: number }

const call = <T>(db: PlanningDb, fn: PlanningRpc, args: Record<string, unknown>, parse: (data: unknown) => T, options: CallOptions = {}) =>
  run((signal) => db.rpc(fn, args, signal), parse, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, fn)

const read = <T>(db: PlanningDb, table: PlanningTable, query: SelectQuery, parse: (rows: unknown[]) => T, options: CallOptions = {}) =>
  run((signal) => db.select(table, query, signal), (data) => parse(list(data, table)), options.timeoutMs ?? DEFAULT_TIMEOUT_MS, table)

// Reads ------------------------------------------------------------------------------------------

export const loadSettings = (db: PlanningDb, projectId: string, options?: CallOptions) =>
  read(db, 'project_planning', { columns: '*', eq: { project_id: projectId }, limit: 1 },
    (rows) => (rows.length ? parseSettings(rows[0]) : defaultSettings(projectId)), options)

export const loadRoles = (db: PlanningDb, projectId: string, options?: CallOptions) =>
  read(db, 'project_roles', { columns: 'user_id,role', eq: { project_id: projectId } }, (rows) => rows.map(parseRole), options)

/** Active stages in board order; archived ones stay on the server for history. */
export const loadStages = (db: PlanningDb, projectId: string, options?: CallOptions) =>
  read(db, 'project_stages', { columns: '*', eq: { project_id: projectId }, isNull: ['archived_at'], order: [{ column: 'position', ascending: true }] },
    (rows) => rows.map(parseStage), options)

export const loadSprints = (db: PlanningDb, projectId: string, options?: CallOptions) =>
  read(db, 'project_sprints', { columns: '*', eq: { project_id: projectId }, order: [{ column: 'number', ascending: false }] },
    (rows) => rows.map(parseSprint), options)

/** Open scope (not removed) of the given sprints. */
export const loadOpenItems = (db: PlanningDb, sprintIds: string[], options?: CallOptions): Promise<Result<SprintItem[]>> =>
  sprintIds.length === 0
    ? Promise.resolve({ ok: true, data: [] })
    : read(db, 'project_sprint_items', { columns: '*', in: { column: 'sprint_id', values: sprintIds }, isNull: ['removed_at'], order: [{ column: 'added_at', ascending: true }, { column: 'id', ascending: true }] },
      (rows) => rows.map(parseSprintItem), options)

/** Every scope item of one sprint, including removed and deleted ones. */
export const loadSprintItems = (db: PlanningDb, sprintId: string, options?: CallOptions) =>
  read(db, 'project_sprint_items', { columns: '*', eq: { sprint_id: sprintId }, order: [{ column: 'added_at', ascending: true }, { column: 'id', ascending: true }] },
    (rows) => rows.map(parseSprintItem), options)

/** Ordered by id; gaps after rolled back transactions are normal. */
export const loadSprintEvents = (db: PlanningDb, sprintId: string, options?: CallOptions) =>
  read(db, 'project_sprint_events', { columns: '*', eq: { sprint_id: sprintId }, order: [{ column: 'id', ascending: true }] },
    (rows) => rows.map(parseSprintEvent), options)

/** Actual hours come from contributions (no new field). */
export const loadTaskActualHours = (db: PlanningDb, taskId: string, options?: CallOptions) =>
  read(db, 'contributions', { columns: 'hours', eq: { task_id: taskId } }, (rows) => {
    let total = 0
    let counted = 0
    for (const row of rows) {
      const hours = isObj(row) ? row.hours : null
      if (hours === null || hours === undefined) continue
      total += toNumber(hours, 'hours')
      counted += 1
    }
    return { hours: counted ? Math.round(total * 100) / 100 : null, contributions: rows.length }
  }, options)

/** Member-only; also the membership probe of the panel (42501 for outsiders and revoked members). */
export const loadBacklog = (db: PlanningDb, projectId: string, options?: CallOptions) =>
  call(db, 'get_project_backlog', { p_project_id: projectId }, (data) => parseBacklog(single(data)), options)

// Writes: whole values, expected versions, never retried here ---------------------------------------

export const saveSettings = (db: PlanningDb, projectId: string, expectedVersion: number, draft: SettingsDraft, options?: CallOptions) =>
  call(db, 'update_project_planning', {
    p_project_id: projectId,
    p_expected_version: expectedVersion,
    p_mode: draft.mode,
    p_goal: draft.goal,
    p_definition_of_done: draft.definition_of_done,
    p_wip_mode: draft.wip_mode,
    p_delegate_to_roles: draft.delegate_to_roles,
  }, (data) => parseSettings(single(data)), options)

export const setRole = (db: PlanningDb, projectId: string, expectedVersion: number, userId: string, role: PlanningRoleName, assigned: boolean, options?: CallOptions) =>
  call(db, 'set_project_role', {
    p_project_id: projectId, p_expected_version: expectedVersion, p_user_id: userId, p_role: role, p_assigned: assigned,
  }, (data) => parseSettings(single(data)), options)

export const replaceLead = (db: PlanningDb, projectId: string, expectedVersion: number, role: 'product_owner' | 'scrum_master', userId: string | null, options?: CallOptions) =>
  call(db, 'replace_project_lead', { p_project_id: projectId, p_expected_planning_version: expectedVersion, p_role: role, p_user_id: userId }, (data) => parseSettings(single(data)), options)

export const reorderStages = (db: PlanningDb, projectId: string, expectedVersion: number, stageIds: string[], options?: CallOptions) =>
  call(db, 'reorder_project_stages', { p_project_id: projectId, p_expected_planning_version: expectedVersion, p_stage_ids: stageIds }, (data) => parseSettings(single(data)), options)

/** After this call the planning version has changed: read the settings again. */
export const saveStage = (db: PlanningDb, projectId: string, expectedPlanningVersion: number, stage: StageDraft, options?: CallOptions) =>
  call(db, 'upsert_project_stage', {
    p_project_id: projectId,
    p_expected_planning_version: expectedPlanningVersion,
    p_stage_id: stage.id,
    p_expected_version: stage.id ? stage.version : 0,
    p_name: stage.name,
    p_position: stage.position,
    p_category: stage.category,
    p_status_value: stage.status_value,
    p_policy: stage.policy,
    p_wip_limit: stage.wip_limit,
  }, (data) => parseStage(single(data)), options)

export const archiveStage = (db: PlanningDb, projectId: string, expectedPlanningVersion: number, stage: Pick<ProjectStage, 'id' | 'version'>, targetStageId: string | null, options?: CallOptions) =>
  call(db, 'archive_project_stage', {
    p_project_id: projectId,
    p_expected_planning_version: expectedPlanningVersion,
    p_stage_id: stage.id,
    p_expected_version: stage.version,
    p_target_stage_id: targetStageId,
  }, (data) => parseStage(single(data)), options)

export const editTaskPlanning = (db: PlanningDb, taskId: string, expectedVersion: number, values: Omit<TaskPlanning, 'planning_version'>, options?: CallOptions) =>
  call(db, 'edit_task_planning', {
    p_task_id: taskId,
    p_expected_version: expectedVersion,
    p_stage_id: values.stage_id,
    p_story_points: values.story_points,
    p_planned_hours: values.planned_hours,
  }, (data) => parseTask(single(data)), options)

export function reorderBacklog(db: PlanningDb, projectId: string, expectedVersion: number, taskIds: string[], options?: CallOptions): Promise<Result<Backlog>> {
  if (taskIds.length > MAX_BACKLOG || new Set(taskIds).size !== taskIds.length) {
    return Promise.resolve({ ok: false, error: { kind: 'rule', code: 'client', message: 'Порядок можно сохранить для не более чем 5000 уникальных задач.' } })
  }
  return call(db, 'reorder_project_backlog', { p_project_id: projectId, p_expected_version: expectedVersion, p_task_ids: taskIds }, (data) => parseBacklog(single(data)), options)
}

export const createSprint = (db: PlanningDb, projectId: string, expectedPlanningVersion: number, draft: SprintDraft, options?: CallOptions) =>
  call(db, 'create_project_sprint', {
    p_project_id: projectId, p_expected_planning_version: expectedPlanningVersion,
    p_name: draft.name, p_goal: draft.goal, p_start_at: draft.start_at, p_end_at: draft.end_at,
  }, (data) => parseSprint(single(data)), options)

export const updateSprint = (db: PlanningDb, sprintId: string, expectedVersion: number, draft: SprintDraft, options?: CallOptions) =>
  call(db, 'update_project_sprint', {
    p_sprint_id: sprintId, p_expected_version: expectedVersion,
    p_name: draft.name, p_goal: draft.goal, p_start_at: draft.start_at, p_end_at: draft.end_at,
  }, (data) => parseSprint(single(data)), options)

export function addTasksToSprint(db: PlanningDb, sprintId: string, expectedVersion: number, tasks: { task_id: string; expected_version: number }[], options?: CallOptions): Promise<Result<Sprint>> {
  if (tasks.length === 0 || tasks.length > MAX_BACKLOG) {
    return Promise.resolve({ ok: false, error: { kind: 'rule', code: 'client', message: 'Выберите от 1 до 5000 задач.' } })
  }
  return call(db, 'add_tasks_to_sprint', { p_sprint_id: sprintId, p_expected_version: expectedVersion, p_tasks: tasks }, (data) => parseSprint(single(data)), options)
}

export const removeTaskFromSprint = (db: PlanningDb, sprintId: string, expectedVersion: number, taskId: string, expectedTaskVersion: number, options?: CallOptions) =>
  call(db, 'remove_task_from_sprint', {
    p_sprint_id: sprintId, p_expected_version: expectedVersion, p_task_id: taskId, p_expected_task_version: expectedTaskVersion,
  }, (data) => parseSprint(single(data)), options)

export const startSprint = (db: PlanningDb, sprintId: string, expectedVersion: number, options?: CallOptions) =>
  call(db, 'start_project_sprint', { p_sprint_id: sprintId, p_expected_version: expectedVersion }, (data) => parseSprint(single(data)), options)

export const closeSprint = (db: PlanningDb, sprintId: string, expectedVersion: number, close: { cancel: boolean; reason: string | null; decisions: CloseDecision[] }, options?: CallOptions) =>
  call(db, 'close_project_sprint', {
    p_sprint_id: sprintId, p_expected_version: expectedVersion, p_cancel: close.cancel, p_reason: close.reason, p_decisions: close.decisions,
  }, (data) => parseSprint(single(data)), options)

/** Keep the same id AND immutable arguments for an explicit retry of an uncertain write. */
export interface CreateSprintRequest { requestId: string; projectId: string; expectedVersion: number; draft: SprintDraft }
export interface CloseSprintRequest { requestId: string; sprintId: string; expectedVersion: number; close: { cancel: boolean; reason: string | null; decisions: CloseDecision[] } }
export const createSprintOnce = (db: PlanningDb, request: CreateSprintRequest, options?: CallOptions) =>
  call(db, 'create_project_sprint_once', {
    p_request_id: request.requestId, p_project_id: request.projectId, p_expected_planning_version: request.expectedVersion,
    p_name: request.draft.name, p_goal: request.draft.goal, p_start_at: request.draft.start_at, p_end_at: request.draft.end_at,
  }, (data) => parseSprint(single(data)), options)
export const closeSprintOnce = (db: PlanningDb, request: CloseSprintRequest, options?: CallOptions) =>
  call(db, 'close_project_sprint_once', {
    p_request_id: request.requestId, p_sprint_id: request.sprintId, p_expected_version: request.expectedVersion,
    p_cancel: request.close.cancel, p_reason: request.close.reason, p_decisions: request.close.decisions,
  }, (data) => parseSprint(single(data)), options)

export interface PlanningReceipt { request_id: string; project_id: string; actor_id: string; kind: 'create_sprint' | 'close_sprint'; result: Sprint }
export const loadRequest = (db: PlanningDb, projectId: string, requestId: string, options?: CallOptions) =>
  call(db, 'get_project_planning_request', { p_project_id: projectId, p_request_id: requestId }, (data): PlanningReceipt | null => {
    if (data === null) return null // Absence is NOT proof of failure: the transaction may still run.
    const o = obj(single(data), 'request receipt')
    if (str(o, 'request_id') !== requestId || str(o, 'project_id') !== projectId) fail('request identity')
    return { request_id: requestId, project_id: projectId, actor_id: str(o, 'actor_id'), kind: oneOf(o, 'kind', ['create_sprint', 'close_sprint'] as const), result: parseSprint(o.result) }
  }, options)

/** Transport/parse/unknown errors cannot prove whether a write committed. */
export const uncertainWrite = (error: PlanningError) => ['timeout', 'network', 'invalid_response', 'unknown'].includes(error.kind)

// ---------------------------------------------------------------------------------------------
// Rules shown before sending (the server checks them again)

export type Check<T> = { ok: true; value: T } | { ok: false; message: string }

/** Story points: empty — not estimated; otherwise one of 1/2/3/5/8/13/21. */
export function parseStoryPoints(input: string): Check<number | null> {
  const text = input.trim()
  if (!text) return { ok: true, value: null }
  const value = Number(text)
  return (STORY_POINTS as readonly number[]).includes(value)
    ? { ok: true, value }
    : { ok: false, message: 'Story Points: выберите 1, 2, 3, 5, 8, 13 или 21.' }
}

/** Planned hours: empty — not estimated; otherwise > 0, ≤ 2000, at most two decimals. No rounding. */
export function parsePlannedHours(input: string): Check<number | null> {
  const text = input.trim().replace(',', '.')
  if (!text) return { ok: true, value: null }
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return { ok: false, message: 'Плановые часы: число больше 0, не более двух знаков после запятой.' }
  const value = Number(text)
  if (!(value > 0) || value > MAX_PLANNED_HOURS) return { ok: false, message: 'Плановые часы: больше 0 и не более 2000.' }
  return { ok: true, value }
}

export function parseWipLimit(input: string): Check<number | null> {
  const text = input.trim()
  if (!text) return { ok: true, value: null }
  if (!/^\d{1,6}$/.test(text) || Number(text) < 1 || Number(text) > 100000) return { ok: false, message: 'WIP-лимит: целое число от 1 до 100 000 или пусто.' }
  return { ok: true, value: Number(text) }
}

export function checkSprintDraft(draft: SprintDraft): string | null {
  const name = draft.name.trim()
  if (!name || name.length > 120) return 'Название спринта: от 1 до 120 символов.'
  if (draft.goal.length > SPRINT_GOAL_MAX) return 'Цель спринта: не более 4000 символов.'
  const start = draft.start_at ? new Date(draft.start_at).getTime() : null
  const end = draft.end_at ? new Date(draft.end_at).getTime() : null
  if ((start !== null && Number.isNaN(start)) || (end !== null && Number.isNaN(end))) return 'Некорректная дата спринта.'
  if (start !== null && end !== null && end <= start) return 'Конец спринта должен быть позже начала.'
  return null
}

/** Why a planned sprint cannot start yet (null — it can). Planned dates never start it automatically. */
export function startBlocker(sprint: Sprint, scopeSize: number, hasActive: boolean): string | null {
  if (sprint.state !== 'planned') return 'Начать можно только планируемый спринт.'
  if (hasActive) return 'В проекте уже есть активный спринт.'
  if (!sprint.start_at || !sprint.end_at) return 'Для старта укажите дату начала и окончания.'
  if (scopeSize === 0) return 'Добавьте в спринт хотя бы одну задачу.'
  return null
}

export function checkCloseReason(cancel: boolean, reason: string): string | null {
  if (reason.length > REASON_MAX) return 'Причина: не более 2000 символов.'
  if (cancel && !reason.trim()) return 'Для отмены спринта укажите причину.'
  return null
}

/** Open scope tasks that need an explicit decision: everything not done; deleted tasks are not listed. */
export function unfinishedScope<T extends { id: string; status: string }>(openItems: SprintItem[], sprintId: string, tasks: T[]): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return openItems
    .filter((item) => item.sprint_id === sprintId && item.removed_at === null && item.live_task_id)
    .map((item) => byId.get(item.live_task_id as string))
    .filter((task): task is T => Boolean(task) && (task as T).status !== 'done')
}

/** One decision per unfinished task: `'backlog'` or the id of a planned sprint of the same project. */
export function buildDecisions(choices: Record<string, string>, unfinishedIds: string[], plannedSprints: Pick<Sprint, 'id' | 'version' | 'state'>[]): Check<CloseDecision[]> {
  const targets = new Map(plannedSprints.filter((sprint) => sprint.state === 'planned').map((sprint) => [sprint.id, sprint]))
  const decisions: CloseDecision[] = []
  for (const taskId of unfinishedIds) {
    const choice = choices[taskId]
    if (!choice) return { ok: false, message: 'Выберите решение для каждой незавершённой задачи.' }
    if (choice === 'backlog') { decisions.push({ task_id: taskId, destination: 'backlog' }); continue }
    const target = targets.get(choice)
    if (!target) return { ok: false, message: 'Перенос возможен только в планируемый спринт этого проекта.' }
    decisions.push({ task_id: taskId, destination: 'sprint', sprint_id: target.id, expected_sprint_version: target.version })
  }
  return { ok: true, value: decisions }
}

export interface CloseSummary { done: number; toBacklog: number; moved: { sprintId: string; count: number }[]; unfinished: number }

export function summarizeClose(scopeTasks: { id: string; status: string }[], decisions: CloseDecision[]): CloseSummary {
  const moved = new Map<string, number>()
  for (const decision of decisions) if (decision.destination === 'sprint') moved.set(decision.sprint_id, (moved.get(decision.sprint_id) || 0) + 1)
  return {
    done: scopeTasks.filter((task) => task.status === 'done').length,
    toBacklog: decisions.filter((decision) => decision.destination === 'backlog').length,
    moved: [...moved].map(([sprintId, count]) => ({ sprintId, count })),
    unfinished: decisions.length,
  }
}

// ---------------------------------------------------------------------------------------------
// Rights as the server applies them; the UI hides what is not allowed, the server still decides.

export interface PlanningCapabilities {
  isOwner: boolean
  isProductOwner: boolean
  isScrumMaster: boolean
  /** Settings, stages, sprints, start/close, active scope. */
  canManage: boolean
  canAssignRoles: boolean
  canChangeDelegation: boolean
  canReorderBacklog: boolean
  /** Estimates, task stage, planned sprint scope. */
  canEditTasks: boolean
  readOnly: boolean
}

export function capabilities(input: { userId: string | null; ownerId: string; closed: boolean; settings: Pick<PlanningSettings, 'delegate_to_roles'>; roles: PlanningRole[] }): PlanningCapabilities {
  const { userId, ownerId, closed, settings, roles } = input
  const has = (role: PlanningRoleName) => Boolean(userId) && roles.some((item) => item.user_id === userId && item.role === role)
  const isOwner = Boolean(userId) && userId === ownerId
  const isProductOwner = has('product_owner')
  const isScrumMaster = has('scrum_master')
  const open = !closed && Boolean(userId)
  return {
    isOwner,
    isProductOwner,
    isScrumMaster,
    canManage: open && (isOwner || (settings.delegate_to_roles && (isProductOwner || isScrumMaster))),
    canAssignRoles: open && isOwner,
    canChangeDelegation: open && isOwner,
    canReorderBacklog: open && (isOwner || isProductOwner),
    canEditTasks: open,
    readOnly: !open,
  }
}

/** Soft WIP: exceeding is allowed and shown; strict: the server refuses new tasks above the limit. */
export function wipState(stage: Pick<ProjectStage, 'id' | 'wip_limit'>, tasks: { stage_id?: string | null; status: string }[], settings: Pick<PlanningSettings, 'mode' | 'wip_mode'>) {
  const count = tasks.filter((task) => task.stage_id === stage.id && task.status !== 'done').length
  const applies = settings.mode !== 'simple' && stage.wip_limit !== null
  return { count, limit: stage.wip_limit, applies, over: applies && count > (stage.wip_limit as number), strict: settings.wip_mode === 'strict' }
}

// Backlog order ---------------------------------------------------------------------------------

export function moveInOrder(ids: string[], from: number, to: number): string[] {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return ids
  const next = ids.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Re-applies a local order to a fresh server list after a conflict: tasks still in the backlog keep the
 * person's order, new tasks follow in server order, tasks that left the backlog are dropped. The result
 * is shown for confirmation, never saved automatically.
 */
export function reapplyOrder(localOrder: string[], freshIds: string[]): string[] {
  const fresh = new Set(freshIds)
  const kept = localOrder.filter((id) => fresh.has(id))
  const keptSet = new Set(kept)
  return [...kept, ...freshIds.filter((id) => !keptSet.has(id))]
}

/** Points and hours are summed separately; NULL means not estimated and is counted apart. */
export function sumEstimates(tasks: { story_points: number | null; planned_hours: number | null }[]): SnapshotTotals {
  let points: number | null = null
  let hours: number | null = null
  let unestimatedPoints = 0
  let unestimatedHours = 0
  for (const task of tasks) {
    if (task.story_points === null) unestimatedPoints += 1
    else points = (points ?? 0) + task.story_points
    if (task.planned_hours === null) unestimatedHours += 1
    else hours = Math.round(((hours ?? 0) + task.planned_hours) * 100) / 100
  }
  return { tasks: tasks.length, story_points: points, planned_hours: hours, unestimated_points: unestimatedPoints, unestimated_hours: unestimatedHours }
}

/** datetime-local value (device zone) → ISO; empty → null. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** ISO → datetime-local value in the device zone. */
export function toLocalInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
