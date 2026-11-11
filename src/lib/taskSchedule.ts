// Board columns and task date changes shared by the task board and the Gantt view.
//
// Server facts (supabase/migrations, baseline):
// - tasks.status is free text; the UI board uses todo / doing / done. Other values may exist
//   and must stay visible.
// - Members update tasks directly (RLS «Project members can update tasks», guard triggers).
// - Status changes are recorded by the trigger trusted_activity_from_task (author = auth.uid()).
// - start_at / due_at changes are NOT recorded in project history (known F-02) and tasks have
//   no version column; concurrent edits are detected below with a conditional update.
import { supabase } from '@/lib/supabaseClient'
import type { Task, TaskStatus } from '@/components/project/types'

export const BOARD_COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string }> = [
  { status: 'todo', label: 'Нужно сделать' },
  { status: 'doing', label: 'В работе' },
  { status: 'done', label: 'Готово' },
]

export const isBoardStatus = (status: string): status is TaskStatus =>
  BOARD_COLUMNS.some((column) => column.status === status)

export const boardStatusLabel = (status: string) =>
  BOARD_COLUMNS.find((column) => column.status === status)?.label || status

export type SavedTask = Pick<Task, 'id' | 'status' | 'start_at' | 'due_at' | 'completed_at'>

export type SaveResult =
  | { ok: true; task: SavedTask }
  | { ok: false; reason: 'conflict' | 'forbidden' | 'invalid' | 'error'; message: string }

const readError = (error: { message?: string } | null) => error?.message?.trim() || 'Неизвестная ошибка сервера.'

/** Same update as the regular status buttons; history is written by the server trigger. */
export async function saveTaskStatus(task: Pick<Task, 'id' | 'status'>, status: TaskStatus): Promise<SaveResult> {
  const patch = { status, completed_at: status === 'done' ? new Date().toISOString() : null }
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', task.id)
    .select('id, status, start_at, due_at, completed_at')
  if (error) return { ok: false, reason: 'error', message: `Не удалось изменить статус: ${readError(error)}` }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { ok: false, reason: 'forbidden', message: 'Статус не изменён: задача недоступна или у вас нет прав на её изменение.' }
  return { ok: true, task: row as SavedTask }
}

const sameMoment = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a && !b) return true
  if (!a || !b) return false
  return new Date(a).getTime() === new Date(b).getTime()
}

export function validateTaskRange(startAt: string | null, dueAt: string | null): string | null {
  if (startAt && Number.isNaN(new Date(startAt).getTime())) return 'Некорректная дата начала.'
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) return 'Некорректный дедлайн.'
  if (startAt && dueAt && new Date(dueAt).getTime() < new Date(startAt).getTime()) {
    return 'Дедлайн не может быть раньше начала.'
  }
  return null
}

/**
 * Saves start/due only if they still equal the values the user saw (compare-and-swap in the WHERE
 * clause). If someone else changed them meanwhile, nothing is overwritten and «conflict» is returned.
 */
export async function saveTaskDates(
  task: Pick<Task, 'id' | 'start_at' | 'due_at'>,
  startAt: string | null,
  dueAt: string | null,
): Promise<SaveResult> {
  const invalid = validateTaskRange(startAt, dueAt)
  if (invalid) return { ok: false, reason: 'invalid', message: invalid }

  let query = supabase.from('tasks').update({ start_at: startAt, due_at: dueAt }).eq('id', task.id)
  query = task.start_at ? query.eq('start_at', task.start_at) : query.is('start_at', null)
  query = task.due_at ? query.eq('due_at', task.due_at) : query.is('due_at', null)
  const { data, error } = await query.select('id, status, start_at, due_at, completed_at')
  if (error) return { ok: false, reason: 'error', message: `Сроки не сохранены: ${readError(error)}` }
  const row = Array.isArray(data) ? data[0] : null
  if (row) return { ok: true, task: row as SavedTask }

  // Nothing updated: either the dates changed meanwhile or the row is not writable for this user.
  const { data: fresh, error: readFailed } = await supabase
    .from('tasks')
    .select('id, start_at, due_at')
    .eq('id', task.id)
    .maybeSingle()
  if (readFailed) return { ok: false, reason: 'error', message: `Сроки не сохранены: ${readError(readFailed)}` }
  if (fresh && (!sameMoment(fresh.start_at, task.start_at) || !sameMoment(fresh.due_at, task.due_at))) {
    return {
      ok: false,
      reason: 'conflict',
      message: 'Сроки задачи уже изменил другой участник. Показаны актуальные даты — проверьте их и повторите изменение.',
    }
  }
  return { ok: false, reason: 'forbidden', message: 'Сроки не сохранены: задача недоступна или у вас нет прав на её изменение.' }
}

/**
 * Moves a moment by whole calendar days in the viewer's local time zone, keeping the local time of
 * day (so 09:30 stays 09:30 across DST changes).
 */
export function shiftLocalDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}
