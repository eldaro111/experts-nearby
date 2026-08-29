'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getAppErrorMessage, logAppError, showAppError } from '@/lib/appFeedback'

type ResultType = 'project' | 'task' | 'file' | 'auction' | 'expert' | 'notification'
type TypeFilter = 'all' | ResultType

type Listing = {
  id: string
  title: string
  description: string | null
  created_by: string | null
  created_at: string | null
  deadline_at: string | null
}

type Task = {
  id: string
  project_id: string
  title: string
  description: string | null
  status: string
  assignee_id: string | null
  due_at: string | null
  created_at: string | null
}

type ProjectFile = {
  id: string
  project_id: string
  uploaded_by: string | null
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  category: string | null
  description: string | null
  version_label: string | null
  created_at: string | null
}

type Auction = {
  id: string
  title: string
  type: string
  status: string
  public_summary: string | null
  public_description: string | null
  category: string | null
  deal_type: string | null
  readiness_level: string | null
  created_at: string | null
  ends_at: string | null
}

type Expert = {
  user_id: string
  display_name: string | null
  roles: unknown
  skills: unknown
  city: string | null
  work_format: string | null
  experience_level: string | null
  about: string | null
  hourly_rate: number | null
  availability_hours: number | null
  portfolio_links: unknown
}

type NotificationItem = {
  id: string
  title: string
  body: string | null
  type: string | null
  href: string | null
  read_at: string | null
  created_at: string | null
}

type SearchResult = {
  id: string
  type: ResultType
  title: string
  subtitle: string
  description: string
  href: string
  createdAt: string | null
  projectId?: string
  filePath?: string
  badge?: string
}

const typeLabels: Record<ResultType, string> = {
  project: 'Проект',
  task: 'Задача',
  file: 'Файл',
  auction: 'Аукцион',
  expert: 'Эксперт',
  notification: 'Уведомление',
}

const typeBadgeClass: Record<ResultType, string> = {
  project: 'bg-blue-50 text-blue-700 border-blue-200',
  task: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  file: 'bg-purple-50 text-purple-700 border-purple-200',
  auction: 'bg-orange-50 text-orange-700 border-orange-200',
  expert: 'bg-pink-50 text-pink-700 border-pink-200',
  notification: 'bg-gray-50 text-gray-700 border-gray-200',
}

const taskStatusLabel: Record<string, string> = {
  todo: 'К выполнению',
  doing: 'В работе',
  done: 'Готово',
}

const auctionTypeLabel: Record<string, string> = {
  request: 'Заказ',
  offer: 'Проект для внедрения',
}

const workFormatLabel: Record<string, string> = {
  remote: 'Удалённо',
  onsite: 'Очно',
  hybrid: 'Гибрид',
}

const experienceLabel: Record<string, string> = {
  junior: 'Junior',
  middle: 'Middle',
  senior: 'Senior',
  expert: 'Expert',
}

function toTextList(value: unknown): string[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const objectItem = item as Record<string, unknown>
          return String(objectItem.label || objectItem.name || objectItem.title || objectItem.value || '')
        }
        return String(item || '')
      })
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    if (!trimmed) return []

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return toTextList(parsed)
    } catch {
      // обычная строка, не JSON
    }

    return trimmed
      .split(/[;,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return [String(value)].filter(Boolean)
}

function formatDate(value?: string | null) {
  if (!value) return 'Дата не указана'

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

function formatFileSize(size: number | null) {
  if (!size || size <= 0) return '—'

  const kb = size / 1024
  if (kb < 1024) return `${kb.toFixed(1)} КБ`

  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} МБ`

  return `${(mb / 1024).toFixed(1)} ГБ`
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function matchesQuery(result: SearchResult, query: string) {
  const q = normalize(query)
  if (!q) return true

  const text = [result.title, result.subtitle, result.description, result.badge, typeLabels[result.type]]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => text.includes(part))
}

function sortResults(a: SearchResult, b: SearchResult) {
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
  return bTime - aTime
}

function ResultCard({
  result,
  onOpenFile,
  openingFileId,
}: {
  result: SearchResult
  onOpenFile: (result: SearchResult) => void
  openingFileId: string | null
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${typeBadgeClass[result.type]}`}>
              {typeLabels[result.type]}
            </span>
            {result.badge && (
              <span className="rounded-full border bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                {result.badge}
              </span>
            )}
          </div>

          <h2 className="text-lg font-semibold text-gray-900">{result.title}</h2>
          <p className="mt-1 text-sm text-gray-500">{result.subtitle}</p>
        </div>

        <div className="text-xs text-gray-400">{formatDate(result.createdAt)}</div>
      </div>

      {result.description && <p className="mt-3 text-sm leading-6 text-gray-700">{result.description}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={result.href}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Открыть
        </Link>

        {result.type === 'file' && result.filePath && (
          <button
            onClick={() => onOpenFile(result)}
            disabled={openingFileId === result.id}
            className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {openingFileId === result.id ? 'Открываем...' : 'Открыть файл'}
          </button>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left shadow-sm transition hover:shadow-md ${
        active ? 'border-blue-300 bg-blue-50' : 'bg-white'
      }`}
    >
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </button>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <section className="rounded-xl border bg-white p-5 shadow-sm">{children}</section>
}

export default function SearchPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const [results, setResults] = useState<SearchResult[]>([])
  const [openingFileId, setOpeningFileId] = useState<string | null>(null)

  const loadSearchData = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    setErrorText('')

    const { data: userData } = await supabase.auth.getUser()
    const currentUser = userData?.user

    if (!currentUser) {
      setLoading(false)
      setRefreshing(false)
      router.replace('/auth')
      return
    }

    const errors: string[] = []

    const addLoadError = (label: string, error: unknown) => {
      logAppError(label, error)
      errors.push(
        `${label}: ${getAppErrorMessage(error, 'Не удалось загрузить данные.')}`
      )
    }

    const [ownerProjectsRes, acceptedApplicationsRes, auctionsRes, expertsRes, notificationsRes] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title,description,created_by,created_at,deadline_at')
        .eq('created_by', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(150),

      supabase
        .from('applications')
        .select('listing_id')
        .eq('user_id', currentUser.id)
        .eq('status', 'accepted')
        .limit(250),

      supabase
        .from('auctions')
        .select('id,title,type,status,public_summary,public_description,category,deal_type,readiness_level,created_at,ends_at')
        .order('created_at', { ascending: false })
        .limit(200),

      supabase
        .from('profiles_public')
        .select('user_id,display_name,roles,skills,city,work_format,experience_level,about,hourly_rate,availability_hours,portfolio_links')
        .limit(250),

      supabase
        .from('notifications')
        .select('id,title,body,type,href,read_at,created_at')
        .eq('recipient_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    if (ownerProjectsRes.error) addLoadError('Проекты', ownerProjectsRes.error)
    if (acceptedApplicationsRes.error) addLoadError('Участие в проектах', acceptedApplicationsRes.error)
    if (auctionsRes.error) addLoadError('Аукционы', auctionsRes.error)
    if (expertsRes.error) addLoadError('Эксперты', expertsRes.error)
    if (notificationsRes.error) addLoadError('Уведомления', notificationsRes.error)

    const ownerProjects = (ownerProjectsRes.data || []) as Listing[]
    const acceptedProjectIds = ((acceptedApplicationsRes.data || []) as Array<{ listing_id: string }>).map(
      (item) => item.listing_id
    )

    const memberProjectsRes = acceptedProjectIds.length
      ? await supabase
          .from('listings')
          .select('id,title,description,created_by,created_at,deadline_at')
          .in('id', acceptedProjectIds)
      : { data: [], error: null }

    if (memberProjectsRes.error) addLoadError('Проекты-участия', memberProjectsRes.error)

    const memberProjects = ((memberProjectsRes.data || []) as Listing[]).filter(
      (project) => project.created_by !== currentUser.id
    )

    const projects = [...ownerProjects, ...memberProjects]
    const projectIds = Array.from(new Set(projects.map((project) => project.id)))
    const projectsById = Object.fromEntries(projects.map((project) => [project.id, project]))

    const [tasksRes, filesRes] = await Promise.all([
      projectIds.length
        ? supabase
            .from('tasks')
            .select('id,project_id,title,description,status,assignee_id,due_at,created_at')
            .in('project_id', projectIds)
            .order('created_at', { ascending: false })
            .limit(250)
        : Promise.resolve({ data: [], error: null }),

      projectIds.length
        ? supabase
            .from('project_files')
            .select('id,project_id,uploaded_by,file_name,file_path,file_size,mime_type,category,description,version_label,created_at')
            .in('project_id', projectIds)
            .order('created_at', { ascending: false })
            .limit(250)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (tasksRes.error) addLoadError('Задачи', tasksRes.error)
    if (filesRes.error) addLoadError('Файлы', filesRes.error)

    const projectResults: SearchResult[] = projects.map((project) => ({
      id: `project-${project.id}`,
      type: 'project',
      title: project.title || 'Без названия',
      subtitle: project.created_by === currentUser.id ? 'Мой проект' : 'Участвую в проекте',
      description: project.description || 'Описание не указано.',
      href: `/projects/${project.id}`,
      createdAt: project.created_at,
      projectId: project.id,
      badge: project.deadline_at ? `Дедлайн: ${formatDate(project.deadline_at)}` : 'Без дедлайна',
    }))

    const taskResults: SearchResult[] = ((tasksRes.data || []) as Task[]).map((task) => {
      const project = projectsById[task.project_id]

      return {
        id: `task-${task.id}`,
        type: 'task',
        title: task.title || 'Задача без названия',
        subtitle: project?.title || 'Проект',
        description: task.description || 'Описание задачи не указано.',
        href: `/projects/${task.project_id}`,
        createdAt: task.created_at,
        projectId: task.project_id,
        badge: `${taskStatusLabel[task.status] || task.status}${task.due_at ? ` · до ${formatDate(task.due_at)}` : ''}`,
      }
    })

    const fileResults: SearchResult[] = ((filesRes.data || []) as ProjectFile[]).map((file) => {
      const project = projectsById[file.project_id]

      return {
        id: `file-${file.id}`,
        type: 'file',
        title: file.file_name || 'Файл без названия',
        subtitle: project?.title || 'Проект',
        description: [file.description, file.version_label ? `Версия: ${file.version_label}` : null]
          .filter(Boolean)
          .join(' · ') || 'Описание файла не указано.',
        href: `/projects/${file.project_id}`,
        createdAt: file.created_at,
        projectId: file.project_id,
        filePath: file.file_path,
        badge: `${file.category || 'other'} · ${formatFileSize(file.file_size)}`,
      }
    })

    const auctionResults: SearchResult[] = ((auctionsRes.data || []) as Auction[]).map((auction) => ({
      id: `auction-${auction.id}`,
      type: 'auction',
      title: auction.title || 'Аукцион без названия',
      subtitle: `${auctionTypeLabel[auction.type] || auction.type} · ${auction.status}`,
      description: auction.public_summary || auction.public_description || 'Описание аукциона не указано.',
      href: `/auctions/${auction.id}`,
      createdAt: auction.created_at,
      badge: [auction.category, auction.deal_type, auction.readiness_level].filter(Boolean).join(' · ') || undefined,
    }))

    const expertResults: SearchResult[] = ((expertsRes.data || []) as Expert[]).map((expert) => {
      const roles = toTextList(expert.roles)
      const skills = toTextList(expert.skills)
      const portfolioLinks = toTextList(expert.portfolio_links)

      return {
        id: `expert-${expert.user_id}`,
        type: 'expert',
        title: expert.display_name || 'Эксперт без имени',
        subtitle: [
          expert.city,
          expert.work_format ? workFormatLabel[expert.work_format] || expert.work_format : null,
          expert.experience_level ? experienceLabel[expert.experience_level] || expert.experience_level : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Профиль эксперта',
        description:
          [expert.about, roles.length ? `Роли: ${roles.join(', ')}` : null, skills.length ? `Навыки: ${skills.join(', ')}` : null, portfolioLinks.length ? `Портфолио: ${portfolioLinks.join(', ')}` : null]
            .filter(Boolean)
            .join(' · ') || 'Описание профиля не указано.',
        href: `/users/${expert.user_id}`,
        createdAt: null,
        badge: expert.hourly_rate ? `${expert.hourly_rate} ₽/час` : undefined,
      }
    })

    const notificationResults: SearchResult[] = ((notificationsRes.data || []) as NotificationItem[]).map((notification) => ({
      id: `notification-${notification.id}`,
      type: 'notification',
      title: notification.title || 'Уведомление',
      subtitle: notification.read_at ? 'Прочитано' : 'Непрочитано',
      description: notification.body || 'Без текста.',
      href: notification.href || '/notifications',
      createdAt: notification.created_at,
      badge: notification.type || undefined,
    }))

    setResults([
      ...projectResults,
      ...taskResults,
      ...fileResults,
      ...auctionResults,
      ...expertResults,
      ...notificationResults,
    ])

    setErrorText(errors.join('\n'))
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    const initialQuery = new URLSearchParams(window.location.search).get('q') || ''
    setQuery(initialQuery)
    loadSearchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const countsByType = useMemo(() => {
    return results.reduce<Record<TypeFilter, number>>(
      (acc, result) => {
        acc.all += 1
        acc[result.type] += 1
        return acc
      },
      {
        all: 0,
        project: 0,
        task: 0,
        file: 0,
        auction: 0,
        expert: 0,
        notification: 0,
      }
    )
  }, [results])

  const filteredResults = useMemo(() => {
    return results
      .filter((result) => typeFilter === 'all' || result.type === typeFilter)
      .filter((result) => matchesQuery(result, query))
      .sort(sortResults)
  }, [results, query, typeFilter])

  const onOpenFile = async (result: SearchResult) => {
    if (!result.filePath || openingFileId) return

    setOpeningFileId(result.id)

    try {
      const { data, error } = await supabase.storage
        .from('project-files')
        .createSignedUrl(result.filePath, 60 * 5)

      if (error || !data?.signedUrl) {
        showAppError(
          error,
          'Не удалось создать безопасную ссылку на файл.',
          'Ошибка открытия файла'
        )
        return
      }

      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      showAppError(error, 'Не удалось открыть файл.', 'Ошибка открытия файла')
    } finally {
      setOpeningFileId(null)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-xl border bg-white p-8 text-center text-gray-600 shadow-sm">Загружаю поиск...</div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-blue-700">Рабочий центр</p>
          <h1 className="text-3xl font-bold text-gray-900">Глобальный поиск</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Ищи проекты, задачи, файлы, аукционы, экспертов и уведомления в одном месте.
          </p>
        </div>

        <button
          onClick={() => loadSearchData(true)}
          disabled={refreshing}
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
        >
          {refreshing ? 'Обновляем...' : 'Обновить'}
        </button>
      </div>

      {errorText && (
        <div className="mb-6 whitespace-pre-line rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          {errorText}
        </div>
      )}

      <Section>
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Поиск</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Например: ортез, CAD, дедлайн, аукцион, Иван..."
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Тип результата</label>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="all">Все типы</option>
              <option value="project">Проекты</option>
              <option value="task">Задачи</option>
              <option value="file">Файлы</option>
              <option value="auction">Аукционы</option>
              <option value="expert">Эксперты</option>
              <option value="notification">Уведомления</option>
            </select>
          </div>
        </div>
      </Section>

      <div className="my-6 grid gap-4 md:grid-cols-3 lg:grid-cols-7">
        <StatCard label="Все" value={countsByType.all} active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
        <StatCard label="Проекты" value={countsByType.project} active={typeFilter === 'project'} onClick={() => setTypeFilter('project')} />
        <StatCard label="Задачи" value={countsByType.task} active={typeFilter === 'task'} onClick={() => setTypeFilter('task')} />
        <StatCard label="Файлы" value={countsByType.file} active={typeFilter === 'file'} onClick={() => setTypeFilter('file')} />
        <StatCard label="Аукционы" value={countsByType.auction} active={typeFilter === 'auction'} onClick={() => setTypeFilter('auction')} />
        <StatCard label="Эксперты" value={countsByType.expert} active={typeFilter === 'expert'} onClick={() => setTypeFilter('expert')} />
        <StatCard label="Уведомления" value={countsByType.notification} active={typeFilter === 'notification'} onClick={() => setTypeFilter('notification')} />
      </div>

      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-sm text-gray-500">
          Найдено: <b>{filteredResults.length}</b>
        </div>

        {(query || typeFilter !== 'all') && (
          <button
            onClick={() => {
              setQuery('')
              setTypeFilter('all')
            }}
            className="text-sm text-blue-700 hover:underline"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      {filteredResults.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center text-gray-500 shadow-sm">
          Ничего не найдено. Попробуй другой запрос или сбрось фильтры.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredResults.map((result) => (
            <ResultCard key={result.id} result={result} onOpenFile={onOpenFile} openingFileId={openingFileId} />
          ))}
        </div>
      )}
    </main>
  )
}