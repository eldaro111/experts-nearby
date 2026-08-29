'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getAppErrorMessage, logAppError } from '@/lib/appFeedback'

type Listing = {
  id: string
  title: string
  description: string | null
  created_by: string | null
  deadline_at: string | null
  created_at?: string | null
}

type Application = {
  id: string
  listing_id: string
  user_id: string
  status: string
}

type Task = {
  id: string
  project_id: string
  title: string
  description: string | null
  status: 'todo' | 'doing' | 'done' | string
  assignee_id: string | null
  start_at: string | null
  due_at: string | null
  completed_at: string | null
  created_at: string | null
}

type ProjectEvent = {
  id: string
  project_id: string
  created_by: string | null
  title: string
  description: string | null
  event_type: string
  starts_at: string | null
  ends_at: string | null
  created_at: string | null
}

type CalendarEntry = {
  id: string
  projectId: string
  projectTitle: string
  sourceId: string
  kind: 'project-deadline' | 'task-start' | 'task-due' | 'event'
  eventType?: string
  title: string
  subtitle: string
  date: string
  endDate: string | null
  href: string
  isOverdue: boolean
  status?: string
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function sameLocalDay(value: string, date: Date) {
  const source = new Date(value)
  if (Number.isNaN(source.getTime())) return false

  return (
    source.getFullYear() === date.getFullYear() &&
    source.getMonth() === date.getMonth() &&
    source.getDate() === date.getDate()
  )
}

function taskStatusLabel(status: string) {
  if (status === 'todo') return 'К выполнению'
  if (status === 'doing') return 'В работе'
  if (status === 'done') return 'Готово'
  return status
}

function eventTypeLabel(type: string) {
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

function entryTypeLabel(entry: CalendarEntry) {
  if (entry.kind === 'project-deadline') return 'Дедлайн проекта'
  if (entry.kind === 'task-start') return 'Старт задачи'
  if (entry.kind === 'task-due') return 'Дедлайн задачи'
  return eventTypeLabel(entry.eventType || 'other')
}

function entryClassName(entry: CalendarEntry) {
  if (entry.isOverdue) return 'border-red-200 bg-red-50 text-red-700'
  if (entry.kind === 'project-deadline') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (entry.kind === 'task-start') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (entry.kind === 'task-due') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-purple-200 bg-purple-50 text-purple-700'
}

function isTaskOverdue(task: Task) {
  if (!task.due_at) return false

  const due = new Date(task.due_at).getTime()
  if (!Number.isFinite(due)) return false

  if (task.status !== 'done') {
    return Date.now() > due
  }

  if (task.completed_at) {
    return new Date(task.completed_at).getTime() > due
  }

  return false
}

function MiniBadge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${className}`}>
      {children}
    </span>
  )
}

export default function CalendarPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Listing[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<ProjectEvent[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const [projectFilter, setProjectFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const loadCalendar = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    const nextErrors: string[] = []

    const addLoadError = (label: string, error: unknown) => {
      logAppError(label, error)
      nextErrors.push(
        `${label}: ${getAppErrorMessage(error, 'Не удалось загрузить данные.')}`
      )
    }

    const { data: userData, error: userError } = await supabase.auth.getUser()

    if (userError) addLoadError('Авторизация', userError)

    const currentUser = userData?.user

    if (!currentUser) {
      setRefreshing(false)
      setLoading(false)
      router.replace('/auth')
      return
    }

    setUserId(currentUser.id)

    const [ownerProjectsRes, applicationsRes] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title,description,created_by,deadline_at,created_at')
        .eq('created_by', currentUser.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('applications')
        .select('id,listing_id,user_id,status')
        .eq('user_id', currentUser.id)
        .eq('status', 'accepted'),
    ])

    if (ownerProjectsRes.error) addLoadError('Мои проекты', ownerProjectsRes.error)
    if (applicationsRes.error) addLoadError('Участие в проектах', applicationsRes.error)

    const ownerProjects = (ownerProjectsRes.data || []) as Listing[]
    const applications = (applicationsRes.data || []) as Application[]
    const memberProjectIds = unique(applications.map((item) => item.listing_id))

    let memberProjects: Listing[] = []

    if (memberProjectIds.length > 0) {
      const { data, error } = await supabase
        .from('listings')
        .select('id,title,description,created_by,deadline_at,created_at')
        .in('id', memberProjectIds)
        .order('created_at', { ascending: false })

      if (error) addLoadError('Проекты-участия', error)
      memberProjects = (data || []) as Listing[]
    }

    const projectsById = new Map<string, Listing>()
    ;[...ownerProjects, ...memberProjects].forEach((project) => {
      projectsById.set(project.id, project)
    })

    const availableProjects = Array.from(projectsById.values())
    const projectIds = availableProjects.map((project) => project.id)

    let nextTasks: Task[] = []
    let nextEvents: ProjectEvent[] = []

    if (projectIds.length > 0) {
      const [tasksRes, eventsRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id,project_id,title,description,status,assignee_id,start_at,due_at,completed_at,created_at')
          .in('project_id', projectIds)
          .order('due_at', { ascending: true, nullsFirst: false }),

        supabase
          .from('project_events')
          .select('id,project_id,created_by,title,description,event_type,starts_at,ends_at,created_at')
          .in('project_id', projectIds)
          .order('starts_at', { ascending: true, nullsFirst: false }),
      ])

      if (tasksRes.error) addLoadError('Задачи', tasksRes.error)
      if (eventsRes.error) addLoadError('События календаря', eventsRes.error)

      nextTasks = (tasksRes.data || []) as Task[]
      nextEvents = (eventsRes.data || []) as ProjectEvent[]
    }

    setProjects(availableProjects)
    setTasks(nextTasks)
    setEvents(nextEvents)
    setErrors(nextErrors)
    setRefreshing(false)
    setLoading(false)
  }

  useEffect(() => {
    loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projectsById = useMemo(() => {
    return Object.fromEntries(projects.map((project) => [project.id, project])) as Record<string, Listing>
  }, [projects])

  const allEntries = useMemo<CalendarEntry[]>(() => {
    const now = Date.now()

    const projectDeadlines: CalendarEntry[] = projects
      .filter((project) => project.deadline_at)
      .map((project) => {
        const deadlineTime = project.deadline_at ? new Date(project.deadline_at).getTime() : 0

        return {
          id: `project-deadline-${project.id}`,
          projectId: project.id,
          projectTitle: project.title,
          sourceId: project.id,
          kind: 'project-deadline',
          title: project.title,
          subtitle: 'Дедлайн проекта',
          date: project.deadline_at || '',
          endDate: project.deadline_at || null,
          href: `/projects/${project.id}`,
          isOverdue: Boolean(deadlineTime && now > deadlineTime),
        }
      })

    const taskEntries: CalendarEntry[] = tasks.flatMap((task) => {
      const project = projectsById[task.project_id]
      const projectTitle = project?.title || 'Проект'
      const items: CalendarEntry[] = []

      if (task.start_at) {
        items.push({
          id: `task-start-${task.id}`,
          projectId: task.project_id,
          projectTitle,
          sourceId: task.id,
          kind: 'task-start',
          title: task.title,
          subtitle: `Старт задачи · ${taskStatusLabel(task.status)}`,
          date: task.start_at,
          endDate: task.start_at,
          href: `/projects/${task.project_id}`,
          isOverdue: false,
          status: task.status,
        })
      }

      if (task.due_at) {
        items.push({
          id: `task-due-${task.id}`,
          projectId: task.project_id,
          projectTitle,
          sourceId: task.id,
          kind: 'task-due',
          title: task.title,
          subtitle: `Дедлайн задачи · ${taskStatusLabel(task.status)}`,
          date: task.due_at,
          endDate: task.due_at,
          href: `/projects/${task.project_id}`,
          isOverdue: isTaskOverdue(task),
          status: task.status,
        })
      }

      return items
    })

    const eventEntries: CalendarEntry[] = events
      .filter((event) => event.starts_at)
      .map((event) => {
        const project = projectsById[event.project_id]

        return {
          id: `event-${event.id}`,
          projectId: event.project_id,
          projectTitle: project?.title || 'Проект',
          sourceId: event.id,
          kind: 'event',
          eventType: event.event_type,
          title: event.title,
          subtitle: event.description || eventTypeLabel(event.event_type),
          date: event.starts_at || '',
          endDate: event.ends_at || event.starts_at,
          href: `/projects/${event.project_id}`,
          isOverdue: false,
        }
      })

    return [...projectDeadlines, ...taskEntries, ...eventEntries].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )
  }, [events, projects, projectsById, tasks])

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase()

    return allEntries.filter((entry) => {
      if (projectFilter !== 'all' && entry.projectId !== projectFilter) return false

      if (typeFilter === 'tasks' && !entry.kind.startsWith('task')) return false
      if (typeFilter === 'events' && entry.kind !== 'event') return false
      if (typeFilter === 'deadlines' && entry.kind !== 'task-due' && entry.kind !== 'project-deadline') return false
      if (typeFilter === 'overdue' && !entry.isOverdue) return false

      if (!q) return true

      return [entry.title, entry.subtitle, entry.projectTitle, entryTypeLabel(entry)]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(q))
    })
  }, [allEntries, projectFilter, search, typeFilter])

  const upcomingEntries = useMemo(() => {
    const today = startOfDay(new Date()).getTime()

    return filteredEntries
      .filter((entry) => new Date(entry.date).getTime() >= today)
      .slice(0, 10)
  }, [filteredEntries])

  const overdueEntries = useMemo(() => {
    return allEntries.filter((entry) => entry.isOverdue)
  }, [allEntries])

  const [calendarYear, calendarMonthIndex] = calendarMonth.split('-').map((part) => Number(part))
  const safeYear = Number.isFinite(calendarYear) ? calendarYear : new Date().getFullYear()
  const safeMonthIndex = Number.isFinite(calendarMonthIndex) ? calendarMonthIndex - 1 : new Date().getMonth()
  const monthStart = new Date(safeYear, safeMonthIndex, 1)
  const daysInMonth = new Date(safeYear, safeMonthIndex + 1, 0).getDate()
  const startOffset = (monthStart.getDay() + 6) % 7
  const calendarCells = [
    ...Array.from({ length: startOffset }, (_, index) => ({ id: `empty-${index}`, date: null as Date | null })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({ id: `day-${index + 1}`, date: new Date(safeYear, safeMonthIndex, index + 1) })),
  ]

  const shiftMonth = (delta: number) => {
    const next = new Date(safeYear, safeMonthIndex + delta, 1)
    setCalendarMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  const goToday = () => {
    const now = new Date()
    setCalendarMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  }

  const entriesForDate = (date: Date) => {
    return filteredEntries.filter((entry) => sameLocalDay(entry.date, date))
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-xl border bg-white p-8 text-center text-gray-600 shadow-sm">
          Загружаю календарь...
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-blue-700">Рабочий центр</p>
          <h1 className="text-3xl font-bold text-gray-900">Календарь</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Все дедлайны, старты задач и события из проектов, к которым у тебя есть доступ.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/tasks"
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            Задачи
          </Link>
          <button
            onClick={() => loadCalendar(true)}
            disabled={refreshing}
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
          >
            {refreshing ? 'Обновляем...' : 'Обновить'}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          <div className="mb-2 font-semibold">Часть данных не загрузилась:</div>
          <ul className="list-disc space-y-1 pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{projects.length}</div>
          <div className="text-sm text-gray-500">доступных проектов</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{events.length}</div>
          <div className="text-sm text-gray-500">событий проекта</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{tasks.filter((task) => task.start_at || task.due_at).length}</div>
          <div className="text-sm text-gray-500">задач с датами</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-red-700">{overdueEntries.length}</div>
          <div className="text-sm text-gray-500">просроченных сроков</div>
        </div>
      </div>

      <section className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Поиск</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Задача, событие, проект..."
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Проект</label>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
            >
              <option value="all">Все проекты</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Тип</label>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500"
            >
              <option value="all">Все типы</option>
              <option value="tasks">Задачи</option>
              <option value="events">События</option>
              <option value="deadlines">Дедлайны</option>
              <option value="overdue">Просроченные</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={() => {
                setSearch('')
                setProjectFilter('all')
                setTypeFilter('all')
              }}
              className="w-full rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Сбросить
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Месячный вид</h2>
              <p className="text-sm text-gray-500">События отображаются точечно по дате старта или дедлайна.</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftMonth(-1)}
                className="rounded-lg bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-200"
              >
                ←
              </button>
              <div className="min-w-[180px] text-center font-medium capitalize text-gray-900">
                {formatMonthLabel(monthStart)}
              </div>
              <button
                onClick={() => shiftMonth(1)}
                className="rounded-lg bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-200"
              >
                →
              </button>
              <button
                onClick={goToday}
                className="rounded-lg bg-blue-600 px-3 py-1 text-sm text-white transition hover:bg-blue-700"
              >
                Сегодня
              </button>
            </div>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-2 text-xs font-medium text-gray-500">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
              <div key={day} className="text-center">{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((cell) => {
              if (!cell.date) {
                return <div key={cell.id} className="min-h-[120px] rounded-lg border bg-gray-50/70" />
              }

              const dateEntries = entriesForDate(cell.date)
              const today = new Date()
              const isToday = sameLocalDay(today.toISOString(), cell.date)

              return (
                <div
                  key={cell.id}
                  className={`min-h-[120px] rounded-lg border bg-white p-2 ${isToday ? 'border-blue-500 ring-1 ring-blue-200' : 'border-gray-200'}`}
                >
                  <div className={`mb-2 text-xs font-semibold ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                    {cell.date.getDate()}
                  </div>

                  <div className="space-y-1">
                    {dateEntries.slice(0, 3).map((entry) => (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        title={`${entryTypeLabel(entry)} · ${entry.projectTitle}`}
                        className={`block rounded border px-2 py-1 text-[11px] leading-tight transition hover:brightness-95 ${entryClassName(entry)}`}
                      >
                        <div className="truncate font-medium">{entry.title}</div>
                        <div className="truncate opacity-80">{entryTypeLabel(entry)}</div>
                      </Link>
                    ))}

                    {dateEntries.length > 3 && (
                      <div className="text-[11px] text-gray-500">+ ещё {dateEntries.length - 3}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Ближайшее</h2>
              <span className="text-xs text-gray-400">{upcomingEntries.length} из {filteredEntries.length}</span>
            </div>

            {upcomingEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                Ближайших событий по выбранным фильтрам нет.
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingEntries.map((entry) => (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    className="block rounded-lg border p-3 transition hover:border-blue-300 hover:bg-blue-50/40"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{entry.title}</div>
                        <div className="mt-1 text-xs text-gray-500">{entry.projectTitle}</div>
                      </div>
                      <MiniBadge className={entryClassName(entry)}>{entryTypeLabel(entry)}</MiniBadge>
                    </div>
                    <div className="text-sm text-gray-700">{formatDateTime(entry.date)}</div>
                    {entry.endDate && entry.endDate !== entry.date && (
                      <div className="mt-1 text-xs text-gray-500">до {formatDateTime(entry.endDate)}</div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Просроченное</h2>
              <span className="text-xs text-gray-400">{overdueEntries.length}</span>
            </div>

            {overdueEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                Просроченных сроков нет.
              </div>
            ) : (
              <div className="space-y-3">
                {overdueEntries.slice(0, 8).map((entry) => (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    className="block rounded-lg border border-red-200 bg-red-50 p-3 transition hover:bg-red-100"
                  >
                    <div className="text-sm font-semibold text-red-800">{entry.title}</div>
                    <div className="mt-1 text-xs text-red-700">{entry.projectTitle}</div>
                    <div className="mt-2 text-sm text-red-800">{formatDateTime(entry.date)}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  )
}