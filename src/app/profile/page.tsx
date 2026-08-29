'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'

interface Profile {
  user_id: string
  display_name: string | null
  roles: unknown
  skills: unknown
  timezone: string | null
  availability_hours: number | string | null
  links: Record<string, unknown> | null
  city: string | null
  work_format: 'remote' | 'onsite' | 'hybrid' | null
  experience_level: 'junior' | 'middle' | 'senior' | 'expert' | null
  hourly_rate: number | string | null
  portfolio_links: unknown
  about: string | null
}

interface Listing {
  id: string
  title: string
  description: string | null
  status?: string | null
  created_by?: string | null
  created_at: string
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

const tagToString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(
      record.name ??
        record.title ??
        record.label ??
        record.value ??
        record.text ??
        ''
    ).trim()
  }

  return ''
}

const toList = (value: unknown): string[] => {
  if (!value) return []

  if (Array.isArray(value)) {
    return value.map(tagToString).filter(Boolean)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        return toList(JSON.parse(trimmed))
      } catch {
        // Не JSON — обработаем как обычную строку.
      }
    }

    return trimmed
      .split(/[;,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return [tagToString(value)].filter(Boolean)
}

const parseList = (value: string): string[] =>
  value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

const parseLinksObject = (value: string): Record<string, string> => {
  const result: Record<string, string> = {}

  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const separatorIndex = line.indexOf(':')

      if (separatorIndex > 0) {
        const key = line.slice(0, separatorIndex).trim()
        const url = line.slice(separatorIndex + 1).trim()
        if (key && url) result[key] = url
      } else {
        result[`Ссылка ${index + 1}`] = line
      }
    })

  return result
}

const linksObjectToText = (links: Record<string, unknown> | null | undefined): string => {
  if (!links) return ''

  return Object.entries(links)
    .map(([key, value]) => `${key}: ${String(value ?? '')}`)
    .join('\n')
}

const numberOrNull = (value: unknown): number | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeUrl = (value: unknown) => {
  const url = String(value ?? '').trim()
  if (!url) return '#'
  return url.startsWith('http') ? url : `https://${url}`
}

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [myProjects, setMyProjects] = useState<Listing[]>([])
  const [joinedProjects, setJoinedProjects] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [rolesText, setRolesText] = useState('')
  const [skillsText, setSkillsText] = useState('')
  const [availabilityHours, setAvailabilityHours] = useState('')
  const [city, setCity] = useState('')
  const [workFormat, setWorkFormat] = useState('')
  const [experienceLevel, setExperienceLevel] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [about, setAbout] = useState('')
  const [linksText, setLinksText] = useState('')
  const [portfolioLinksText, setPortfolioLinksText] = useState('')

  const router = useRouter()

  const fillForm = (profileData: Profile | null) => {
    if (!profileData) return

    setDisplayName(profileData.display_name || '')
    setTimezone(profileData.timezone || '')
    setRolesText(toList(profileData.roles).join(', '))
    setSkillsText(toList(profileData.skills).join(', '))
    setAvailabilityHours(String(profileData.availability_hours ?? ''))
    setCity(profileData.city || '')
    setWorkFormat(profileData.work_format || '')
    setExperienceLevel(profileData.experience_level || '')
    setHourlyRate(String(profileData.hourly_rate ?? ''))
    setAbout(profileData.about || '')
    setLinksText(linksObjectToText(profileData.links))
    setPortfolioLinksText(toList(profileData.portfolio_links).join('\n'))
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      setUser(user || null)

      if (!user) {
        setLoading(false)
        return
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profileError) {
        logAppError('Ошибка загрузки профиля', profileError)
        setProfile(null)
      } else {
        const nextProfile = (profileData || null) as Profile | null
        setProfile(nextProfile)
        fillForm(nextProfile)
      }

      const { data: created, error: createdError } = await supabase
        .from('listings_with_count')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })

      if (createdError) {
        logAppError('Ошибка загрузки своих проектов', createdError)
        setMyProjects([])
      } else {
        setMyProjects((created || []) as Listing[])
      }

      const { data: joinedApps, error: joinedError } = await supabase
        .from('applications')
        .select('listing_id, status')
        .eq('user_id', user.id)

      if (joinedError) {
        logAppError('Ошибка при загрузке участий', joinedError)
        setJoinedProjects([])
      } else {
        const joinedListingIds = (joinedApps || [])
          .filter((a: any) => a.status === 'accepted')
          .map((a: any) => a.listing_id)

        if (joinedListingIds.length > 0) {
          const { data: joinedListings, error: listingsError } = await supabase
            .from('listings')
            .select('id, title, description, created_at')
            .in('id', joinedListingIds)
            .order('created_at', { ascending: false })

          if (listingsError) {
            logAppError('Ошибка при загрузке проектов участия', listingsError)
            setJoinedProjects([])
          } else {
            setJoinedProjects((joinedListings || []) as Listing[])
          }
        } else {
          setJoinedProjects([])
        }
      }

      setLoading(false)
    }

    fetchData()
  }, [])

  const handleStartEdit = () => {
    fillForm(profile)
    setEditMode(true)
  }

  const handleSave = async () => {
    if (!user?.id || saving) return

    const payload = {
      display_name: displayName.trim() || null,
      roles: parseList(rolesText),
      skills: parseList(skillsText),
      timezone: timezone.trim() || null,
      availability_hours: numberOrNull(availabilityHours),
      city: city.trim() || null,
      work_format: workFormat || null,
      experience_level: experienceLevel || null,
      hourly_rate: numberOrNull(hourlyRate),
      about: about.trim() || null,
      links: parseLinksObject(linksText),
      portfolio_links: parseList(portfolioLinksText),
    }

    setSaving(true)

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('user_id', user.id)
        .select('*')
        .maybeSingle()

      if (error) {
        showAppError(error, 'Не удалось сохранить профиль.', 'Ошибка сохранения профиля')
        return
      }

      const nextProfile = (data || { ...profile, ...payload, user_id: user.id }) as Profile
      setProfile(nextProfile)
      fillForm(nextProfile)
      setEditMode(false)
      showAppMessage('Профиль обновлён.', 'success')
    } catch (error) {
      showAppError(error, 'Не удалось сохранить профиль.', 'Ошибка сохранения профиля')
    } finally {
      setSaving(false)
    }
  }

  const roles = useMemo(() => toList(profile?.roles), [profile])
  const skills = useMemo(() => toList(profile?.skills), [profile])
  const portfolioLinks = useMemo(() => toList(profile?.portfolio_links), [profile])

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Загрузка профиля...</div>
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">Войдите в систему, чтобы открыть профиль.</p>
        <button
          onClick={() => router.push('/auth')}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Войти
        </button>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">
          Профиль не найден. Пройдите первичную настройку.
        </p>
        <button
          onClick={() => router.push('/onboarding')}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Заполнить профиль
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold text-center mb-6">Мой профиль</h1>

      <div className="bg-white shadow-sm border rounded-xl p-6 mb-8">
        {editMode ? (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <input type="text" placeholder="Имя / Никнейм" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="border rounded-lg p-2 w-full" />
              <input type="text" placeholder="Город" value={city} onChange={(e) => setCity(e.target.value)} className="border rounded-lg p-2 w-full" />
              <input type="text" placeholder="Часовой пояс" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="border rounded-lg p-2 w-full" />
              <input type="number" placeholder="Доступность, часов в неделю" value={availabilityHours} onChange={(e) => setAvailabilityHours(e.target.value)} className="border rounded-lg p-2 w-full" />

              <select value={workFormat} onChange={(e) => setWorkFormat(e.target.value)} className="border rounded-lg p-2 w-full bg-white">
                <option value="">Формат работы не указан</option>
                <option value="remote">Удалённо</option>
                <option value="onsite">Очно</option>
                <option value="hybrid">Гибрид</option>
              </select>

              <select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)} className="border rounded-lg p-2 w-full bg-white">
                <option value="">Уровень не указан</option>
                <option value="junior">Junior</option>
                <option value="middle">Middle</option>
                <option value="senior">Senior</option>
                <option value="expert">Expert</option>
              </select>

              <input type="number" placeholder="Ставка, ₽/час" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} className="border rounded-lg p-2 w-full" />
              <input type="text" placeholder="Роли через запятую" value={rolesText} onChange={(e) => setRolesText(e.target.value)} className="border rounded-lg p-2 w-full" />
              <input type="text" placeholder="Навыки через запятую" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} className="border rounded-lg p-2 w-full md:col-span-2" />
              <textarea placeholder="О себе: опыт, специализация, чем полезен проектам" value={about} onChange={(e) => setAbout(e.target.value)} className="border rounded-lg p-2 w-full min-h-28 md:col-span-2" />
              <textarea placeholder={'Ссылки, по одной на строку. Например:\nGitHub: github.com/name\nTelegram: t.me/name'} value={linksText} onChange={(e) => setLinksText(e.target.value)} className="border rounded-lg p-2 w-full min-h-24 md:col-span-2" />
              <textarea placeholder={'Портфолио, по одной ссылке на строку'} value={portfolioLinksText} onChange={(e) => setPortfolioLinksText(e.target.value)} className="border rounded-lg p-2 w-full min-h-24 md:col-span-2" />
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { fillForm(profile); setEditMode(false) }} className="px-4 py-2 rounded border text-gray-700 hover:bg-gray-100">Отмена</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold mb-2">{profile.display_name || 'Без имени'}</h2>
                <p className="text-gray-600">
                  {profile.city || 'Город не указан'} · {profile.work_format ? workFormatLabel[profile.work_format] : 'формат не указан'} · {profile.experience_level ? experienceLabel[profile.experience_level] : 'уровень не указан'}
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  {profile.timezone || 'Часовой пояс не указан'} · {profile.availability_hours ?? 0} ч/нед{profile.hourly_rate ? ` · ${profile.hourly_rate} ₽/час` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/settings" className="border text-gray-700 text-sm px-4 py-2 rounded hover:bg-gray-50 transition">Настройки</Link>
                <button onClick={handleStartEdit} className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition">Редактировать профиль</button>
              </div>
            </div>

            {profile.about && <div className="mt-5"><h3 className="font-semibold mb-2">О себе</h3><p className="text-gray-700 whitespace-pre-line">{profile.about}</p></div>}

            <div className="grid md:grid-cols-2 gap-5 mt-5">
              <TagList title="Роли" items={roles} tone="blue" />
              <TagList title="Навыки" items={skills} />
            </div>

            {profile.links && Object.keys(profile.links).length > 0 && (
              <div className="mt-5">
                <h3 className="font-semibold mb-2">Ссылки</h3>
                <div className="space-y-1">
                  {Object.entries(profile.links).map(([key, value]) => (
                    <div key={key} className="text-sm"><b>{key}:</b> <a href={normalizeUrl(value)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{String(value)}</a></div>
                  ))}
                </div>
              </div>
            )}

            {portfolioLinks.length > 0 && (
              <div className="mt-5"><h3 className="font-semibold mb-2">Портфолио</h3><div className="space-y-1">{portfolioLinks.map((link) => <a key={link} href={normalizeUrl(link)} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-600 hover:underline break-all">{link}</a>)}</div></div>
            )}
          </>
        )}
      </div>

      <ProjectList title="Мои проекты" empty="Вы ещё не создавали проектов." projects={myProjects} router={router} owner />
      <ProjectList title="Участвую в проектах" empty="Вы ещё не участвуете в проектах." projects={joinedProjects} router={router} />

      {user?.id && <div className="mt-10"><h2 className="text-2xl font-semibold mb-4">Приглашения</h2><InvitationsList userId={user.id} /></div>}
    </div>
  )
}

function TagList({ title, items, tone = 'gray' }: { title: string; items: string[]; tone?: 'blue' | 'gray' }) {
  const className = tone === 'blue' ? 'text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full' : 'text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full'
  return <div><h3 className="font-semibold mb-2">{title}</h3>{items.length === 0 ? <p className="text-gray-500">—</p> : <div className="flex flex-wrap gap-2">{items.map((item) => <span key={item} className={className}>{item}</span>)}</div>}</div>
}

function ProjectList({ title, empty, projects, router, owner = false }: { title: string; empty: string; projects: Listing[]; router: ReturnType<typeof useRouter>; owner?: boolean }) {
  return (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold mb-4">{title}</h2>
      {projects.length === 0 ? <p className="text-gray-500">{empty}</p> : (
        <div className="grid gap-4">{projects.map((p) => (
          <div key={p.id} className="border rounded-lg p-4 bg-white shadow-sm">
            <h3 className="font-semibold text-lg">{p.title}</h3>
            <p className="text-gray-600 text-sm mb-2">{p.description}</p>
            <p className="text-xs text-gray-400">Опубликован: {new Date(p.created_at).toLocaleDateString()}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => router.push(`/listings/${p.id}`)} className="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition">Обзор</button>
              <button onClick={() => router.push(`/projects/${p.id}`)} className="bg-gray-900 text-white text-sm px-3 py-1 rounded hover:bg-black transition">Рабочая зона</button>
              {owner && <button onClick={() => router.push(`/listings/${p.id}/edit`)} className="bg-gray-200 text-gray-700 text-sm px-3 py-1 rounded hover:bg-gray-300 transition">Редактировать</button>}
            </div>
          </div>
        ))}</div>
      )}
    </div>
  )
}

function InvitationsList({ userId }: { userId: string }) {
  const [invites, setInvites] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null)

  useEffect(() => {
    const loadInvites = async () => {
      const { data: inviteApps, error } = await supabase.from('applications').select('id, listing_id, status, invited_by_author').eq('user_id', userId).eq('invited_by_author', true).eq('status', 'pending').order('id', { ascending: false })
      if (error) { logAppError('Ошибка загрузки приглашений', error); setInvites([]); setLoading(false); return }
      const listingIds = (inviteApps || []).map((i: any) => i.listing_id)
      if (listingIds.length === 0) { setInvites([]); setLoading(false); return }
      const { data: listingsData, error: listingsError } = await supabase.from('listings').select('id, title, description').in('id', listingIds)
      if (listingsError) { logAppError('Ошибка загрузки проектов приглашений', listingsError); setInvites([]) } else {
        const listingsMap = new Map((listingsData || []).map((l: any) => [l.id, l]))
        setInvites((inviteApps || []).map((invite: any) => ({ ...invite, listings: listingsMap.get(invite.listing_id) || null })))
      }
      setLoading(false)
    }
    loadInvites()
  }, [userId])

  const handleRespond = async (inviteId: string, newStatus: 'accepted' | 'declined') => {
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
          'Ошибка ответа на приглашение'
        )
        return
      }

      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId))
      showAppMessage(
        newStatus === 'accepted' ? 'Приглашение принято.' : 'Приглашение отклонено.',
        newStatus === 'accepted' ? 'success' : 'info'
      )
    } catch (error) {
      showAppError(
        error,
        'Не удалось обновить приглашение.',
        'Ошибка ответа на приглашение'
      )
    } finally {
      setRespondingInviteId(null)
    }
  }

  if (loading) return <p className="text-gray-500">Загрузка приглашений...</p>
  if (invites.length === 0) return <p className="text-gray-500">Активных приглашений нет.</p>

  return (
    <div className="grid gap-4">
      {invites.map((invite) => {
        const responding = respondingInviteId === invite.id

        return (
          <div key={invite.id} className="border rounded-lg p-4 bg-white shadow-sm">
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
                {responding ? 'Сохраняем...' : 'Отклонить'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
