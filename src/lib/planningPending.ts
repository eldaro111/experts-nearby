// Pending write arguments in this tab only, scoped to user/project/kind/sprint.
// No credentials. Retaining the original UUID AND payload allows an explicit safe
// retry after navigation/reload. The server validates their binding independently.
import type { CreateSprintRequest, CloseSprintRequest } from './planning'
type Request = CreateSprintRequest | CloseSprintRequest
const key = (userId: string, projectId: string, sprintId?: string) => `planning-request:${userId}:${projectId}:${sprintId ?? 'create'}`
const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const textOrNull = (x: unknown) => x === null || typeof x === 'string'
const version = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0

export function readPendingCreate(userId: string, projectId: string): CreateSprintRequest | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key(userId, projectId)) ?? 'null')
    if (!object(value) || typeof value.requestId !== 'string' || value.projectId !== projectId || !version(value.expectedVersion) || !object(value.draft)) return null
    const d = value.draft
    if (typeof d.name !== 'string' || typeof d.goal !== 'string' || !textOrNull(d.start_at) || !textOrNull(d.end_at)) return null
    return value as unknown as CreateSprintRequest
  } catch { return null }
}
export function readPendingClose(userId: string, projectId: string, sprintId: string): CloseSprintRequest | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key(userId, projectId, sprintId)) ?? 'null')
    if (!object(value) || typeof value.requestId !== 'string' || value.sprintId !== sprintId || !version(value.expectedVersion) || !object(value.close)) return null
    const c = value.close
    if (typeof c.cancel !== 'boolean' || !textOrNull(c.reason) || !Array.isArray(c.decisions) || !c.decisions.every((d) => object(d) && typeof d.task_id === 'string' &&
      (d.destination === 'backlog' || d.destination === 'sprint' && typeof d.sprint_id === 'string' && version(d.expected_sprint_version)))) return null
    return value as unknown as CloseSprintRequest
  } catch { return null }
}
export function storePending(userId: string, projectId: string, request: Request) {
  try { sessionStorage.setItem(key(userId, projectId, 'sprintId' in request ? request.sprintId : undefined), JSON.stringify(request)) } catch { /* Current mounted form still retains it. */ }
}
export function clearPending(userId: string, projectId: string, request: Request) {
  try {
    const k = key(userId, projectId, 'sprintId' in request ? request.sprintId : undefined)
    const value: unknown = JSON.parse(sessionStorage.getItem(k) ?? 'null')
    if (object(value) && value.requestId === request.requestId) sessionStorage.removeItem(k)
  } catch { /* Storage may be disabled. */ }
}
