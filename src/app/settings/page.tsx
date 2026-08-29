'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getAppErrorMessage, logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'

type NotificationKey = 'projects' | 'tasks' | 'files' | 'auctions' | 'reviews' | 'invitations'
type Visibility = 'public' | 'platform_only' | 'hidden'

interface NotificationPrefs {
  projects: boolean
  tasks: boolean
  files: boolean
  auctions: boolean
  reviews: boolean
  invitations: boolean
}

interface Profile {
  user_id: string
  display_name: string | null
  roles: unknown
  skills: unknown
  timezone: string | null
  availability_hours: number | string | null
  city: string | null
  work_format: string | null
  experience_level: string | null
  hourly_rate: number | string | null
  portfolio_links: unknown
  about: string | null
  visibility: Visibility
  show_rate: boolean
  show_city: boolean
  show_portfolio: boolean
  show_availability: boolean
}

interface UserSettingsRow {
  user_id: string
  notification_prefs: Partial<NotificationPrefs> | null
  email_prefs: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

const defaultNotificationPrefs: NotificationPrefs = {
  projects: true,
  tasks: true,
  files: true,
  auctions: true,
  reviews: true,
  invitations: true,
}

const notificationMeta: Array<{ key: NotificationKey; title: string; description: string }> = [
  { key: 'projects', title: 'Проекты', description: 'Отклики, участники, изменения в проектах.' },
  { key: 'tasks', title: 'Задачи', description: 'Новые задачи, дедлайны, завершение и причины просрочки.' },
  { key: 'files', title: 'Файлы', description: 'Загрузка и изменение проектных материалов.' },
  { key: 'auctions', title: 'Аукционы', description: 'Ставки, принятие предложений и запросы доступа.' },
  { key: 'reviews', title: 'Отзывы', description: 'Новые отзывы и оценки в проектах.' },
  { key: 'invitations', title: 'Приглашения', description: 'Приглашения в проекты и связанные события.' },
]

const privacyMeta: Array<{ key: 'show_rate' | 'show_city' | 'show_portfolio' | 'show_availability'; title: string; description: string }> = [
  { key: 'show_rate', title: 'Показывать ставку', description: 'Ставка будет видна в каталоге и публичном профиле.' },
  { key: 'show_city', title: 'Показывать город', description: 'Город будет виден в карточке эксперта и профиле.' },
  { key: 'show_portfolio', title: 'Показывать портфолио', description: 'Ссылки портфолио будут доступны другим пользователям.' },
  { key: 'show_availability', title: 'Показывать доступность', description: 'Количество часов в неделю будет видно другим пользователям.' },
]

const toList = (value: unknown): string[] => {
  if (!value) return []
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return toList(JSON.parse(trimmed))
      } catch {
        return trimmed.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)
      }
    }
    return trimmed.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)
  }
  return [String(value).trim()].filter(Boolean)
}

const sanitizePrefs = (value: unknown): NotificationPrefs => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  return {
    projects: typeof record.projects === 'boolean' ? record.projects : defaultNotificationPrefs.projects,
    tasks: typeof record.tasks === 'boolean' ? record.tasks : defaultNotificationPrefs.tasks,
    files: typeof record.files === 'boolean' ? record.files : defaultNotificationPrefs.files,
    auctions: typeof record.auctions === 'boolean' ? record.auctions : defaultNotificationPrefs.auctions,
    reviews: typeof record.reviews === 'boolean' ? record.reviews : defaultNotificationPrefs.reviews,
    invitations: typeof record.invitations === 'boolean' ? record.invitations : defaultNotificationPrefs.invitations,
  }
}

const formatDate = (value?: string | null) => {
  if (!value) return 'неизвестно'
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

export default function SettingsPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<UserSettingsRow | null>(null)
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(defaultNotificationPrefs)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true)
      setError('')

      const { data: authData } = await supabase.auth.getUser()
      const currentUser = authData.user

      if (!currentUser) {
        router.replace('/auth')
        return
      }

      setUser(currentUser)

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, display_name, roles, skills, timezone, availability_hours, city, work_format, experience_level, hourly_rate, portfolio_links, about, visibility, show_rate, show_city, show_portfolio, show_availability')
        .eq('user_id', currentUser.id)
        .maybeSingle()

      if (profileError) {
        logAppError('Ошибка загрузки профиля', profileError)
        setError(getAppErrorMessage(profileError, 'Не удалось загрузить профиль.'))
      } else {
        setProfile((profileData || null) as Profile | null)
      }

      const { data: settingsData, error: settingsError } = await supabase
        .from('user_settings')
        .select('user_id, notification_prefs, email_prefs, created_at, updated_at')
        .eq('user_id', currentUser.id)
        .maybeSingle()

      if (settingsError) {
        logAppError('Ошибка загрузки настроек', settingsError)
        setError(getAppErrorMessage(settingsError, 'Не удалось загрузить настройки.'))
      }

      if (!settingsData) {
        const { data: upsertedSettings, error: upsertError } = await supabase
          .from('user_settings')
          .upsert(
            {
              user_id: currentUser.id,
              notification_prefs: defaultNotificationPrefs,
            },
            { onConflict: 'user_id' }
          )
          .select('user_id, notification_prefs, email_prefs, created_at, updated_at')
          .single()

        if (upsertError) {
          logAppError('Ошибка создания настроек', upsertError)
          setError(getAppErrorMessage(upsertError, 'Не удалось создать настройки.'))
        } else {
          setSettings(upsertedSettings as UserSettingsRow)
          setNotificationPrefs(sanitizePrefs(upsertedSettings.notification_prefs))
        }
      } else {
        setSettings(settingsData as UserSettingsRow)
        setNotificationPrefs(sanitizePrefs(settingsData.notification_prefs))
      }

      setLoading(false)
    }

    loadSettings()
  }, [router])

  const completeness = useMemo(() => {
    const checks = [
      { label: 'Имя', ok: Boolean(profile?.display_name?.trim()) },
      { label: 'Роли', ok: toList(profile?.roles).length > 0 },
      { label: 'Навыки', ok: toList(profile?.skills).length > 0 },
      { label: 'Город', ok: Boolean(profile?.city?.trim()) },
      { label: 'Формат работы', ok: Boolean(profile?.work_format) },
      { label: 'Уровень опыта', ok: Boolean(profile?.experience_level) },
      { label: 'Ставка', ok: Boolean(profile?.hourly_rate) },
      { label: 'Описание', ok: Boolean(profile?.about?.trim()) },
      { label: 'Портфолио', ok: toList(profile?.portfolio_links).length > 0 },
      { label: 'Доступность', ok: Boolean(profile?.availability_hours) },
    ]

    const done = checks.filter((item) => item.ok).length
    const percent = Math.round((done / checks.length) * 100)

    return {
      percent,
      missing: checks.filter((item) => !item.ok).map((item) => item.label),
    }
  }, [profile])

  const updateNotificationPref = async (key: NotificationKey, value: boolean) => {
    if (!user?.id || savingKey) return

    const previous = notificationPrefs
    const next = { ...notificationPrefs, [key]: value }

    setNotificationPrefs(next)
    setSavingKey(key)

    try {
      const { data, error: updateError } = await supabase
        .from('user_settings')
        .update({ notification_prefs: next })
        .eq('user_id', user.id)
        .select('user_id, notification_prefs, email_prefs, created_at, updated_at')
        .single()

      if (updateError) {
        setNotificationPrefs(previous)
        showAppError(
          updateError,
          'Не удалось сохранить настройки уведомлений.',
          'Ошибка сохранения настроек уведомлений'
        )
        return
      }

      setSettings(data as UserSettingsRow)
      showAppMessage('Настройки уведомлений сохранены.', 'success')
    } catch (error) {
      setNotificationPrefs(previous)
      showAppError(
        error,
        'Не удалось сохранить настройки уведомлений.',
        'Ошибка сохранения настроек уведомлений'
      )
    } finally {
      setSavingKey(null)
    }
  }

  const updateProfilePrivacy = async (patch: Partial<Pick<Profile, 'visibility' | 'show_rate' | 'show_city' | 'show_portfolio' | 'show_availability'>>) => {
    if (!user?.id || !profile || savingKey) return

    const previous = profile
    const next = { ...profile, ...patch }

    setProfile(next)
    setSavingKey(Object.keys(patch)[0] || 'privacy')

    try {
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update(patch)
        .eq('user_id', user.id)
        .select('user_id, display_name, roles, skills, timezone, availability_hours, city, work_format, experience_level, hourly_rate, portfolio_links, about, visibility, show_rate, show_city, show_portfolio, show_availability')
        .single()

      if (updateError) {
        setProfile(previous)
        showAppError(
          updateError,
          'Не удалось сохранить приватность.',
          'Ошибка сохранения приватности'
        )
        return
      }

      setProfile(data as Profile)
      showAppMessage('Настройки приватности сохранены.', 'success')
    } catch (error) {
      setProfile(previous)
      showAppError(
        error,
        'Не удалось сохранить приватность.',
        'Ошибка сохранения приватности'
      )
    } finally {
      setSavingKey(null)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/auth')
  }

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-12 text-center text-gray-500">Загрузка настроек...</div>
  }

  if (!user) {
    return <div className="mx-auto max-w-6xl px-4 py-12 text-center text-gray-500">Нужно войти в систему.</div>
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium text-blue-700">Аккаунт</p>
        <h1 className="text-3xl font-bold text-gray-900">Настройки</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Управление аккаунтом, профилем, уведомлениями и видимостью экспертной анкеты.
        </p>
      </div>

      {error && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit rounded-xl border bg-white p-4 shadow-sm lg:sticky lg:top-6">
          <nav className="space-y-1 text-sm">
            <Anchor href="#account">Аккаунт</Anchor>
            <Anchor href="#profile">Профиль</Anchor>
            <Anchor href="#notifications">Уведомления</Anchor>
            <Anchor href="#privacy">Приватность</Anchor>
            <Anchor href="#security">Безопасность</Anchor>
            <Anchor href="#data">Данные</Anchor>
          </nav>
        </aside>

        <div className="space-y-6">
          <Section id="account" title="Аккаунт" description="Базовая информация авторизованного пользователя.">
            <InfoRow label="Email" value={user.email || 'не указан'} />
            <InfoRow label="Дата регистрации" value={formatDate(user.created_at)} />
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/auth/reset-password" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Сменить пароль
              </Link>
              <button type="button" onClick={handleLogout} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Выйти
              </button>
            </div>
          </Section>

          <Section id="profile" title="Профиль" description="Заполненность анкеты влияет на доверие в каталоге экспертов.">
            <div className="mb-4 flex flex-wrap gap-3">
              <Link href="/profile" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Редактировать профиль
              </Link>
              <Link href={`/users/${user.id}`} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Открыть публичный профиль
              </Link>
            </div>

            <div className="rounded-lg border bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">Заполненность профиля</span>
                <span className="font-semibold text-blue-700">{completeness.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${completeness.percent}%` }} />
              </div>
              {completeness.missing.length > 0 ? (
                <p className="mt-3 text-sm text-gray-600">Не заполнено: {completeness.missing.join(', ')}.</p>
              ) : (
                <p className="mt-3 text-sm text-green-700">Профиль заполнен достаточно хорошо.</p>
              )}
            </div>
          </Section>

          <Section id="notifications" title="Уведомления" description="Настройки применяются к внутренним уведомлениям. Email-уведомления появятся позже.">
            <div className="divide-y rounded-lg border">
              {notificationMeta.map((item) => (
                <ToggleRow
                  key={item.key}
                  title={item.title}
                  description={item.description}
                  checked={notificationPrefs[item.key]}
                  disabled={savingKey === item.key}
                  onChange={(checked) => updateNotificationPref(item.key, checked)}
                />
              ))}
            </div>
          </Section>

          <Section id="privacy" title="Приватность" description="Управляет тем, что видно в каталоге экспертов и публичном профиле.">
            <label className="mb-2 block text-sm font-medium text-gray-700">Видимость профиля</label>
            <select
              value={profile?.visibility || 'public'}
              onChange={(event) => updateProfilePrivacy({ visibility: event.target.value as Visibility })}
              disabled={savingKey === 'visibility'}
              className="mb-4 w-full rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <option value="public">Публичный</option>
              <option value="platform_only">Только пользователям платформы</option>
              <option value="hidden">Скрытый</option>
            </select>

            {profile?.visibility === 'hidden' && (
              <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
                Ваш профиль не будет виден в каталоге экспертов. В рабочих проектах вы останетесь видимы участникам команды.
              </div>
            )}

            <div className="divide-y rounded-lg border">
              {privacyMeta.map((item) => (
                <ToggleRow
                  key={item.key}
                  title={item.title}
                  description={item.description}
                  checked={Boolean(profile?.[item.key])}
                  disabled={savingKey === item.key}
                  onChange={(checked) => updateProfilePrivacy({ [item.key]: checked } as Partial<Pick<Profile, 'visibility' | 'show_rate' | 'show_city' | 'show_portfolio' | 'show_availability'>>)}
                />
              ))}
            </div>
          </Section>

          <Section id="security" title="Безопасность" description="Чувствительные функции аккаунта.">
            <div className="flex flex-wrap gap-3">
              <Link href="/auth/reset-password" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Сменить пароль
              </Link>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <PlaceholderCard title="2FA" text="Двухфакторная аутентификация появится позже." />
              <PlaceholderCard title="Активные сессии" text="Просмотр устройств и сессий оставим на следующий этап." />
            </div>
          </Section>

          <Section id="data" title="Данные" description="Экспорт и удаление данных требуют отдельного безопасного процесса.">
            <div className="grid gap-3 md:grid-cols-2">
              <PlaceholderCard title="Экспорт данных" text="Позже здесь будет выгрузка архива с вашими данными." />
              <PlaceholderCard title="Удаление аккаунта" text="В MVP реального удаления нет, чтобы не ломать историю проектов. Пока — только по запросу в поддержку." />
            </div>
          </Section>
        </div>
      </div>
    </main>
  )
}

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="block rounded-lg px-3 py-2 text-gray-700 hover:bg-blue-50 hover:text-blue-700">
      {children}
    </a>
  )
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-xl border bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 rounded-lg border bg-gray-50 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-900">{value}</div>
    </div>
  )
}

function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 p-4 hover:bg-gray-50">
      <span>
        <span className="block text-sm font-medium text-gray-900">{title}</span>
        <span className="mt-1 block text-sm text-gray-500">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-blue-600 disabled:opacity-60"
      />
    </label>
  )
}

function PlaceholderCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-4">
      <div className="font-medium text-gray-900">{title}</div>
      <p className="mt-1 text-sm text-gray-500">{text}</p>
    </div>
  )
}