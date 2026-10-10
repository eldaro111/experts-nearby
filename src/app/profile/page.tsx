'use client'

import { UiText } from '@/components/LocaleProvider'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { PortfolioFiles } from '@/components/profile/PortfolioFiles'
import { LanguageDetails } from '@/components/profile/ProfileDetails'
import {
  EXPERIENCE_LABELS,
  priceLabel,
  safeWebUrl,
  type ProfileExtras,
} from '@/lib/profileOptions'
interface Profile extends ProfileExtras {
  user_id: string
  display_name: string
  city: string
  work_format: string
  timezone: string
  availability_hours: number | null
  experience_level: string
  about: string
  roles: string[]
  skills: string[]
  links: Record<string, string>
  portfolio_links: string[]
}
interface Listing {
  id: string
  title: string
  description: string | null
  created_at: string
}
export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [myProjects, setMyProjects] = useState<Listing[]>([])
  const [joinedProjects, setJoinedProjects] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const {
        data: { user: viewer },
        error: authError,
      } = await supabase.auth.getUser()
      if (authError && authError.name !== 'AuthSessionMissingError')
        throw authError
      setUser(viewer)
      if (!viewer) return
      const [profileRes, createdRes, appsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('user_id', viewer.id)
          .maybeSingle(),
        supabase
          .from('listings')
          .select('id,title,description,created_at')
          .eq('created_by', viewer.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('applications')
          .select('listing_id')
          .eq('user_id', viewer.id)
          .eq('status', 'accepted'),
      ])
      if (profileRes.error || createdRes.error || appsRes.error)
        throw profileRes.error || createdRes.error || appsRes.error
      setProfile(profileRes.data as Profile | null)
      setMyProjects(createdRes.data || [])
      const ids = (appsRes.data || []).map((a) => a.listing_id)
      if (ids.length) {
        const { data, error: issue } = await supabase
          .from('listings')
          .select('id,title,description,created_at')
          .in('id', ids)
          .order('created_at', { ascending: false })
        if (issue) throw issue
        setJoinedProjects(data || [])
      } else setJoinedProjects([])
    } catch {
      setError(
        'Не удалось загрузить профиль. Проверьте соединение и повторите попытку.',
      )
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  if (loading) return <PageLoading />
  if (error)
    return (
      <div className="page-shell">
        <EmptyState title="Профиль недоступен" description={error}>
          <button onClick={load} className="action-primary">
            <UiText text={'Повторить'} />
          </button>
        </EmptyState>
      </div>
    )
  if (!user)
    return (
      <div className="page-shell">
        <EmptyState
          title="Войдите в аккаунт"
          description="После входа вы сможете заполнить профиль."
        >
          <Link href="/auth" className="action-primary">
            <UiText text={'Войти'} />
          </Link>
        </EmptyState>
      </div>
    )
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Ваш экспертный профиль"
        title="Мой профиль"
        description="Опыт, навыки, проекты и предложения сотрудничества."
      >
        <Link href="/inquiries" className="action-secondary">
          <UiText text={'Обращения'} />
        </Link>
      </PageHeader>
      <section className="rounded-2xl border bg-white p-6 mb-8 space-y-5">
        {editMode || !profile ? (
          <ProfileEditor
            userId={user.id}
            initial={profile ? { ...profile } : {}}
            onSaved={(data) => {
              setProfile(data as unknown as Profile)
              setEditMode(false)
              showAppMessage('Профиль сохранён.', 'success')
            }}
            onCancel={profile ? () => setEditMode(false) : undefined}
          />
        ) : (
          <>
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-2">
                  {profile.expert_code ||
                    'Регистрационный номер ещё не присвоен'}
                </p>
                <h2 className="text-2xl font-bold">
                  {profile.display_name || 'Заполните имя и фамилию'}
                </h2>
                <p className="text-sm text-slate-500 mt-2">
                  {profile.city || 'Город не указан'} ·{' '}
                  {
                    EXPERIENCE_LABELS[
                      profile.experience_years ||
                        profile.experience_level ||
                        'unspecified'
                    ]
                  }
                </p>
              </div>
              <button
                onClick={() => setEditMode(true)}
                className="action-secondary"
              >
                <UiText text={'Редактировать профиль'} />
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <span>{profile.timezone || 'Часовой пояс не указан'}</span>
              <span>
                {profile.availability_hours == null
                  ? 'Доступность не указана'
                  : `${profile.availability_hours} ч/нед`}
              </span>
              <b>{priceLabel(profile)}</b>
            </div>
            {profile.about && (
              <p className="whitespace-pre-line text-slate-700">
                {profile.about}
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <TagList
                title="Специализации"
                items={Array.isArray(profile.roles) ? profile.roles : []}
                tone="blue"
              />
              <TagList
                title="Навыки"
                items={Array.isArray(profile.skills) ? profile.skills : []}
              />
            </div>
            {profile.university_id && (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                В профиле указана принадлежность к вузу.{' '}
                <Link href="/universities" className="underline">
                  Открыть раздел «ВУЗам»
                </Link>
                . Данные указаны вами и не означают подтверждение вузом.
              </p>
            )}
            <LanguageDetails languages={profile.languages} />
            {Object.entries(profile.links || {})
              .filter(([, url]) => safeWebUrl(url))
              .map(([label, url]) => (
                <a
                  key={label}
                  href={safeWebUrl(url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-blue-700 underline break-all"
                >
                  {label}
                </a>
              ))}
            {Array.isArray(profile.portfolio_links) &&
              profile.portfolio_links
                .filter((url) => safeWebUrl(url))
                .map((url) => (
                  <a
                    key={url}
                    href={safeWebUrl(url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-blue-700 underline break-all"
                  >
                    {url}
                  </a>
                ))}
            <PortfolioFiles userId={user.id} editable />
          </>
        )}
      </section>
      <ProjectList
        title="Мои проекты"
        empty="Вы ещё не создавали проектов."
        projects={myProjects}
        router={router}
        owner
      />
      <ProjectList
        title="Участвую в проектах"
        empty="Вы ещё не участвуете в проектах."
        projects={joinedProjects}
        router={router}
      />
      <section className="mt-10">
        <h2 className="text-2xl font-semibold mb-4">Приглашения</h2>
        <InvitationsList userId={user.id} />
      </section>
    </div>
  )
}

function TagList({
  title,
  items,
  tone = 'gray',
}: {
  title: string
  items: string[]
  tone?: 'blue' | 'gray'
}) {
  const className =
    tone === 'blue'
      ? 'text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full'
      : 'text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full'
  return (
    <div>
      <h3 className="font-semibold mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-gray-500">—</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className={className}>
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectList({
  title,
  empty,
  projects,
  router,
  owner = false,
}: {
  title: string
  empty: string
  projects: Listing[]
  router: ReturnType<typeof useRouter>
  owner?: boolean
}) {
  return (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold mb-4">{title}</h2>
      {projects.length === 0 ? (
        <p className="text-gray-500">{empty}</p>
      ) : (
        <div className="grid gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              className="border rounded-lg p-4 bg-white shadow-sm"
            >
              <h3 className="font-semibold text-lg">{p.title}</h3>
              <p className="text-gray-600 text-sm mb-2">{p.description}</p>
              <p className="text-xs text-gray-400">
                Опубликован: {new Date(p.created_at).toLocaleDateString()}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => router.push(`/listings/${p.id}`)}
                  className="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition"
                >
                  Обзор
                </button>
                <button
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="bg-gray-900 text-white text-sm px-3 py-1 rounded hover:bg-black transition"
                >
                  Рабочая зона
                </button>
                {owner && (
                  <button
                    onClick={() => router.push(`/listings/${p.id}/edit`)}
                    className="bg-gray-200 text-gray-700 text-sm px-3 py-1 rounded hover:bg-gray-300 transition"
                  >
                    Редактировать
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InvitationsList({ userId }: { userId: string }) {
  const [invites, setInvites] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(
    null,
  )

  useEffect(() => {
    const loadInvites = async () => {
      const { data: inviteApps, error } = await supabase
        .from('applications')
        .select('id, listing_id, status, invited_by_author')
        .eq('user_id', userId)
        .eq('invited_by_author', true)
        .eq('status', 'pending')
        .order('id', { ascending: false })
      if (error) {
        logAppError('Ошибка загрузки приглашений', error)
        setInvites([])
        setLoading(false)
        return
      }
      const listingIds = (inviteApps || []).map((i: any) => i.listing_id)
      if (listingIds.length === 0) {
        setInvites([])
        setLoading(false)
        return
      }
      const { data: listingsData, error: listingsError } = await supabase
        .from('listings')
        .select('id, title, description')
        .in('id', listingIds)
      if (listingsError) {
        logAppError('Ошибка загрузки проектов приглашений', listingsError)
        setInvites([])
      } else {
        const listingsMap = new Map(
          (listingsData || []).map((l: any) => [l.id, l]),
        )
        setInvites(
          (inviteApps || []).map((invite: any) => ({
            ...invite,
            listings: listingsMap.get(invite.listing_id) || null,
          })),
        )
      }
      setLoading(false)
    }
    loadInvites()
  }, [userId])

  const handleRespond = async (
    inviteId: string,
    newStatus: 'accepted' | 'declined',
  ) => {
    if (respondingInviteId) return

    setRespondingInviteId(inviteId)

    try {
      const { error } = await supabase
        .from('applications')
        .update({ status: newStatus })
        .eq('id', inviteId)

      if (error) {
        showAppError(
          error,
          'Не удалось обновить приглашение.',
          'Ошибка ответа на приглашение',
        )
        return
      }

      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId))
      showAppMessage(
        newStatus === 'accepted'
          ? 'Приглашение принято.'
          : 'Приглашение отклонено.',
        newStatus === 'accepted' ? 'success' : 'info',
      )
    } catch (error) {
      showAppError(
        error,
        'Не удалось обновить приглашение.',
        'Ошибка ответа на приглашение',
      )
    } finally {
      setRespondingInviteId(null)
    }
  }

  if (loading) return <p className="text-gray-500">Загрузка приглашений...</p>
  if (invites.length === 0)
    return <p className="text-gray-500">Активных приглашений нет.</p>

  return (
    <div className="grid gap-4">
      {invites.map((invite) => {
        const responding = respondingInviteId === invite.id

        return (
          <div
            key={invite.id}
            className="border rounded-lg p-4 bg-white shadow-sm"
          >
            <h3 className="font-semibold text-lg">
              {invite.listings?.title || 'Проект без названия'}
            </h3>
            <p className="text-gray-600 text-sm mb-3">
              {invite.listings?.description || 'Описание не указано'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handleRespond(invite.id, 'accepted')}
                disabled={Boolean(respondingInviteId)}
                className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {responding ? 'Сохраняем...' : 'Принять'}
              </button>
              <button
                onClick={() => handleRespond(invite.id, 'declined')}
                disabled={Boolean(respondingInviteId)}
                className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UiText text={responding ? 'Сохраняем...' : 'Отклонить'} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
