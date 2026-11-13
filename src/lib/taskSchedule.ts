// Board columns and task date changes shared by the task board and the Gantt view.
//
// Server facts (supabase/migrations, baseline):
// - tasks.status is free text; the UI board uses todo / doing / done. Other values may exist
//   and must stay visible.
// - Members update tasks directly (RLS «Project members can update tasks», guard triggers).
// - Status changes are recorded by the trigger trusted_activity_from_task (author = auth.uid()).
// - Date changes are validated and recorded atomically by the task schedule migration.
import { supabase } from '@/lib/supabaseClient'
import type { Task, TaskStatus } from '@/components/project/types'
import { BOARD_COLUMNS } from './taskLabels'
export { BOARD_COLUMNS, boardStatusLabel } from './taskLabels'

export const isBoardStatus = (status: string): status is TaskStatus =>
  BOARD_COLUMNS.some((column) => column.status === status)

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
    .eq('status', task.status)
    .select('id, status, start_at, due_at, completed_at')
  if (error) return { ok: false, reason: 'error', message: `Не удалось изменить статус: ${readError(error)}` }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { ok: false, reason: 'conflict', message: 'Статус не изменён: задача уже изменена или доступ отозван. Обновите данные.' }
  return { ok: true, task: row as SavedTask }
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
 * Server locks the task, checks membership and expected dates, then updates dates and history.
 */
export async function saveTaskDates(
  task: Pick<Task, 'id' | 'start_at' | 'due_at'>,
  startAt: string | null,
  dueAt: string | null,
): Promise<SaveResult> {
  const invalid = validateTaskRange(startAt, dueAt)
  if (invalid) return { ok: false, reason: 'invalid', message: invalid }

  const { data, error } = await supabase.rpc('reschedule_task_secure', {
    p_task_id: task.id,
    p_expected_start_at: task.start_at,
    p_expected_due_at: task.due_at,
    p_new_start_at: startAt,
    p_new_due_at: dueAt,
  })
  if (error?.code === 'PT409') return {
    ok: false, reason: 'conflict',
    message: 'Сроки задачи уже изменил другой участник. Показаны актуальные даты — проверьте их и повторите изменение.',
  }
  if (error) return {
    ok: false, reason: error.code === '42501' ? 'forbidden' : 'error',
    message: `Сроки не сохранены: ${readError(error)}`,
  }
  const row = Array.isArray(data) ? data[0] : data
  if (row) return { ok: true, task: row as SavedTask }
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
