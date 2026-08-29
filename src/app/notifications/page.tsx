'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getAppErrorMessage, logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'

type NotificationItem = {
  id: string
  recipient_id: string
  actor_id: string | null
  project_id: string | null
  type: string
  title: string
  body: string | null
  href: string | null
  payload: Record<string, any> | null
  read_at: string | null
  created_at: string
}

type FilterMode = 'all' | 'unread' | 'read'

function formatDate(value?: string | null) {
  if (!value) return 'Без даты'

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatDay(value?: string | null) {
  if (!value) return 'Без даты'

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    // Приглашения / отклики / участники — новые и старые имена типов
    project_invite: 'Приглашение',
    project_invitation: 'Приглашение',
    invite_created: 'Приглашение',

    project_application: 'Отклик на проект',
    application_created: 'Отклик на проект',
    application_accepted: 'Отклик принят',
    application_rejected: 'Отклик отклонён',

    participant_left: 'Участник вышел',
    project_member_left: 'Участник вышел',
    participant_removed: 'Участник удалён',
    project_member_removed: 'Участник удалён',
    project_member_added: 'Участник добавлен',

    // Задачи
    task_created: 'Задача создана',
    task_updated: 'Задача обновлена',
    task_status_changed: 'Статус задачи',
    task_assignee_changed: 'Исполнитель задачи',
    task_deadline_changed: 'Дедлайн задачи',
    task_completed: 'Задача завершена',
    task_excuse_created: 'Причина просрочки',
    task_excuse_approved: 'Причина принята',
    task_excuse_rejected: 'Причина отклонена',

    // Файлы / вклад / отзывы
    file_uploaded: 'Файл',
    project_file_uploaded: 'Файл',
    contribution_created: 'Вклад добавлен',
    contribution_approved: 'Вклад подтверждён',
    profile_review_created: 'Отзыв',

    // Аукционы
    auction_new_bid: 'Новое предложение',
    auction_bid_accepted: 'Предложение принято',
    auction_bid_rejected: 'Предложение отклонено',
    auction_access_requested: 'Запрос доступа',
    auction_access_approved: 'Доступ одобрен',
    auction_access_rejected: 'Доступ отклонён',
  }

  return labels[type] || type.replaceAll('_', ' ')
}

function typeBadgeClass(type: string) {
  if (type.includes('auction')) return 'bg-purple-50 text-purple-700 border-purple-200'
  if (type.includes('task')) return 'bg-blue-50 text-blue-700 border-blue-200'
  if (type.includes('file')) return 'bg-orange-50 text-orange-700 border-orange-200'
  if (type.includes('review')) return 'bg-pink-50 text-pink-700 border-pink-200'
  if (type.includes('accepted') || type.includes('approved')) return 'bg-green-50 text-green-700 border-green-200'
  if (type.includes('rejected') || type.includes('removed')) return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

export default function NotificationsPage() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const loadNotifications = async (silent = false) => {
    if (silent) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setError(null)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError) {
      logAppError('Ошибка авторизации в центре уведомлений', userError)
      setError(getAppErrorMessage(userError, 'Не удалось проверить авторизацию.'))
    }

    if (!user) {
      setLoading(false)
      setRefreshing(false)
      router.replace('/auth')
      return
    }

    setUserId(user.id)

    const { data, error: notificationsError } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)

    if (notificationsError) {
      logAppError('Ошибка загрузки уведомлений', notificationsError)
      setError(getAppErrorMessage(notificationsError, 'Не удалось загрузить уведомления.'))
      setNotifications([])
    } else {
      setNotifications((data || []) as NotificationItem[])
    }

    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    loadNotifications()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unreadCount = notifications.filter((item) => !item.read_at).length
  const readCount = notifications.length - unreadCount

  const notificationTypes = useMemo(() => {
    return Array.from(new Set(notifications.map((item) => item.type).filter(Boolean))).sort((a, b) =>
      typeLabel(a).localeCompare(typeLabel(b), 'ru')
    )
  }, [notifications])

  const filteredNotifications = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return notifications.filter((item) => {
      const matchesMode =
        filterMode === 'all'
          ? true
          : filterMode === 'unread'
            ? !item.read_at
            : Boolean(item.read_at)

      const matchesType = typeFilter === 'all' || item.type === typeFilter

      const haystack = [
        item.title,
        item.body || '',
        item.type,
        typeLabel(item.type),
        item.href || '',
      ]
        .join(' ')
        .toLowerCase()

      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery)

      return matchesMode && matchesType && matchesQuery
    })
  }, [notifications, filterMode, query, typeFilter])

  const groupedNotifications = useMemo(() => {
    const groups: Array<{ day: string; items: NotificationItem[] }> = []

    for (const item of filteredNotifications) {
      const day = formatDay(item.created_at)
      const lastGroup = groups[groups.length - 1]

      if (lastGroup?.day === day) {
        lastGroup.items.push(item)
      } else {
        groups.push({ day, items: [item] })
      }
    }

    return groups
  }, [filteredNotifications])

  const markAsRead = async (notificationId: string) => {
    if (pendingNotificationId || markingAll) return false

    const now = new Date().toISOString()
    setPendingNotificationId(notificationId)

    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          read_at: now,
        })
        .eq('id', notificationId)

      if (error) {
        showAppError(
          error,
          'Не удалось пометить уведомление прочитанным.',
          'Ошибка изменения уведомления'
        )
        return false
      }

      setNotifications((prev) =>
        prev.map((item) => (item.id === notificationId ? { ...item, read_at: now } : item))
      )
      return true
    } catch (error) {
      showAppError(
        error,
        'Не удалось пометить уведомление прочитанным.',
        'Ошибка изменения уведомления'
      )
      return false
    } finally {
      setPendingNotificationId(null)
    }
  }

  const markAsUnread = async (notificationId: string) => {
    if (pendingNotificationId || markingAll) return

    setPendingNotificationId(notificationId)

    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          read_at: null,
        })
        .eq('id', notificationId)

      if (error) {
        showAppError(
          error,
          'Не удалось вернуть уведомление в непрочитанные.',
          'Ошибка изменения уведомления'
        )
        return
      }

      setNotifications((prev) =>
        prev.map((item) => (item.id === notificationId ? { ...item, read_at: null } : item))
      )
    } catch (error) {
      showAppError(
        error,
        'Не удалось вернуть уведомление в непрочитанные.',
        'Ошибка изменения уведомления'
      )
    } finally {
      setPendingNotificationId(null)
    }
  }

  const markAllAsRead = async () => {
    if (!userId || unreadCount === 0 || markingAll || pendingNotificationId) return

    const now = new Date().toISOString()
    setMarkingAll(true)

    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          read_at: now,
        })
        .eq('recipient_id', userId)
        .is('read_at', null)

      if (error) {
        showAppError(
          error,
          'Не удалось прочитать все уведомления.',
          'Ошибка изменения уведомлений'
        )
        return
      }

      setNotifications((prev) =>
        prev.map((item) => (item.read_at ? item : { ...item, read_at: now }))
      )
      showAppMessage('Все уведомления отмечены прочитанными.', 'success')
    } catch (error) {
      showAppError(
        error,
        'Не удалось прочитать все уведомления.',
        'Ошибка изменения уведомлений'
      )
    } finally {
      setMarkingAll(false)
    }
  }

  const openNotification = async (notification: NotificationItem) => {
    if (!notification.read_at) {
      const marked = await markAsRead(notification.id)
      if (!marked) return
    }

    if (notification.href) {
      router.push(notification.href)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-xl border bg-white p-8 text-center text-gray-600 shadow-sm">
          Загружаю уведомления...
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-blue-700">Рабочий центр</p>
          <h1 className="text-3xl font-bold text-gray-900">Центр уведомлений</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Все события по проектам, задачам, аукционам, файлам, отзывам и приглашениям в одном месте.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/settings#notifications"
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            Настроить уведомления
          </Link>

          <button
            type="button"
            onClick={markAllAsRead}
            disabled={unreadCount === 0 || markingAll || Boolean(pendingNotificationId)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:bg-gray-300"
          >
            Прочитать всё
          </button>

          <button
            type="button"
            onClick={() => loadNotifications(true)}
            disabled={refreshing}
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
          >
            {refreshing ? 'Обновляем...' : 'Обновить'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() => setFilterMode('all')}
          className={`rounded-xl border p-4 text-left shadow-sm transition ${
            filterMode === 'all' ? 'border-blue-300 bg-blue-50' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl font-bold text-gray-900">{notifications.length}</div>
          <div className="text-sm text-gray-500">всего уведомлений</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode('unread')}
          className={`rounded-xl border p-4 text-left shadow-sm transition ${
            filterMode === 'unread' ? 'border-blue-300 bg-blue-50' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl font-bold text-gray-900">{unreadCount}</div>
          <div className="text-sm text-gray-500">непрочитанных</div>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode('read')}
          className={`rounded-xl border p-4 text-left shadow-sm transition ${
            filterMode === 'read' ? 'border-blue-300 bg-blue-50' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl font-bold text-gray-900">{readCount}</div>
          <div className="text-sm text-gray-500">прочитанных</div>
        </button>
      </div>

      <section className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr]">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Поиск</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Заголовок, текст, тип уведомления..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Тип события</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="all">Все типы</option>
              {notificationTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setTypeFilter('all')
                setFilterMode('all')
              }}
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Сбросить фильтры
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Уведомления</h2>
          <p className="mt-1 text-sm text-gray-500">
            Показано: {filteredNotifications.length} из {notifications.length}
          </p>
        </div>

        {groupedNotifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            По выбранным фильтрам уведомлений нет.
          </div>
        ) : (
          <div className="divide-y">
            {groupedNotifications.map((group) => (
              <div key={group.day}>
                <div className="bg-gray-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {group.day}
                </div>

                <div className="divide-y">
                  {group.items.map((notification) => {
                    const unread = !notification.read_at

                    return (
                      <article
                        key={notification.id}
                        className={`p-5 transition ${
                          unread ? 'bg-blue-50/60' : 'bg-white'
                        }`}
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${typeBadgeClass(
                                  notification.type
                                )}`}
                              >
                                {typeLabel(notification.type)}
                              </span>

                              {unread ? (
                                <span className="inline-flex rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
                                  новое
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                                  прочитано
                                </span>
                              )}
                            </div>

                            <h3 className="font-semibold text-gray-900">{notification.title}</h3>

                            {notification.body && (
                              <p className="mt-1 text-sm text-gray-600">{notification.body}</p>
                            )}

                            <div className="mt-2 text-xs text-gray-400">
                              {formatDate(notification.created_at)}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            {notification.href && (
                              <button
                                type="button"
                                onClick={() => openNotification(notification)}
                                disabled={pendingNotificationId === notification.id || markingAll}
                                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {pendingNotificationId === notification.id ? 'Открываем...' : 'Открыть'}
                              </button>
                            )}

                            {unread ? (
                              <button
                                type="button"
                                onClick={() => markAsRead(notification.id)}
                                disabled={pendingNotificationId === notification.id || markingAll}
                                className="rounded-lg border bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {pendingNotificationId === notification.id ? 'Сохраняем...' : 'Прочитано'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => markAsUnread(notification.id)}
                                disabled={pendingNotificationId === notification.id || markingAll}
                                className="rounded-lg border bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {pendingNotificationId === notification.id ? 'Сохраняем...' : 'В непрочитанные'}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}