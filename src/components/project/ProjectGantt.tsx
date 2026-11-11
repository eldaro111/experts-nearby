'use client'

// Gantt view of project tasks (replaces the decorative bars of the former plan list).
// Model facts: tasks.start_at / due_at are timestamptz (time of day is kept), shown in the device
// time zone like the rest of the workspace. Dragging moves by whole local calendar days and keeps
// the time of day. Saving uses the same tasks update as the regular form, guarded by a
// compare-and-swap on the previous dates (src/lib/taskSchedule.ts). Date changes are not yet
// written to project history on the server (known F-02).
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CalendarPlus } from 'lucide-react'
import { createNotification } from '@/lib/notifications'
import { logAppError, showAppMessage } from '@/lib/appFeedback'
import { saveTaskDates, shiftLocalDays, validateTaskRange } from '@/lib/taskSchedule'
import type { ProjectMember, Task } from './types'

const DAY_WIDTH = 40
const LABEL_WIDTH = 190

type Mode = 'move' | 'start' | 'end'
type Draft = { start: string | null; due: string | null }
type DragState = { taskId: string; mode: Mode; originX: number; days: number; frozen: number[] }

const startOfLocalDay = (time: number) => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Local day boundaries (DST-safe: days may be 23 or 25 hours long). */
function buildDays(from: number, to: number) {
  const days: number[] = []
  const cursor = new Date(startOfLocalDay(from))
  while (cursor.getTime() <= to) {
    days.push(cursor.getTime())
    cursor.setDate(cursor.getDate() + 1)
  }
  days.push(cursor.getTime())
  return days
}

function xOf(time: number, days: number[]) {
  if (time <= days[0]) return 0
  for (let i = 0; i < days.length - 1; i += 1) {
    if (time < days[i + 1]) return i * DAY_WIDTH + ((time - days[i]) / (days[i + 1] - days[i])) * DAY_WIDTH
  }
  return (days.length - 1) * DAY_WIDTH
}

const formatMoment = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

const toLocalInput = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const fromLocalInput = (value: string) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function applyDays(task: Pick<Task, 'start_at' | 'due_at'>, mode: Mode, days: number): Draft {
  const start = task.start_at
  const due = task.due_at
  if (mode === 'move') {
    return { start: start ? shiftLocalDays(start, days) : null, due: due ? shiftLocalDays(due, days) : null }
  }
  if (mode === 'start' && start) {
    let next = shiftLocalDays(start, days)
    if (due && new Date(next).getTime() > new Date(due).getTime()) next = due
    return { start: next, due }
  }
  if (mode === 'end' && due) {
    let next = shiftLocalDays(due, days)
    if (start && new Date(next).getTime() < new Date(start).getTime()) next = start
    return { start, due: next }
  }
  return { start, due }
}

export function ProjectGantt({
  projectId,
  currentUserId,
  tasks,
  members,
  readOnly,
  projectDeadline,
  onTasksChanged,
}: {
  projectId: string
  currentUserId: string | null | undefined
  tasks: Task[]
  members: ProjectMember[]
  readOnly: boolean
  projectDeadline: string | null
  onTasksChanged?: () => Promise<void>
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingIds, setSavingIds] = useState<string[]>([])
  const [drag, setDrag] = useState<DragState | null>(null)
  const [assigning, setAssigning] = useState<{ taskId: string; start: string; due: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [nowTime] = useState(() => Date.now())

  const canEdit = !readOnly && Boolean(onTasksChanged)
  const memberName = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.display_name || 'Участник' : 'Не назначен')

  const dated = useMemo(
    () => tasks
      .filter((task) => task.start_at || task.due_at)
      .sort((a, b) => new Date(a.start_at || a.due_at || 0).getTime() - new Date(b.start_at || b.due_at || 0).getTime()),
    [tasks],
  )
  const undated = tasks.filter((task) => !task.start_at && !task.due_at)

  const computedDays = useMemo(() => {
    const times = dated.flatMap((task) => [task.start_at, task.due_at].filter(Boolean).map((v) => new Date(v as string).getTime()))
    if (projectDeadline) times.push(new Date(projectDeadline).getTime())
    times.push(nowTime)
    const min = Math.min(...times)
    const max = Math.max(...times)
    return buildDays(min - 3 * 86_400_000, max + 4 * 86_400_000)
  }, [dated, projectDeadline, nowTime])
  // The scale is frozen while dragging so other bars do not shift under the pointer.
  const days = drag?.frozen || computedDays
  const trackWidth = (days.length - 1) * DAY_WIDTH

  const displayed = (task: Task): Draft => drafts[task.id] || { start: task.start_at, due: task.due_at }

  const persist = async (task: Task, next: Draft) => {
    if (savingIds.includes(task.id)) return
    const unchanged = next.start === task.start_at && next.due === task.due_at
    if (unchanged) { setDrafts((d) => { const copy = { ...d }; delete copy[task.id]; return copy }); return }
    setSavingIds((ids) => [...ids, task.id])
    setDrafts((d) => ({ ...d, [task.id]: next }))
    const result = await saveTaskDates(task, next.start, next.due)
    if (!result.ok) {
      logAppError('Ошибка сохранения сроков задачи:', result.message)
      showAppMessage(result.message, result.reason === 'conflict' ? 'warning' : 'error', 8000)
      setAnnouncement(`Сроки задачи «${task.title}» не изменены. ${result.message}`)
      setDrafts((d) => { const copy = { ...d }; delete copy[task.id]; return copy })
      if (result.reason === 'conflict' && onTasksChanged) await onTasksChanged()
      setSavingIds((ids) => ids.filter((id) => id !== task.id))
      return
    }
    // Same notification as the regular form when the deadline changes.
    if (task.assignee_id && currentUserId && task.assignee_id !== currentUserId && next.due !== task.due_at) {
      await createNotification({
        recipientId: task.assignee_id,
        actorId: currentUserId,
        projectId,
        type: 'task_deadline_changed',
        title: 'Дедлайн задачи изменён',
        body: next.due
          ? `У задачи «${task.title}» новый дедлайн: ${new Date(next.due).toLocaleString()}.`
          : `У задачи «${task.title}» дедлайн снят.`,
        href: `/projects/${projectId}`,
        payload: { task_id: task.id, task_title: task.title, old_due_at: task.due_at, new_due_at: next.due },
      })
    }
    setAnnouncement(`Сроки задачи «${task.title}» сохранены: ${formatMoment(next.start)} — ${formatMoment(next.due)}.`)
    if (onTasksChanged) await onTasksChanged()
    setDrafts((d) => { const copy = { ...d }; delete copy[task.id]; return copy })
    setSavingIds((ids) => ids.filter((id) => id !== task.id))
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>, task: Task) => {
    if (!canEdit || event.button !== 0 || savingIds.includes(task.id)) return
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-mode]')
    let mode = (handle?.dataset.mode as Mode | undefined) || 'move'
    if (mode === 'start' && !task.start_at) mode = 'move'
    if (mode === 'end' && !task.due_at) mode = 'move'
    // Stop text selection / native drag, which would otherwise cancel the pointer stream.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ taskId: task.id, mode, originX: event.clientX, days: 0, frozen: computedDays })
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>, task: Task) => {
    if (!drag || drag.taskId !== task.id) return
    const daysMoved = Math.round((event.clientX - drag.originX) / DAY_WIDTH)
    if (daysMoved === drag.days) return
    setDrag({ ...drag, days: daysMoved })
    setDrafts((d) => ({ ...d, [task.id]: applyDays(task, drag.mode, daysMoved) }))
  }
  const onPointerUp = (task: Task) => {
    if (!drag || drag.taskId !== task.id) return
    const { mode, days: moved } = drag
    setDrag(null)
    if (moved === 0) { setDrafts((d) => { const copy = { ...d }; delete copy[task.id]; return copy }); return }
    void persist(task, applyDays(task, mode, moved))
  }
  const onPointerCancel = (task: Task) => {
    setDrag(null)
    setDrafts((d) => { const copy = { ...d }; delete copy[task.id]; return copy })
    setAnnouncement(`Перемещение задачи «${task.title}» отменено.`)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, task: Task) => {
    if (!canEdit) return
    if (event.key === 'Escape' && drag?.taskId === task.id) { onPointerCancel(task); return }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (savingIds.includes(task.id)) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const mode: Mode = event.shiftKey && task.due_at ? 'end' : event.altKey && task.start_at ? 'start' : 'move'
    void persist(task, applyDays(task, mode, delta))
  }

  const saveAssigned = async () => {
    if (!assigning) return
    const task = tasks.find((item) => item.id === assigning.taskId)
    if (!task) return
    const start = fromLocalInput(assigning.start)
    const due = fromLocalInput(assigning.due)
    const invalid = validateTaskRange(start, due)
    if (invalid) { showAppMessage(invalid, 'warning'); return }
    if (!start && !due) { showAppMessage('Укажите хотя бы одну дату.', 'warning'); return }
    setAssigning(null)
    await persist(task, { start, due })
  }

  const todayX = xOf(nowTime, days)
  const deadlineX = projectDeadline ? xOf(new Date(projectDeadline).getTime(), days) : null

  return (
    <div className="gantt">
      <div className="flex flex-col gap-1 mb-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="font-semibold">Диаграмма Ганта</h3>
          <p className="text-sm text-gray-500">
            {canEdit
              ? 'Перетащите полосу, чтобы сдвинуть задачу целиком, или её край, чтобы изменить начало или дедлайн. Шаг — один день, время суток сохраняется. С клавиатуры: стрелки — сдвиг, Shift+стрелки — дедлайн, Alt+стрелки — начало.'
              : 'Просмотр сроков задач. Изменение недоступно.'}
          </p>
        </div>
        <p className="text-xs text-gray-500 shrink-0">Время — в часовом поясе устройства</p>
      </div>

      {dated.length === 0 ? (
        <p className="text-sm text-gray-500">Пока нет задач со сроками.</p>
      ) : (
        <div ref={(node) => { if (node && !node.dataset.scrolled) { node.dataset.scrolled = "1"; node.scrollLeft = Math.max(0, todayX - 2 * LABEL_WIDTH) } }} className="gantt-scroll" role="region" aria-label="Диаграмма Ганта" tabIndex={0}>
          <div className="gantt-grid" style={{ width: `calc(var(--gantt-label) + ${trackWidth}px)` }}>
            <div className="gantt-header" style={{ gridTemplateColumns: `var(--gantt-label) ${trackWidth}px` }}>
              <div className="gantt-label gantt-sticky">Задача</div>
              <div className="gantt-days" style={{ width: trackWidth }}>
                {days.slice(0, -1).map((day) => {
                  const date = new Date(day)
                  const weekend = date.getDay() === 0 || date.getDay() === 6
                  return (
                    <div key={day} className={`gantt-day ${weekend ? 'is-weekend' : ''}`} style={{ width: DAY_WIDTH }}>
                      {date.getDate() === 1 || day === days[0] ? <span className="gantt-month">{date.toLocaleDateString('ru-RU', { month: 'short' })}</span> : null}
                      {date.getDate()}
                    </div>
                  )
                })}
              </div>
            </div>
            {dated.map((task) => {
              const draft = displayed(task)
              const isDragging = drag?.taskId === task.id
              const isSaving = savingIds.includes(task.id)
              const start = draft.start ? new Date(draft.start).getTime() : null
              const due = draft.due ? new Date(draft.due).getTime() : null
              const single = !start || !due
              const left = xOf((start ?? due) as number, days)
              const right = xOf((due ?? start) as number, days)
              const width = Math.max(right - left, single ? 0 : 6)
              const done = task.status === 'done'
              const overdue = !done && due !== null && due < nowTime
              const label = `${task.title}. Начало: ${formatMoment(draft.start)}. Дедлайн: ${formatMoment(draft.due)}. Исполнитель: ${memberName(task.assignee_id)}.`
              return (
                <div key={task.id} className="gantt-row" style={{ gridTemplateColumns: `var(--gantt-label) ${trackWidth}px` }}>
                  <div className="gantt-label gantt-sticky" title={task.title}>
                    <span className="block truncate font-medium">{task.title}</span>
                    <span className="block truncate text-xs text-gray-500">{single ? (start ? 'Нет дедлайна' : 'Нет даты начала') : memberName(task.assignee_id)}</span>
                  </div>
                  <div className="gantt-track" style={{ width: trackWidth }}>
                    <span className="gantt-today" style={{ left: todayX }} aria-hidden="true" />
                    {deadlineX !== null && <span className="gantt-deadline" style={{ left: deadlineX }} aria-hidden="true" />}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={label}
                      aria-disabled={!canEdit || isSaving || undefined}
                      aria-busy={isSaving || undefined}
                      className={`gantt-bar ${single ? 'is-point' : ''} ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${isDragging ? 'is-dragging' : ''} ${isSaving ? 'is-saving' : ''} ${canEdit ? 'is-editable' : ''}`}
                      style={{ left: single ? left - 9 : left, width: single ? 18 : width }}
                      onPointerDown={(event) => onPointerDown(event, task)}
                      onPointerMove={(event) => onPointerMove(event, task)}
                      onPointerUp={() => onPointerUp(task)}
                      onPointerCancel={() => onPointerCancel(task)}
                      onKeyDown={(event) => onKeyDown(event, task)}
                    >
                      {canEdit && !single && <span className="gantt-handle is-start" data-mode="start" aria-hidden="true" />}
                      {canEdit && !single && <span className="gantt-handle is-end" data-mode="end" aria-hidden="true" />}
                    </div>
                    {(isDragging || isSaving) && (
                      <div className="gantt-preview" style={{ left: Math.max(0, left) }} role="status">
                        {isSaving ? 'Сохраняем… ' : ''}{formatMoment(draft.start)} — {formatMoment(draft.due)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(undated.length > 0 || dated.some((task) => !task.start_at || !task.due_at)) && (
        <div className="mt-4 rounded-lg border border-dashed p-4">
          <h4 className="text-sm font-semibold mb-1">Задачи без полного срока</h4>
          <p className="text-xs text-gray-500 mb-3">Сроки не назначаются автоматически. Укажите даты сами, если они известны.</p>
          <ul className="space-y-2">
            {[...undated, ...dated.filter((task) => !task.start_at || !task.due_at)].map((task) => (
              <li key={task.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{task.title}</span>
                  <span className="text-xs text-gray-500">
                    {!task.start_at && !task.due_at ? 'Нет дат' : !task.start_at ? 'Нет даты начала' : 'Нет дедлайна'}
                  </span>
                  {canEdit && assigning?.taskId !== task.id && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline min-h-8"
                      onClick={() => setAssigning({ taskId: task.id, start: toLocalInput(task.start_at), due: toLocalInput(task.due_at) })}
                    >
                      <CalendarPlus size={14} aria-hidden="true" />Назначить сроки
                    </button>
                  )}
                </div>
                {assigning?.taskId === task.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <label className="text-xs text-gray-600">Начало
                      <input type="datetime-local" className="mt-1 w-full" value={assigning.start} onChange={(e) => setAssigning({ ...assigning, start: e.target.value })} />
                    </label>
                    <label className="text-xs text-gray-600">Дедлайн
                      <input type="datetime-local" className="mt-1 w-full" value={assigning.due} onChange={(e) => setAssigning({ ...assigning, due: e.target.value })} />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="action-primary min-h-11 px-4" onClick={() => void saveAssigned()}>Сохранить</button>
                      <button type="button" className="action-secondary min-h-11 px-4" onClick={() => setAssigning(null)}>Отмена</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  )
}
