'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { createNotification } from '@/lib/notifications'
import { ProfileReviews } from '@/components/profile/ProfileReviews'

interface Profile { user_id: string; display_name: string | null; roles: unknown; skills: unknown; timezone: string | null; availability_hours: number | string | null; city: string | null; work_format: 'remote' | 'onsite' | 'hybrid' | null; experience_level: 'junior' | 'middle' | 'senior' | 'expert' | null; hourly_rate: number | string | null; portfolio_links: unknown; about: string | null; visibility?: 'public' | 'platform_only' | 'hidden' | null }
interface OwnedProject { id: string; title: string; description?: string | null }
const workFormatLabel: Record<string, string> = { remote: 'Удалённо', onsite: 'Очно', hybrid: 'Гибрид' }
const experienceLabel: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior', expert: 'Expert' }
const tagToString = (value: unknown): string => { if (typeof value === 'string') return value.trim(); if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim(); if (value && typeof value === 'object') { const r = value as Record<string, unknown>; return String(r.name ?? r.title ?? r.label ?? r.value ?? r.text ?? '').trim() } return '' }
const toList = (value: unknown): string[] => { if (!value) return []; if (Array.isArray(value)) return value.map(tagToString).filter(Boolean); if (typeof value === 'string') { const t = value.trim(); if (!t) return []; if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) { try { return toList(JSON.parse(t)) } catch {} } return t.split(/[;,\n]/).map((i) => i.trim()).filter(Boolean) } return [tagToString(value)].filter(Boolean) }
const normalizeUrl = (value: unknown) => { const url = String(value ?? '').trim(); if (!url) return '#'; return url.startsWith('http') ? url : `https://${url}` }

export default function UserProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [ownedProjects, setOwnedProjects] = useState<OwnedProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUser(user || null)
      if (user && user.id === id) { router.replace('/profile'); return }
      const { data, error } = await supabase.from('profiles_public').select('user_id, display_name, roles, skills, timezone, availability_hours, city, work_format, experience_level, hourly_rate, portfolio_links, about, visibility').eq('user_id', id).maybeSingle()
      if (error) { logAppError('Ошибка загрузки профиля:', error); setProfile(null) } else setProfile((data || null) as Profile | null)
      if (user?.id) {
        const { data: projectsData, error: projectsError } = await supabase.from('listings').select('id, title, description').eq('created_by', user.id).order('created_at', { ascending: false })
        if (projectsError) { logAppError('Ошибка загрузки проектов для приглашения:', projectsError); setOwnedProjects([]) } else setOwnedProjects((projectsData || []) as OwnedProject[])
      } else setOwnedProjects([])
      setLoading(false)
    }
    fetchProfile()
  }, [id, router])

  const handleInvite = async () => {
    if (inviting) return

    if (!currentUser?.id) {
      showAppMessage('Войдите в систему, чтобы приглашать экспертов.', 'warning')
      return
    }

    if (!profile) {
      showAppMessage('Профиль не найден.', 'warning')
      return
    }

    if (!selectedProjectId) {
      showAppMessage('Выберите проект для приглашения.', 'warning')
      return
    }

    const project = ownedProjects.find(
      (item) => item.id === selectedProjectId
    )

    if (!project) {
      showAppMessage('Проект не найден.', 'warning')
      return
    }

    setInviting(true)

    try {
      const { data: existing, error: existingError } = await supabase
        .from('applications')
        .select('id, status')
        .eq('listing_id', selectedProjectId)
        .eq('user_id', profile.user_id)
        .maybeSingle()

      if (existingError) {
        showAppError(existingError, 'Не удалось проверить приглашение.', 'Проверка приглашения из профиля эксперта')
        return
      }

      let repeated = false

      if (existing) {
        if (existing.status === 'pending' || existing.status === 'accepted') {
          showAppMessage('Этот эксперт уже приглашён или уже участвует в проекте.', 'info')
          return
        }

        repeated = true
        const { error: updateError } = await supabase
          .from('applications')
          .update({ status: 'pending', invited_by_author: true })
          .eq('id', existing.id)

        if (updateError) {
          showAppError(updateError, 'Не удалось повторно пригласить эксперта.', 'Повторное приглашение из профиля эксперта')
          return
        }
      } else {
        const { error: insertError } = await supabase
          .from('applications')
          .insert([
            {
              listing_id: selectedProjectId,
              user_id: profile.user_id,
              invited_by_author: true,
              status: 'pending',
            },
          ])

        if (insertError) {
          showAppError(insertError, 'Не удалось пригласить эксперта.', 'Приглашение из профиля эксперта')
          return
        }
      }

      await createNotification({
        recipientId: profile.user_id,
        actorId: currentUser.id,
        projectId: selectedProjectId,
        type: 'project_invite',
        title: 'Вас пригласили в проект',
        body: `Вас пригласили в проект «${project.title}».`,
        href: '/profile',
        payload: {
          listing_id: selectedProjectId,
          listing_title: project.title,
          invited_from: 'user_profile',
          repeated,
        },
      })

      showAppMessage(
        `Эксперт приглашён в проект «${project.title}».`,
        'success'
      )
      setSelectedProjectId('')
    } catch (error) {
      showAppError(error, 'Не удалось пригласить эксперта.', 'Приглашение из профиля эксперта')
    } finally {
      setInviting(false)
    }
  }

  const roles = useMemo(() => toList(profile?.roles), [profile])
  const skills = useMemo(() => toList(profile?.skills), [profile])
  const portfolioLinks = useMemo(() => toList(profile?.portfolio_links), [profile])

  if (loading) return <div className="text-center py-12 text-gray-500">Загрузка профиля...</div>
  if (!profile) return <div className="text-center py-12 text-gray-500">Профиль скрыт или недоступен.</div>

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-6"><Link href="/experts" className="text-sm text-blue-600 hover:underline">← Назад к экспертам</Link></div>
      <div className="bg-white shadow-sm border rounded-xl p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
          <div><h1 className="text-3xl font-bold">{profile.display_name || 'Без имени'}</h1><p className="text-gray-600 mt-2">{profile.city || 'Город не указан'} · {profile.work_format ? workFormatLabel[profile.work_format] : 'формат не указан'} · {profile.experience_level ? experienceLabel[profile.experience_level] : 'уровень не указан'}</p><p className="text-gray-500 text-sm mt-1">{profile.timezone || 'Часовой пояс не указан'} · {profile.availability_hours ?? 0} ч/нед{profile.hourly_rate ? ` · ${profile.hourly_rate} ₽/час` : ''}</p></div>
          {currentUser ? ownedProjects.length > 0 ? <div className="border rounded-lg p-3 bg-gray-50 w-full md:w-80"><div className="text-sm font-medium mb-2">Пригласить в проект</div><div className="flex flex-col gap-2"><select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white"><option value="">Выбрать проект...</option>{ownedProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button onClick={handleInvite} disabled={inviting} className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-60">{inviting ? 'Приглашаем...' : 'Пригласить'}</button></div></div> : <Link href="/listings/new" className="text-sm text-blue-600 hover:underline">Создать проект, чтобы пригласить эксперта</Link> : <Link href="/auth" className="text-sm text-blue-600 hover:underline">Войдите, чтобы пригласить эксперта</Link>}
        </div>
        {profile.about && <div className="mb-6"><h2 className="font-semibold mb-2">О себе</h2><p className="text-gray-700 whitespace-pre-line">{profile.about}</p></div>}
        <div className="grid md:grid-cols-2 gap-5"><TagBlock title="Роли" items={roles} tone="blue" /><TagBlock title="Навыки" items={skills} /></div>
        {portfolioLinks.length > 0 && <div className="mt-6"><h2 className="font-semibold mb-2">Портфолио</h2><div className="space-y-1">{portfolioLinks.map((link) => <a key={link} href={normalizeUrl(link)} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-600 hover:underline break-all">{link}</a>)}</div></div>}
      </div>

      <ProfileReviews userId={profile.user_id} />
    </div>
  )
}

function TagBlock({ title, items, tone = 'gray' }: { title: string; items: string[]; tone?: 'blue' | 'gray' }) {
  const className = tone === 'blue' ? 'text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full' : 'text-sm bg-gray-100 text-gray-700 px-3 py-1 rounded-full'
  return <div><h2 className="font-semibold mb-2">{title}</h2>{items.length === 0 ? <p className="text-gray-500">—</p> : <div className="flex flex-wrap gap-2">{items.map((item) => <span key={item} className={className}>{item}</span>)}</div>}</div>
}