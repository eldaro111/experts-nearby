'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  logAppError,
  showAppMessage,
} from '@/lib/appFeedback'

interface NotificationItem {
  id: string
  recipient_id: string
  actor_id: string | null
  project_id: string | null
  type: string
  title: string
  body: string | null
  href: string | null
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

function formatDate(value: string) {
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

function getPopupMessage(notification: NotificationItem) {
  const title = notification.title.trim()
  const body = notification.body?.trim()

  if (title && body) return `${title}: ${body}`
  return title || body || 'Новое уведомление'
}

export function NotificationBell() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  const unreadCount = notifications.filter((notification) => !notification.read_at).length

  const loadNotifications = async (uid: string) => {
    setLoading(true)

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', uid)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      logAppError('Ошибка загрузки уведомлений:', error)
      setNotifications([])
    } else {
      setNotifications((data || []) as NotificationItem[])
    }

    setLoading(false)
  }

  useEffect(() => {
    let active = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    const init = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (!active) return

      if (error) {
        logAppError('Ошибка получения пользователя для уведомлений:', error)
      }

      if (!user) {
        setUserId(null)
        setNotifications([])
        return
      }

      setUserId(user.id)
      await loadNotifications(user.id)

      if (!active) return

      channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_id=eq.${user.id}`,
          },
          (payload) => {
            const notification = payload.new as NotificationItem

            if (!notification?.id || notification.recipient_id !== user.id) {
              return
            }

            setNotifications((current) => {
              const withoutDuplicate = current.filter(
                (item) => item.id !== notification.id
              )

              return [notification, ...withoutDuplicate].slice(0, 20)
            })

            showAppMessage(
              getPopupMessage(notification),
              'info',
              8000
            )
          }
        )
        .subscribe((status, subscriptionError) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            logAppError(
              'Ошибка Realtime-подписки на уведомления:',
              subscriptionError ?? status
            )
          }
        })
    }

    void init()

    return () => {
      active = false

      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [])

  const markAsRead = async (notificationId: string) => {
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('id', notificationId)

    if (error) {
      logAppError('Ошибка отметки уведомления:', error)
      return
    }

    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, read_at: now }
          : notification
      )
    )
  }

  const markAllAsRead = async () => {
    if (!userId) return

    const now = new Date().toISOString()

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('recipient_id', userId)
      .is('read_at', null)

    if (error) {
      logAppError('Ошибка отметки всех уведомлений:', error)
      return
    }

    setNotifications((current) =>
      current.map((notification) =>
        notification.read_at
          ? notification
          : { ...notification, read_at: now }
      )
    )
  }

  const handleClickNotification = async (notification: NotificationItem) => {
    if (!notification.read_at) {
      await markAsRead(notification.id)
    }

    setOpen(false)

    if (notification.href) {
      router.push(notification.href)
    }
  }

  if (!userId) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={async () => {
          const nextOpen = !open
          setOpen(nextOpen)

          if (nextOpen && userId) {
            await loadNotifications(userId)
          }
        }}
        className="relative rounded-full border bg-white px-3 py-2 text-sm transition hover:bg-gray-50"
        aria-label="Уведомления"
      >
        🔔

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[380px] max-w-[90vw] overflow-hidden rounded-xl border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
            <div>
              <div className="font-semibold">Уведомления</div>
              <div className="text-xs text-gray-500">
                Непрочитанных: {unreadCount}
              </div>
            </div>

            <button
              type="button"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
            >
              Прочитать все
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-500">Загружаем...</div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">
                Пока уведомлений нет.
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((notification) => {
                  const unread = !notification.read_at

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleClickNotification(notification)}
                      className={`block w-full px-4 py-3 text-left transition hover:bg-gray-50 ${
                        unread ? 'bg-blue-50/60' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="pt-1">
                          <span
                            className={`block h-2 w-2 rounded-full ${
                              unread ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900">
                            {notification.title}
                          </div>

                          {notification.body && (
                            <div className="mt-1 line-clamp-2 text-sm text-gray-600">
                              {notification.body}
                            </div>
                          )}

                          <div className="mt-1 text-xs text-gray-400">
                            {formatDate(notification.created_at)}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t bg-gray-50 px-4 py-3">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block w-full rounded-lg border bg-white px-3 py-2 text-center text-sm font-medium text-blue-700 transition hover:bg-blue-50"
            >
              Открыть центр уведомлений
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
