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
  created_by?: string | null
  created_at?: string | null
  deadline_at?: string | null
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
  completed_at?: string | null
  created_at?: string | null
}

type Auction = {
  id: string
  title: string
  type: 'request' | 'offer' | string
  status: 'draft' | 'open' | 'closed' | 'cancelled' | string
  ends_at: string | null
  created_at: string | null
}

type AuctionBid = {
  id: string
  auction_id: string
  amount: number | null
  currency: string | null
  status: 'new' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn' | string
  created_at: string | null
}

type NotificationItem = {
  id: string
  title: string
  body: string | null
  href: string | null
  read_at: string | null
  created_at: string | null
}

type ActivityItem = {
  id: string
  project_id: string
  actor_id: string | null
  type: string
  title: string
  body: string | null
  entity_type: string | null
  entity_id: string | null
  created_at: string | null
}

type DashboardData = {
  ownerProjects: Listing[]
  memberProjects: Listing[]
  tasks: Task[]
  auctions: Auction[]
  bids: AuctionBid[]
  bidAuctions: Record<string, Auction>
  notifications: NotificationItem[]
  activity: ActivityItem[]
  projectsById: Record<string, Listing>
}

const emptyDashboard: DashboardData = {
  ownerProjects: [],
  memberProjects: [],
  tasks: [],
  auctions: [],
  bids: [],
  bidAuctions: {},
  notifications: [],
  activity: [],
  projectsById: {},
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function formatDate(value?: string | null) {
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

function formatMoney(amount: number | null, currency: string | null) {
  if (amount === null || amount === undefined) return 'Без суммы'
  return `${amount.toLocaleString('ru-RU')} ${currency || 'RUB'}`
}

function taskStatusLabel(status: string) {
  if (status === 'todo') return 'К выполнению'
  if (status === 'doing') return 'В работе'
  if (status === 'done') return 'Готово'
  return status
}

function auctionTypeLabel(type: string) {
  if (type === 'request') return 'Заказ'
  if (type === 'offer') return 'Проект для внедрения'
  return type
}

function statusBadgeClass(status: string) {
  if (status === 'open' || status === 'new' || status === 'doing') {
    return 'bg-blue-50 text-blue-700 border-blue-200'
  }

  if (status === 'accepted' || status === 'done' || status === 'closed') {
    return 'bg-green-50 text-green-700 border-green-200'
  }

  if (status === 'rejected' || status === 'cancelled' || status === 'withdrawn') {
    return 'bg-red-50 text-red-700 border-red-200'
  }

  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function CompactStatus({ children, status }: { children: React.ReactNode; status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(status)}`}>
      {children}
    </span>
  )
}

function Card({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
      {children}
    </div>
  )
}

function auctionStatusLabel(status: string) {
  if (status === 'draft') return 'Черновик'
  if (status === 'open') return 'Открыт'
  if (status === 'closed') return 'Закрыт'
  if (status === 'cancelled') return 'Отменён'
  return status
}

function bidStatusLabel(status: string) {
  if (status === 'new') return 'Новое'
  if (status === 'shortlisted') return 'В шорт-листе'
  if (status === 'accepted') return 'Принято'
  if (status === 'rejected') return 'Отклонено'
  if (status === 'withdrawn') return 'Отозвано'
  return status
}

function isPast(value?: string | null) {
  if (!value) return false
  return new Date(value).getTime() < Date.now()
}

function MetricLink({
  href,
  value,
  label,
  tone = 'slate',
}: {
  href: string
  value: number
  label: string
  tone?: 'slate' | 'blue' | 'orange' | 'red'
}) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-950',
    blue: 'border-blue-200 bg-blue-50 text-blue-950',
    orange: 'border-orange-200 bg-orange-50 text-orange-950',
    red: 'border-red-200 bg-red-50 text-red-950',
  }

  return (
    <Link href={href} className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 text-sm opacity-70">{label}</div>
    </Link>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [errors, setErrors] = useState<string[]>([])

  const loadDashboard = async (silent = false) => {
    if (silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    const nextErrors: string[] = []

    const addLoadError = (label: string, error: unknown) => {
      logAppError(label, error)
      nextErrors.push(
        `${label}: ${getAppErrorMessage(error, 'Не удалось загрузить данные.')}`
      )
    }

    const { data: userData, error: userError } = await supabase.auth.getUser()

    if (userError) {
      addLoadError('Авторизация', userError)
    }

    const currentUser = userData?.user

    if (!currentUser) {
      setLoading(false)
      setRefreshing(false)
      router.replace('/auth')
      return
    }

    setUserId(currentUser.id)

    const [ownerProjectsRes, applicationsRes, tasksRes, auctionsRes, bidsRes, notificationsRes] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title,description,created_by,created_at,deadline_at')
        .eq('created_by', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(8),

      supabase
        .from('applications')
        .select('id,listing_id,status,user_id,created_at')
        .eq('user_id', currentUser.id)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('tasks')
        .select('id,project_id,title,description,status,assignee_id,start_at,due_at,completed_at,created_at')
        .eq('assignee_id', currentUser.id)
        .neq('status', 'done')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(10),

      supabase
        .from('auctions')
        .select('id,title,type,status,ends_at,created_at')
        .eq('owner_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(6),

      supabase
        .from('auction_bids')
        .select('id,auction_id,amount,currency,status,created_at')
        .eq('bidder_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(6),

      supabase
        .from('notifications')
        .select('id,title,body,href,read_at,created_at')
        .eq('recipient_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    if (ownerProjectsRes.error) addLoadError('Мои проекты', ownerProjectsRes.error)
    if (applicationsRes.error) addLoadError('Участие в проектах', applicationsRes.error)
    if (tasksRes.error) addLoadError('Задачи', tasksRes.error)
    if (auctionsRes.error) addLoadError('Аукционы', auctionsRes.error)
    if (bidsRes.error) addLoadError('Предложения', bidsRes.error)
    if (notificationsRes.error) addLoadError('Уведомления', notificationsRes.error)

    const ownerProjects = (ownerProjectsRes.data || []) as Listing[]
    const acceptedApplications = (applicationsRes.data || []) as Array<{ listing_id: string }>
    const tasks = (tasksRes.data || []) as Task[]
    const auctions = (auctionsRes.data || []) as Auction[]
    const bids = (bidsRes.data || []) as AuctionBid[]
    const notifications = (notificationsRes.data || []) as NotificationItem[]

    const memberProjectIds = unique(acceptedApplications.map((item) => item.listing_id))
    const bidAuctionIds = unique(bids.map((bid) => bid.auction_id))

    const memberProjectsRes = memberProjectIds.length
      ? await supabase
          .from('listings')
          .select('id,title,description,created_by,created_at,deadline_at')
          .in('id', memberProjectIds)
      : { data: [], error: null }

    if (memberProjectsRes.error) addLoadError('Проекты-участия', memberProjectsRes.error)

    const memberProjects = ((memberProjectsRes.data || []) as Listing[]).filter(
      (project) => project.created_by !== currentUser.id
    )

    const projectIds = unique([
      ...ownerProjects.map((project) => project.id),
      ...memberProjects.map((project) => project.id),
      ...tasks.map((task) => task.project_id),
    ])

    const projectsForLookupRes = projectIds.length
      ? await supabase
          .from('listings')
          .select('id,title,description,created_by,created_at,deadline_at')
          .in('id', projectIds)
      : { data: [], error: null }

    if (projectsForLookupRes.error) addLoadError('Названия проектов', projectsForLookupRes.error)

    const projectsForLookup = (projectsForLookupRes.data || []) as Listing[]
    const projectsById = Object.fromEntries(projectsForLookup.map((project) => [project.id, project]))

    const bidAuctionsRes = bidAuctionIds.length
      ? await supabase
          .from('auctions')
          .select('id,title,type,status,ends_at,created_at')
          .in('id', bidAuctionIds)
      : { data: [], error: null }

    if (bidAuctionsRes.error) addLoadError('Аукционы по предложениям', bidAuctionsRes.error)

    const bidAuctions = Object.fromEntries(
      ((bidAuctionsRes.data || []) as Auction[]).map((auction) => [auction.id, auction])
    )

    const activityRes = projectIds.length
      ? await supabase
          .from('project_activity')
          .select('id,project_id,actor_id,type,title,body,entity_type,entity_id,created_at')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })
          .limit(8)
      : { data: [], error: null }

    if (activityRes.error) addLoadError('История действий', activityRes.error)

    setDashboard({
      ownerProjects,
      memberProjects,
      tasks,
      auctions,
      bids,
      bidAuctions,
      notifications,
      activity: (activityRes.data || []) as ActivityItem[],
      projectsById,
    })

    setErrors(nextErrors)
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unreadNotifications = dashboard.notifications.filter((item) => !item.read_at)
  const now = Date.now()
  const weekFromNow = now + 7 * 24 * 60 * 60 * 1000
  const overdueTasks = dashboard.tasks.filter(
    (task) => task.due_at && new Date(task.due_at).getTime() < now && task.status !== 'done'
  )
  const dueSoonTasks = dashboard.tasks.filter((task) => {
    if (!task.due_at || task.status === 'done') return false
    const due = new Date(task.due_at).getTime()
    return due >= now && due <= weekFromNow
  })
  const openAuctions = dashboard.auctions.filter((auction) => auction.status === 'open')

  const upcomingDeadlines = useMemo(() => {
    const fromTasks = dashboard.tasks
      .filter((task) => task.due_at)
      .map((task) => ({
        id: `task-${task.id}`,
        title: task.title,
        subtitle: dashboard.projectsById[task.project_id]?.title || 'Проект',
        date: task.due_at,
        href: `/projects/${task.project_id}`,
        type: 'Задача',
      }))

    const allProjects = [...dashboard.ownerProjects, ...dashboard.memberProjects]
    const fromProjects = allProjects
      .filter((project) => project.deadline_at)
      .map((project) => ({
        id: `project-${project.id}`,
        title: project.title,
        subtitle: 'Дедлайн проекта',
        date: project.deadline_at,
        href: `/projects/${project.id}`,
        type: 'Проект',
      }))

    const fromAuctions = dashboard.auctions
      .filter((auction) => auction.ends_at && auction.status === 'open')
      .map((auction) => ({
        id: `auction-${auction.id}`,
        title: auction.title,
        subtitle: auctionTypeLabel(auction.type),
        date: auction.ends_at,
        href: `/auctions/${auction.id}`,
        type: 'Аукцион',
      }))

    return [...fromTasks, ...fromProjects, ...fromAuctions]
      .sort((a, b) => new Date(a.date || '').getTime() - new Date(b.date || '').getTime())
      .slice(0, 6)
  }, [dashboard])

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="rounded-2xl border bg-white p-10 text-center text-slate-600 shadow-sm">
          Загружаю рабочий центр...
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <section className="overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 shadow-sm">
        <div className="flex flex-col gap-7 px-6 py-8 md:px-9 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Личный рабочий центр</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">Что требует внимания сегодня</h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-600">
              Проекты, задачи, сроки, аукционы и последние события собраны в одном месте.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/listings/new" className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">
              Создать проект
            </Link>
            <Link href="/auctions/new" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-blue-50">
              Создать аукцион
            </Link>
            <button
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {refreshing ? 'Обновляем...' : 'Обновить'}
            </button>
          </div>
        </div>
      </section>

      {errors.length > 0 && (
        <div className="mt-6 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <div className="mb-2 font-semibold">Часть данных не загрузилась</div>
          <ul className="list-disc space-y-1 pl-5">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricLink href="/tasks" value={overdueTasks.length} label="просроченных задач" tone={overdueTasks.length ? 'red' : 'slate'} />
        <MetricLink href="/calendar" value={dueSoonTasks.length} label="задач на ближайшие 7 дней" tone={dueSoonTasks.length ? 'orange' : 'slate'} />
        <MetricLink href="/notifications" value={unreadNotifications.length} label="новых уведомлений" tone={unreadNotifications.length ? 'blue' : 'slate'} />
        <MetricLink href="/auctions/my" value={openAuctions.length} label="открытых аукционов" tone={openAuctions.length ? 'blue' : 'slate'} />
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['/search', 'Глобальный поиск', 'Проекты, файлы, задачи и эксперты'],
          ['/tasks', 'Мои задачи', 'Работа и просроченные сроки'],
          ['/calendar', 'Календарь', 'Все события и дедлайны'],
          ['/files', 'Материалы', 'Файлы из доступных проектов'],
        ].map(([href, title, text]) => (
          <Link key={href} href={href} className="rounded-2xl border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40">
            <div className="font-semibold text-slate-950">{title}</div>
            <div className="mt-1 text-sm text-slate-500">{text}</div>
          </Link>
        ))}
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <Card title="Активные задачи" action={<Link href="/tasks" className="text-sm font-semibold text-blue-700 hover:underline">Все задачи</Link>}>
            {dashboard.tasks.length === 0 ? (
              <EmptyState>Активных задач на тебя сейчас нет.</EmptyState>
            ) : (
              <div className="divide-y rounded-xl border">
                {dashboard.tasks.slice(0, 7).map((task) => {
                  const overdue = isPast(task.due_at) && task.status !== 'done'
                  return (
                    <Link key={task.id} href={`/projects/${task.project_id}`} className="flex flex-col gap-3 p-4 transition hover:bg-blue-50/40 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-950">{task.title}</div>
                        <div className="mt-1 text-sm text-slate-500">{dashboard.projectsById[task.project_id]?.title || 'Проект'}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className={`text-sm ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
                          {overdue ? 'Просрочено: ' : ''}{formatShortDate(task.due_at)}
                        </span>
                        <CompactStatus status={task.status}>{taskStatusLabel(task.status)}</CompactStatus>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>

          <Card
            title="Мои проекты"
            action={<div className="flex gap-3"><Link href="/listings" className="text-sm font-semibold text-blue-700 hover:underline">Все проекты</Link><Link href="/listings/new" className="text-sm font-semibold text-blue-700 hover:underline">Создать</Link></div>}
          >
            {dashboard.ownerProjects.length === 0 && dashboard.memberProjects.length === 0 ? (
              <EmptyState>Пока нет проектов. Создай свой или присоединись к существующему.</EmptyState>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {[...dashboard.ownerProjects, ...dashboard.memberProjects].slice(0, 6).map((project) => {
                  const isOwner = project.created_by === userId
                  const overdue = isPast(project.deadline_at)
                  return (
                    <Link key={project.id} href={`/projects/${project.id}`} className="rounded-xl border p-4 transition hover:border-blue-300 hover:bg-blue-50/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-semibold text-slate-950">{project.title}</div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{isOwner ? 'Автор' : 'Участник'}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{project.description || 'Без описания'}</p>
                      <div className={`mt-3 text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
                        {overdue ? 'Дедлайн прошёл: ' : 'Дедлайн: '}{formatShortDate(project.deadline_at)}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="Последняя активность" action={<span className="text-xs text-slate-400">в доступных проектах</span>}>
            {dashboard.activity.length === 0 ? (
              <EmptyState>История пока пустая. Действия участников появятся здесь.</EmptyState>
            ) : (
              <div className="space-y-2">
                {dashboard.activity.map((item) => (
                  <Link key={item.id} href={`/projects/${item.project_id}`} className="block rounded-xl border px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50/40">
                    <div className="font-medium text-slate-950">{item.title}</div>
                    {item.body && <div className="mt-1 text-sm text-slate-500">{item.body}</div>}
                    <div className="mt-2 text-xs text-slate-400">{dashboard.projectsById[item.project_id]?.title || 'Проект'} · {formatDate(item.created_at)}</div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="Ближайшее" action={<Link href="/calendar" className="text-sm font-semibold text-blue-700 hover:underline">Календарь</Link>}>
            {upcomingDeadlines.length === 0 ? (
              <EmptyState>Ближайших сроков пока нет.</EmptyState>
            ) : (
              <div className="space-y-2">
                {upcomingDeadlines.map((item) => {
                  const overdue = isPast(item.date)
                  return (
                    <Link key={item.id} href={item.href} className="block rounded-xl border p-3 transition hover:border-blue-300 hover:bg-blue-50/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-950">{item.title}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.subtitle}</div>
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{item.type}</span>
                      </div>
                      <div className={`mt-2 text-sm ${overdue ? 'font-semibold text-red-700' : 'text-slate-700'}`}>{formatDate(item.date)}</div>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="Уведомления" action={<Link href="/notifications" className="text-sm font-semibold text-blue-700 hover:underline">Все</Link>}>
            {dashboard.notifications.length === 0 ? (
              <EmptyState>Уведомлений пока нет.</EmptyState>
            ) : (
              <div className="space-y-2">
                {dashboard.notifications.slice(0, 5).map((item) => (
                  <Link key={item.id} href={item.href || '/dashboard'} className={`block rounded-xl border p-3 transition hover:border-blue-300 ${item.read_at ? 'bg-white' : 'border-blue-200 bg-blue-50/70'}`}>
                    <div className="text-sm font-semibold text-slate-950">{item.title}</div>
                    {item.body && <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</div>}
                    <div className="mt-2 text-xs text-slate-400">{formatDate(item.created_at)}</div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Мои аукционы" action={<Link href="/auctions/my" className="text-sm font-semibold text-blue-700 hover:underline">Все мои</Link>}>
            {dashboard.auctions.length === 0 ? (
              <EmptyState>Ты пока не создавал аукционы.</EmptyState>
            ) : (
              <div className="space-y-2">
                {dashboard.auctions.slice(0, 4).map((auction) => (
                  <Link key={auction.id} href={`/auctions/${auction.id}`} className="block rounded-xl border p-3 transition hover:border-blue-300 hover:bg-blue-50/40">
                    <div className="font-medium text-slate-950">{auction.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">{auctionTypeLabel(auction.type)}</span>
                      <CompactStatus status={auction.status}>{auctionStatusLabel(auction.status)}</CompactStatus>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Мои предложения" action={<Link href="/auctions/my" className="text-sm font-semibold text-blue-700 hover:underline">Все</Link>}>
            {dashboard.bids.length === 0 ? (
              <EmptyState>Ты пока не подавал предложения.</EmptyState>
            ) : (
              <div className="space-y-2">
                {dashboard.bids.slice(0, 4).map((bid) => {
                  const auction = dashboard.bidAuctions[bid.auction_id]
                  return (
                    <Link key={bid.id} href={`/auctions/${bid.auction_id}`} className="block rounded-xl border p-3 transition hover:border-blue-300 hover:bg-blue-50/40">
                      <div className="font-medium text-slate-950">{auction?.title || 'Аукцион'}</div>
                      <div className="mt-1 text-sm text-slate-500">{formatMoney(bid.amount, bid.currency)}</div>
                      <div className="mt-2"><CompactStatus status={bid.status}>{bidStatusLabel(bid.status)}</CompactStatus></div>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </main>
  )

}