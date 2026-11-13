import type { TaskStatus } from '@/components/project/types'

export const BOARD_COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string }> = [
  { status: 'todo', label: 'Нужно сделать' },
  { status: 'doing', label: 'В работе' },
  { status: 'done', label: 'Готово' },
]

export const boardStatusLabel = (status: string) =>
  BOARD_COLUMNS.find((column) => column.status === status)?.label || status

/** Uses structured metadata; never replaces words inside stored titles or user content. */
export function activityBody(item: { type: string; body: string | null; metadata: unknown }, timeZone?: string): string | null {
  const data = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown> : {}
  if (['task_status_changed', 'task_completed'].includes(item.type)
      && typeof data.old_status === 'string' && typeof data.new_status === 'string') {
    return `Статус: ${boardStatusLabel(data.old_status)} → ${boardStatusLabel(data.new_status)}.`
  }
  if (item.type === 'task_schedule_changed') {
    const moment = (value: unknown) => {
      if (value === null) return 'не задано'
      if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) return 'неизвестно'
      return new Date(value).toLocaleString('ru-RU', timeZone ? { timeZone } : undefined)
    }
    return `Начало: ${moment(data.old_start_at)} → ${moment(data.new_start_at)}. Дедлайн: ${moment(data.old_due_at)} → ${moment(data.new_due_at)}.`
  }
  return item.body
}
