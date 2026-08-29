'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { createNotification } from '@/lib/notifications'
import { createProjectActivity } from '@/lib/projectActivity'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

type Listing = {
  id: string
  title: string
  description: string | null
  created_by: string | null
  deadline_at: string | null
}

type Application = {
  listing_id: string
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
  penalty_percent: number | null
  excuse_reason: string | null
  excuse_status: 'none' | 'pending' | 'approved' | 'rejected' | string | null
}

type ScopeFilter = 'assigned' | 'owned' | 'all'
type StatusFilter = 'active' | 'overdue' | 'todo' | 'doing' | 'done' | 'all'

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Без срока'

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

function formatShortDate(value?: string | null) {
  if (!value) return 'Без срока'

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function taskStatusLabel(status: string) {
  if (status === 'todo') return 'К выполнению'
  if (status === 'doing') return 'В работе'
  if (status === 'done') return 'Готово'
  return status
}

function statusBadgeClass(status: string) {
  if (status === 'todo') return 'bg-gray-50 text-gray-700 border-gray-200'
  if (status === 'doing') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (status === 'done') return 'bg-green-50 text-green-700 border-green-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function isOverdue(task: Task) {
  if (!task.due_at || task.status === 'done') return false
  return new Date(task.due_at).getTime() < Date.now()
}

function sortTasks(a: Task, b: Task) {
  const aOverdue = isOverdue(a) ? 0 : 1
  const bOverdue = isOverdue(b) ? 0 : 1
  if (aOverdue !== bOverdue) return aOverdue - bOverdue

  const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY
  const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue

  const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0
  const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0
  return bCreated - aCreated
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  )
}

export default function TasksPage() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [errorText, setErrorText] = useState('')

  const [projects, setProjects] = useState<Listing[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('assigned')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [projectFilter, setProjectFilter] = useState('all')
  const [search, setSearch] = useState('')

  const projectsById = useMemo(() => {
    return Object.fromEntries(projects.map((project) => [project.id, project]))
  }, [projects])

  const ownerProjectIds = useMemo(() => {
    if (!userId) return new Set<string>()
    return new Set(projects.filter((project) => project.created_by === userId).map((project) => project.id))
  }, [projects, userId])

  const assignedTasks = useMemo(() => {
    if (!userId) return []
    return tasks.filter((task) => task.assignee_id === userId)
  }, [tasks, userId])

  const ownedProjectTasks = useMemo(() => {
    return tasks.filter((task) => ownerProjectIds.has(task.project_id))
  }, [tasks, ownerProjectIds])

  const overdueTasks = useMemo(() => tasks.filter(isOverdue), [tasks])
  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== 'done'), [tasks])

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()

    return tasks
      .filter((task) => {
        const project = projectsById[task.project_id]

        if (scopeFilter === 'assigned' && task.assignee_id !== userId) return false
        if (scopeFilter === 'owned' && !ownerProjectIds.has(task.project_id)) return false

        if (statusFilter === 'active' && task.status === 'done') return false
        if (statusFilter === 'overdue' && !isOverdue(task)) return false
        if (statusFilter === 'todo' && task.status !== 'todo') return false
        if (statusFilter === 'doing' && task.status !== 'doing') return false
        if (statusFilter === 'done' && task.status !== 'done') return false

        if (projectFilter !== 'all' && task.project_id !== projectFilter) return false

        if (q) {
          const haystack = [
            task.title,
            task.description || '',
            project?.title || '',
            project?.description || '',
          ]
            .join(' ')
            .toLowerCase()

          if (!haystack.includes(q)) return false
        }

        return true
      })
      .sort(sortTasks)
  }, [tasks, search, statusFilter, scopeFilter, projectFilter, projectsById, userId, ownerProjectIds])

  const loadTasks = async (silent = false) => {
    if (silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setErrorText('')

    const { data: userData, error: userError } = await supabase.auth.getUser()

    if (userError) {
      setErrorText(userError.message)
    }

    const currentUser = userData?.user

    if (!currentUser) {
      setLoading(false)
      setRefreshing(false)
      router.replace('/auth')
      return
    }

    setUserId(currentUser.id)

    const [ownerProjectsRes, acceptedApplicationsRes] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title,description,created_by,deadline_at')
        .eq('created_by', currentUser.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('applications')
        .select('listing_id')
        .eq('user_id', currentUser.id)
        .eq('status', 'accepted'),
    ])

    if (ownerProjectsRes.error) {
      setErrorText(`Мои проекты: ${ownerProjectsRes.error.message}`)
      setLoading(false)
      setRefreshing(false)
      return
    }

    if (acceptedApplicationsRes.error) {
      setErrorText(`Проекты-участия: ${acceptedApplicationsRes.error.message}`)
      setLoading(false)
      setRefreshing(false)
      return
    }

    const ownerProjects = (ownerProjectsRes.data || []) as Listing[]
    const applications = (acceptedApplicationsRes.data || []) as Application[]
    const memberProjectIds = unique(applications.map((item) => item.listing_id))
    const ownerProjectIdsList = ownerProjects.map((project) => project.id)
    const accessibleProjectIds = unique([...ownerProjectIdsList, ...memberProjectIds])

    if (accessibleProjectIds.length === 0) {
      setProjects([])
      setTasks([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    const [projectsRes, tasksRes] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title,description,created_by,deadline_at')
        .in('id', accessibleProjectIds),

      supabase
        .from('tasks')
        .select('id,project_id,title,description,status,assignee_id,start_at,due_at,completed_at,created_at,penalty_percent,excuse_reason,excuse_status')
        .in('project_id', accessibleProjectIds)
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(300),
    ])

    if (projectsRes.error) {
      setErrorText(`Проекты: ${projectsRes.error.message}`)
    }

    if (tasksRes.error) {
      setErrorText(`Задачи: ${tasksRes.error.message}`)
    }

    setProjects((projectsRes.data || []) as Listing[])
    setTasks((tasksRes.data || []) as Task[])

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const notifyProjectOwner = async (task: Task, status: string) => {
    if (!userId || status !== 'done') return

    const project = projectsById[task.project_id]
    const ownerId = project?.created_by

    if (!ownerId || ownerId === userId) return

    await createNotification({
      recipientId: ownerId,
      actorId: userId,
      projectId: task.project_id,
      type: 'task_done',
      title: 'Задача завершена',
      body: `Задача «${task.title}» отмечена как выполненная.`,
      href: `/projects/${task.project_id}`,
      payload: {
        task_id: task.id,
        task_title: task.title,
        source: 'tasks_page',
      },
    })
  }

  const handleChangeStatus = async (task: Task, nextStatus: 'todo' | 'doing' | 'done') => {
    if (!userId) return

    const isAssignedToMe = task.assignee_id === userId
    const isOwnerProjectTask = ownerProjectIds.has(task.project_id)

    if (!isAssignedToMe && !isOwnerProjectTask) {
      showAppMessage('Менять статус может исполнитель или автор проекта.')
      return
    }

    setSavingTaskId(task.id)

    const updates: Partial<Task> = {
      status: nextStatus,
      completed_at: nextStatus === 'done' ? new Date().toISOString() : null,
    }

    const { error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', task.id)

    if (error) {
      logAppError('Ошибка обновления статуса задачи:', error)
      showAppMessage('Ошибка обновления статуса задачи: ' + error.message)
      setSavingTaskId(null)
      return
    }

    await createProjectActivity({
      projectId: task.project_id,
      actorId: userId,
      type: nextStatus === 'done' ? 'task_completed' : 'task_status_changed',
      title: nextStatus === 'done' ? 'Задача завершена' : 'Статус задачи изменён',
      body: `«${task.title}» → ${taskStatusLabel(nextStatus)}`,
      entityType: 'task',
      entityId: task.id,
      metadata: {
        task_id: task.id,
        task_title: task.title,
        old_status: task.status,
        new_status: nextStatus,
        source: 'tasks_page',
      },
    })

    await notifyProjectOwner(task, nextStatus)
    await loadTasks(true)
    setSavingTaskId(null)
  }

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="rounded-xl border bg-white p-6 shadow-sm">Загружаем задачи...</div>
      </main>
    )
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Мои задачи</h1>
          <p className="mt-2 max-w-3xl text-gray-600">
            Общий список задач из проектов, где ты автор или участник. Здесь удобно смотреть дедлайны,
            просрочки и быстро менять статус своих задач.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadTasks(true)}
            disabled={refreshing}
            className="rounded-lg border px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          >
            {refreshing ? 'Обновляем...' : 'Обновить'}
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg border px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
          >
            Дашборд
          </Link>
        </div>
      </div>

      {errorText && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorText}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <StatCard label="назначено мне" value={assignedTasks.length} />
        <StatCard label="активных" value={activeTasks.length} />
        <StatCard label="просроченных" value={overdueTasks.length} />
        <StatCard label="в моих проектах" value={ownedProjectTasks.length} />
      </div>

      <section className="mb-6 rounded-xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по задаче или проекту"
            className="rounded-lg border px-3 py-2 text-sm lg:col-span-1"
          />

          <select
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="assigned">Назначены мне</option>
            <option value="owned">В моих проектах</option>
            <option value="all">Все доступные</option>
          </select>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="active">Активные</option>
            <option value="overdue">Просроченные</option>
            <option value="todo">К выполнению</option>
            <option value="doing">В работе</option>
            <option value="done">Готово</option>
            <option value="all">Все статусы</option>
          </select>

          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">Все проекты</option>
            {projects
              .slice()
              .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
          </select>
        </div>
      </section>

      {filteredTasks.length === 0 ? (
        <section className="rounded-xl border border-dashed bg-gray-50 p-8 text-center text-gray-500">
          По текущим фильтрам задач нет.
        </section>
      ) : (
        <section className="space-y-3">
          {filteredTasks.map((task) => {
            const project = projectsById[task.project_id]
            const overdue = isOverdue(task)
            const canChangeStatus = task.assignee_id === userId || ownerProjectIds.has(task.project_id)

            return (
              <article
                key={task.id}
                className={`rounded-xl border bg-white p-5 shadow-sm ${
                  overdue ? 'border-red-200 bg-red-50/30' : ''
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(task.status)}`}>
                        {taskStatusLabel(task.status)}
                      </span>
                      {overdue && (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          Просрочено
                        </span>
                      )}
                      {task.excuse_status === 'pending' && (
                        <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                          Причина на рассмотрении
                        </span>
                      )}
                    </div>

                    <h2 className="text-lg font-semibold text-gray-900">{task.title}</h2>

                    <Link
                      href={`/projects/${task.project_id}`}
                      className="mt-1 inline-block text-sm text-blue-700 hover:underline"
                    >
                      {project?.title || 'Проект'}
                    </Link>

                    {task.description && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-gray-600">{task.description}</p>
                    )}

                    <div className="mt-4 grid gap-2 text-sm text-gray-500 sm:grid-cols-3">
                      <div>
                        <span className="font-medium text-gray-700">Старт:</span> {formatShortDate(task.start_at)}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Дедлайн:</span> {formatDateTime(task.due_at)}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Штраф:</span>{' '}
                        {task.penalty_percent ?? 0}%
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-48">
                    <Link
                      href={`/projects/${task.project_id}`}
                      className="rounded-lg border px-3 py-2 text-center text-sm text-gray-700 transition hover:bg-gray-50"
                    >
                      Открыть проект
                    </Link>

                    {canChangeStatus && task.status !== 'doing' && task.status !== 'done' && (
                      <button
                        type="button"
                        onClick={() => handleChangeStatus(task, 'doing')}
                        disabled={savingTaskId === task.id}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white transition hover:bg-blue-700 disabled:opacity-60"
                      >
                        {savingTaskId === task.id ? 'Сохраняем...' : 'Взять в работу'}
                      </button>
                    )}

                    {canChangeStatus && task.status !== 'done' && (
                      <button
                        type="button"
                        onClick={() => handleChangeStatus(task, 'done')}
                        disabled={savingTaskId === task.id}
                        className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white transition hover:bg-green-700 disabled:opacity-60"
                      >
                        {savingTaskId === task.id ? 'Сохраняем...' : 'Завершить'}
                      </button>
                    )}

                    {canChangeStatus && task.status === 'done' && (
                      <button
                        type="button"
                        onClick={() => handleChangeStatus(task, 'doing')}
                        disabled={savingTaskId === task.id}
                        className="rounded-lg border px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                      >
                        Вернуть в работу
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}