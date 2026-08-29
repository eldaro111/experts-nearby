'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

import type { Listing, ProjectEvent, ProjectMember, Task } from './types'

const initialNow = Date.now()
const CLOCK_REFRESH_INTERVAL_MS = 60_000

interface CalendarItem {
  id: string
  sourceId?: string
  kind: string
  title: string
  subtitle: string
  starts_at: string | null
  ends_at: string | null
  isOverdue: boolean
}

interface ProjectCalendarProps {
  projectId: string
  currentUserId: string | null | undefined
  listing: Listing
  members: ProjectMember[]
  tasks: Task[]
  projectProgress: number
}

export function ProjectCalendar({
  projectId,
  currentUserId,
  listing,
  members,
  tasks,
  projectProgress,
}: ProjectCalendarProps) {
  const [events, setEvents] = useState<ProjectEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventDescription, setNewEventDescription] = useState('')
  const [newEventType, setNewEventType] = useState('other')
  const [newEventStartsAt, setNewEventStartsAt] = useState('')
  const [newEventEndsAt, setNewEventEndsAt] = useState('')
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [now, setNow] = useState(initialNow)

  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    const fetchEvents = async () => {
      setEventsLoading(true)

      const { data, error } = await supabase
        .from('project_events')
        .select('*')
        .eq('project_id', projectId)
        .order('starts_at', { ascending: true })

      if (error) {
        logAppError('Ошибка загрузки календарного плана:', error)
        setEvents([])
      } else {
        setEvents((data || []) as ProjectEvent[])
      }

      setEventsLoading(false)
    }

    fetchEvents()
  }, [projectId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, CLOCK_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  const refreshEvents = async () => {
    const { data, error } = await supabase
      .from('project_events')
      .select('*')
      .eq('project_id', projectId)
      .order('starts_at', { ascending: true })

    if (error) {
      logAppError('Ошибка обновления календарного плана:', error)
      return
    }

    setEvents((data || []) as ProjectEvent[])
  }

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'

    return (
      members.find((m) => m.user_id === userId)?.display_name ||
      'Неизвестный участник'
    )
  }

  const fromDateTimeLocalValue = (value: string) => {
    if (!value) return null

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null

    return date.toISOString()
  }

  const formatDateTime = (value: string | null) => {
    if (!value) return '—'
    return new Date(value).toLocaleString()
  }

  const isTaskOverdue = (task: Task) => {
    if (!task.due_at) return false

    const due = new Date(task.due_at).getTime()

    if (task.status !== 'done') {
      return now > due
    }

    if (task.completed_at) {
      return new Date(task.completed_at).getTime() > due
    }

    return false
  }

  const eventTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      call: 'Созвон',
      report: 'Отчётность',
      deadline: 'Дедлайн',
      review: 'Проверка',
      meeting: 'Встреча',
      other: 'Другое',
    }

    return map[type] || type
  }

  const handleCreateEvent = async () => {
    if (!currentUserId) {
      showAppMessage('Пользователь не найден.')
      return
    }

    const title = newEventTitle.trim()
    const description = newEventDescription.trim()
    const startsAt = fromDateTimeLocalValue(newEventStartsAt)
    const endsAt = fromDateTimeLocalValue(newEventEndsAt)

    if (!title) {
      showAppMessage('Введите название события.')
      return
    }

    if (!startsAt) {
      showAppMessage('Укажите дату начала события.')
      return
    }

    setCreatingEvent(true)

    const { error } = await supabase.from('project_events').insert([
      {
        project_id: projectId,
        created_by: currentUserId,
        title,
        description: description || null,
        event_type: newEventType,
        starts_at: startsAt,
        ends_at: endsAt,
      },
    ])

    setCreatingEvent(false)

    if (error) {
      logAppError('Ошибка создания события:', error)
      showAppMessage('Ошибка создания события: ' + error.message)
      return
    }

    setNewEventTitle('')
    setNewEventDescription('')
    setNewEventType('other')
    setNewEventStartsAt('')
    setNewEventEndsAt('')

    await refreshEvents()
  }

  const handleDeleteEvent = async (eventId: string) => {
    const ok = window.confirm('Удалить событие календарного плана?')
    if (!ok) return

    setDeletingEventId(eventId)

    const { error } = await supabase
      .from('project_events')
      .delete()
      .eq('id', eventId)

    setDeletingEventId(null)

    if (error) {
      logAppError('Ошибка удаления события:', error)
      showAppMessage('Ошибка удаления события: ' + error.message)
      return
    }

    await refreshEvents()
  }

  const projectDeadlineTime = listing.deadline_at
    ? new Date(listing.deadline_at).getTime()
    : null

  const isProjectOverdue =
    !!projectDeadlineTime &&
    Number.isFinite(projectDeadlineTime) &&
    now > projectDeadlineTime &&
    projectProgress < 100

  const timelineItems: CalendarItem[] = [
    ...(listing.deadline_at
      ? [
          {
            id: `project-deadline-${listing.id}`,
            kind: 'project-deadline',
            title: listing.title,
            subtitle: 'Дедлайн проекта',
            starts_at: listing.deadline_at,
            ends_at: listing.deadline_at,
            isOverdue: isProjectOverdue,
          },
        ]
      : []),
    ...tasks
      .filter((task) => task.start_at || task.due_at)
      .map((task) => ({
        id: `task-${task.id}`,
        kind: 'task',
        title: task.title,
        subtitle: `Задача · ${getMemberName(task.assignee_id)}`,
        starts_at: task.start_at || task.due_at,
        ends_at: task.due_at || task.start_at,
        isOverdue: isTaskOverdue(task),
      })),
    ...events.map((event) => ({
      id: `event-${event.id}`,
      kind: event.event_type,
      title: event.title,
      subtitle: eventTypeLabel(event.event_type),
      starts_at: event.starts_at,
      ends_at: event.ends_at || event.starts_at,
      isOverdue: false,
    })),
  ].sort((a, b) => {
    const da = a.starts_at ? new Date(a.starts_at).getTime() : 0
    const db = b.starts_at ? new Date(b.starts_at).getTime() : 0
    return da - db
  })

  const calendarItems: CalendarItem[] = [
    ...(listing.deadline_at
      ? [
          {
            id: `project-deadline-${listing.id}`,
            sourceId: listing.id,
            kind: 'project-deadline',
            title: listing.title,
            subtitle: 'Дедлайн проекта',
            starts_at: listing.deadline_at,
            ends_at: listing.deadline_at,
            isOverdue: isProjectOverdue,
          },
        ]
      : []),
    ...tasks.flatMap((task) => {
      const items: CalendarItem[] = []

      if (task.start_at) {
        items.push({
          id: `task-start-${task.id}`,
          sourceId: task.id,
          kind: 'task-start',
          title: task.title,
          subtitle: `Старт · ${getMemberName(task.assignee_id)}`,
          starts_at: task.start_at,
          ends_at: task.start_at,
          isOverdue: false,
        })
      }

      if (task.due_at) {
        items.push({
          id: `task-due-${task.id}`,
          sourceId: task.id,
          kind: 'task-due',
          title: task.title,
          subtitle: `Дедлайн · ${getMemberName(task.assignee_id)}`,
          starts_at: task.due_at,
          ends_at: task.due_at,
          isOverdue: isTaskOverdue(task),
        })
      }

      return items
    }),
    ...events.map((event) => ({
      id: `event-${event.id}`,
      sourceId: event.id,
      kind: event.event_type,
      title: event.title,
      subtitle: eventTypeLabel(event.event_type),
      starts_at: event.starts_at,
      ends_at: event.ends_at || event.starts_at,
      isOverdue: false,
    })),
  ].sort((a, b) => {
    const da = a.starts_at ? new Date(a.starts_at).getTime() : 0
    const db = b.starts_at ? new Date(b.starts_at).getTime() : 0
    return da - db
  })

  const [calendarYear, calendarMonthIndex] = calendarMonth
    .split('-')
    .map((part) => Number(part))

  const safeCalendarYear = Number.isFinite(calendarYear)
    ? calendarYear
    : new Date().getFullYear()
  const safeCalendarMonthIndex = Number.isFinite(calendarMonthIndex)
    ? calendarMonthIndex - 1
    : new Date().getMonth()

  const calendarMonthStart = new Date(
    safeCalendarYear,
    safeCalendarMonthIndex,
    1
  )
  const calendarDaysInMonth = new Date(
    safeCalendarYear,
    safeCalendarMonthIndex + 1,
    0
  ).getDate()
  const calendarStartOffset = (calendarMonthStart.getDay() + 6) % 7

  const calendarCells = [
    ...Array.from({ length: calendarStartOffset }, (_, index) => ({
      id: `empty-${index}`,
      date: null as Date | null,
    })),
    ...Array.from({ length: calendarDaysInMonth }, (_, index) => ({
      id: `day-${index + 1}`,
      date: new Date(safeCalendarYear, safeCalendarMonthIndex, index + 1),
    })),
  ]

  const calendarMonthLabel = calendarMonthStart.toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  })

  const shiftCalendarMonth = (delta: number) => {
    const next = new Date(safeCalendarYear, safeCalendarMonthIndex + delta, 1)
    setCalendarMonth(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    )
  }

  const isCalendarItemOnDate = (
    item: (typeof calendarItems)[number],
    date: Date
  ) => {
    if (!item.starts_at) return false

    const itemDate = new Date(item.starts_at)
    if (Number.isNaN(itemDate.getTime())) return false

    return (
      itemDate.getFullYear() === date.getFullYear() &&
      itemDate.getMonth() === date.getMonth() &&
      itemDate.getDate() === date.getDate()
    )
  }

  const getCalendarItemsForDate = (date: Date) => {
    return calendarItems.filter((item) => isCalendarItemOnDate(item, date))
  }

  const calendarItemLabel = (kind: string) => {
    if (kind === 'project-deadline') return 'Дедлайн проекта'
    if (kind === 'task-start') return 'Старт'
    if (kind === 'task-due') return 'Дедлайн'
    return eventTypeLabel(kind)
  }

  const calendarItemClassName = (item: (typeof calendarItems)[number]) => {
    if (item.isOverdue) return 'bg-red-50 border-red-200 text-red-700'
    if (item.kind === 'project-deadline') return 'bg-emerald-50 border-emerald-200 text-emerald-700'
    if (item.kind === 'task-start') return 'bg-blue-50 border-blue-200 text-blue-700'
    if (item.kind === 'task-due') return 'bg-amber-50 border-amber-200 text-amber-700'
    return 'bg-purple-50 border-purple-200 text-purple-700'
  }

  return (
    <div className="border rounded-xl bg-white p-5 shadow-sm mt-10">
      <h2 className="text-xl font-semibold mb-4">
        Календарный план / диаграмма Ганта
      </h2>

      <div className="border rounded-lg p-4 bg-gray-50 mb-6">
        <h3 className="font-semibold mb-3">Добавить событие</h3>

        <div className="space-y-3">
          <select
            value={newEventType}
            onChange={(e) => setNewEventType(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          >
            <option value="other">Другое</option>
            <option value="call">Созвон</option>
            <option value="report">Отчётность</option>
            <option value="deadline">Дедлайн</option>
            <option value="review">Проверка</option>
            <option value="meeting">Встреча</option>
          </select>

          <input
            type="text"
            placeholder="Название события"
            value={newEventTitle}
            onChange={(e) => setNewEventTitle(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          />

          <textarea
            placeholder="Описание / комментарий"
            value={newEventDescription}
            onChange={(e) => setNewEventDescription(e.target.value)}
            className="border rounded p-2 w-full bg-white min-h-[80px]"
          />

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Начало
              </label>
              <input
                type="datetime-local"
                value={newEventStartsAt}
                onChange={(e) => setNewEventStartsAt(e.target.value)}
                className="border rounded p-2 w-full bg-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Конец / срок
              </label>
              <input
                type="datetime-local"
                value={newEventEndsAt}
                onChange={(e) => setNewEventEndsAt(e.target.value)}
                className="border rounded p-2 w-full bg-white"
              />
            </div>
          </div>

          <button
            onClick={handleCreateEvent}
            disabled={creatingEvent}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {creatingEvent ? 'Добавляем...' : 'Добавить событие'}
          </button>
        </div>
      </div>

      <div className="border rounded-lg bg-white p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold">Календарь проекта</h3>
            <p className="text-sm text-gray-500">
              Дедлайны задач и события проекта попадают сюда автоматически.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftCalendarMonth(-1)}
              className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded hover:bg-gray-300 transition"
            >
              ←
            </button>

            <div className="min-w-[170px] text-center font-medium capitalize">
              {calendarMonthLabel}
            </div>

            <button
              onClick={() => shiftCalendarMonth(1)}
              className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded hover:bg-gray-300 transition"
            >
              →
            </button>

            <button
              onClick={() => {
                const now = new Date()
                setCalendarMonth(
                  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                )
              }}
              className="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition"
            >
              Сегодня
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 text-xs text-gray-500 mb-2">
          {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
            <div key={day} className="text-center font-medium">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {calendarCells.map((cell) => {
            if (!cell.date) {
              return (
                <div
                  key={cell.id}
                  className="min-h-[110px] rounded-lg border bg-gray-50/60"
                />
              )
            }

            const items = getCalendarItemsForDate(cell.date)
            const today = new Date()
            const isToday =
              cell.date.getFullYear() === today.getFullYear() &&
              cell.date.getMonth() === today.getMonth() &&
              cell.date.getDate() === today.getDate()

            return (
              <div
                key={cell.id}
                className={`min-h-[110px] rounded-lg border p-2 bg-white ${
                  isToday ? 'border-blue-500 ring-1 ring-blue-200' : 'border-gray-200'
                }`}
              >
                <div
                  className={`text-xs font-semibold mb-2 ${
                    isToday ? 'text-blue-700' : 'text-gray-700'
                  }`}
                >
                  {cell.date.getDate()}
                </div>

                {items.length === 0 ? (
                  <div className="text-[11px] text-gray-300">—</div>
                ) : (
                  <div className="space-y-1">
                    {items.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        title={`${item.title} · ${formatDateTime(item.starts_at || null)} → ${formatDateTime(item.ends_at || null)}`}
                        className={`rounded px-2 py-1 text-[11px] leading-tight border ${
                          calendarItemClassName(item)
                        }`}
                      >
                        <div className="font-medium truncate">
                          {calendarItemLabel(item.kind)}
                        </div>
                        <div className="truncate">{item.title}</div>
                      </div>
                    ))}

                    {items.length > 3 && (
                      <div className="text-[11px] text-gray-500">
                        + ещё {items.length - 3}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex gap-3 flex-wrap mt-4 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-blue-100 border border-blue-200" />
            Задачи
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-purple-100 border border-purple-200" />
            События
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-red-100 border border-red-200" />
            Просрочка
          </span>
        </div>
      </div>

      {eventsLoading ? (
        <div className="text-sm text-gray-500">
          Загружаем календарный план...
        </div>
      ) : timelineItems.length === 0 ? (
        <div className="text-sm text-gray-500">
          Пока нет задач или событий со сроками.
        </div>
      ) : (
        <div className="space-y-3">
          {timelineItems.map((item) => (
            <div
              key={item.id}
              className={`border rounded-lg p-4 ${
                item.isOverdue
                  ? 'bg-red-50 border-red-200'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-500">
                    {item.subtitle}
                  </div>

                  <div className="font-semibold text-lg">
                    {item.title}
                  </div>

                  <div className="text-sm text-gray-600 mt-1">
                    {formatDateTime(item.starts_at || null)} →{' '}
                    {formatDateTime(item.ends_at || null)}
                  </div>

                  {item.isOverdue && (
                    <div className="text-sm text-red-700 mt-2">
                      Просрочено
                    </div>
                  )}
                </div>

                {item.id.startsWith('event-') && (
                  <button
                    onClick={() =>
                      handleDeleteEvent(item.id.replace('event-', ''))
                    }
                    disabled={
                      deletingEventId === item.id.replace('event-', '')
                    }
                    className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                  >
                    {deletingEventId === item.id.replace('event-', '')
                      ? 'Удаляем...'
                      : 'Удалить'}
                  </button>
                )}
              </div>

              <div className="mt-3 h-2 rounded-full bg-white border overflow-hidden">
                <div
                  className={`h-full ${
                    item.isOverdue ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: item.kind === 'task' ? '75%' : '35%' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
