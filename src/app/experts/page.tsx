'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { createNotification } from '@/lib/notifications'

interface Profile {
  user_id: string
  display_name: string | null
  roles: unknown
  skills: unknown
  timezone: string | null
  availability_hours: number | string | null
  visibility?: 'public' | 'platform_only' | 'hidden' | null
  city: string | null
  work_format: 'remote' | 'onsite' | 'hybrid' | null
  experience_level: 'junior' | 'middle' | 'senior' | 'expert' | null
  hourly_rate: number | string | null
  portfolio_links: unknown
  about: string | null
}

interface OwnedProject {
  id: string
  title: string
  description?: string | null
}

interface ReviewStats {
  count: number
  average: number
}

const workFormatLabel: Record<string, string> = { remote: 'Удалённо', onsite: 'Очно', hybrid: 'Гибрид' }
const experienceLabel: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior', expert: 'Expert' }

const tagToString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return String(record.name ?? record.title ?? record.label ?? record.value ?? record.text ?? '').trim()
  }
  return ''
}

const toList = (value: unknown): string[] => {
  if (!value) return []
  if (Array.isArray(value)) return value.map(tagToString).filter(Boolean)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try { return toList(JSON.parse(trimmed)) } catch {}
    }
    return trimmed.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)
  }
  return [tagToString(value)].filter(Boolean)
}

const normalize = (value: unknown) => String(value ?? '').toLowerCase().trim()
const uniqueSorted = (items: unknown[]) => Array.from(new Set(items.map(tagToString).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'))
const normalizeUrl = (value: unknown) => { const url = String(value ?? '').trim(); if (!url) return '#'; return url.startsWith('http') ? url : `https://${url}` }
const formatRating = (stats?: ReviewStats) => stats && stats.count > 0 ? `★ ${stats.average} · ${stats.count}` : 'нет отзывов'

export default function ExpertsPage() {
  const [user, setUser] = useState<any>(null)
  const [experts, setExperts] = useState<Profile[]>([])
  const [ownedProjects, setOwnedProjects] = useState<OwnedProject[]>([])
  const [reviewStatsByUserId, setReviewStatsByUserId] = useState<Record<string, ReviewStats>>({})
  const [selectedProjectByExpert, setSelectedProjectByExpert] = useState<Record<string, string>>({})
  const [invitingExpertId, setInvitingExpertId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [workFormatFilter, setWorkFormatFilter] = useState('')
  const [experienceFilter, setExperienceFilter] = useState('')
  const [minAvailability, setMinAvailability] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user || null)
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles_public')
        .select('user_id, display_name, roles, skills, timezone, availability_hours, city, work_format, experience_level, hourly_rate, portfolio_links, about, visibility')
        .order('display_name', { ascending: true })
      if (profilesError) { logAppError('Ошибка загрузки экспертов:', profilesError); setExperts([]) } else setExperts((profilesData || []) as Profile[])

      const { data: reviewsData, error: reviewsError } = await supabase
        .from('profile_reviews')
        .select('reviewed_user_id, rating')

      if (reviewsError) {
        logAppError('Ошибка загрузки рейтингов экспертов:', reviewsError)
        setReviewStatsByUserId({})
      } else {
        const buckets: Record<string, { sum: number; count: number }> = {}
        ;((reviewsData || []) as { reviewed_user_id: string; rating: number }[]).forEach((review) => {
          if (!review.reviewed_user_id) return
          if (!buckets[review.reviewed_user_id]) buckets[review.reviewed_user_id] = { sum: 0, count: 0 }
          buckets[review.reviewed_user_id].sum += Number(review.rating || 0)
          buckets[review.reviewed_user_id].count += 1
        })

        setReviewStatsByUserId(Object.fromEntries(
          Object.entries(buckets).map(([userId, bucket]) => [
            userId,
            {
              count: bucket.count,
              average: Math.round((bucket.sum / bucket.count) * 10) / 10,
            },
          ])
        ))
      }

      if (user?.id) {
        const { data: projectsData, error: projectsError } = await supabase.from('listings').select('id, title, description').eq('created_by', user.id).order('created_at', { ascending: false })
        if (projectsError) { logAppError('Ошибка загрузки проектов для приглашения:', projectsError); setOwnedProjects([]) } else setOwnedProjects((projectsData || []) as OwnedProject[])
      } else setOwnedProjects([])
      setLoading(false)
    }
    fetchData()
  }, [])

  const allRoles = useMemo(() => uniqueSorted(experts.flatMap((expert) => toList(expert.roles))), [experts])
  const allSkills = useMemo(() => uniqueSorted(experts.flatMap((expert) => toList(expert.skills))), [experts])
  const allCities = useMemo(() => uniqueSorted(experts.map((expert) => expert.city || '').filter(Boolean)), [experts])

  const filteredExperts = useMemo(() => {
    const q = normalize(query)
    const minHours = minAvailability ? Number(minAvailability) : null
    return experts.filter((expert) => expert.user_id !== user?.id).filter((expert) => {
      const roles = toList(expert.roles)
      const skills = toList(expert.skills)
      const portfolioLinks = toList(expert.portfolio_links)
      const searchText = normalize([expert.display_name, roles.join(' '), skills.join(' '), expert.timezone, expert.city, expert.work_format, expert.experience_level, expert.about, portfolioLinks.join(' ')].join(' '))
      if (q && !searchText.includes(q)) return false
      if (roleFilter && !roles.some((role) => normalize(role) === normalize(roleFilter))) return false
      if (skillFilter && !skills.some((skill) => normalize(skill) === normalize(skillFilter))) return false
      if (cityFilter && expert.city !== cityFilter) return false
      if (workFormatFilter && expert.work_format !== workFormatFilter) return false
      if (experienceFilter && expert.experience_level !== experienceFilter) return false
      if (minHours !== null && Number(expert.availability_hours || 0) < minHours) return false
      return true
    })
  }, [experts, user?.id, query, roleFilter, skillFilter, cityFilter, workFormatFilter, experienceFilter, minAvailability])

  const resetFilters = () => { setQuery(''); setRoleFilter(''); setSkillFilter(''); setCityFilter(''); setWorkFormatFilter(''); setExperienceFilter(''); setMinAvailability('') }

  const handleInvite = async (expert: Profile) => {
    if (invitingExpertId) return

    if (!user?.id) {
      showAppMessage('Войдите в систему, чтобы приглашать экспертов.', 'warning')
      return
    }

    const projectId = selectedProjectByExpert[expert.user_id]
    if (!projectId) {
      showAppMessage('Выберите проект, куда пригласить эксперта.', 'warning')
      return
    }

    const project = ownedProjects.find((item) => item.id === projectId)
    if (!project) {
      showAppMessage('Проект не найден.', 'warning')
      return
    }

    setInvitingExpertId(expert.user_id)

    try {
      const { data: existing, error: existingError } = await supabase
        .from('applications')
        .select('id, status')
        .eq('listing_id', projectId)
        .eq('user_id', expert.user_id)
        .maybeSingle()

      if (existingError) {
        showAppError(existingError, 'Не удалось проверить приглашение.', 'Проверка приглашения из каталога экспертов')
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
          showAppError(updateError, 'Не удалось повторно пригласить эксперта.', 'Повторное приглашение из каталога')
          return
        }
      } else {
        const { error: insertError } = await supabase
          .from('applications')
          .insert([
            {
              listing_id: projectId,
              user_id: expert.user_id,
              invited_by_author: true,
              status: 'pending',
            },
          ])

        if (insertError) {
          showAppError(insertError, 'Не удалось пригласить эксперта.', 'Приглашение из каталога экспертов')
          return
        }
      }

      await createNotification({
        recipientId: expert.user_id,
        actorId: user.id,
        projectId,
        type: 'project_invite',
        title: 'Вас пригласили в проект',
        body: `Вас пригласили в проект «${project.title}».`,
        href: '/profile',
        payload: {
          listing_id: projectId,
          listing_title: project.title,
          invited_from: 'experts_catalog',
          repeated,
        },
      })

      setSelectedProjectByExpert((prev) => ({
        ...prev,
        [expert.user_id]: '',
      }))
      showAppMessage(
        `${expert.display_name || 'Эксперт'} приглашён в проект «${project.title}».`,
        'success'
      )
    } catch (error) {
      showAppError(error, 'Не удалось пригласить эксперта.', 'Приглашение из каталога экспертов')
    } finally {
      setInvitingExpertId(null)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Загрузка экспертов...</div>

  return (
    <div className="max-w-6xl mx-auto py-12 px-4">
      <div className="text-center mb-8"><h1 className="text-3xl font-bold mb-3">Эксперты</h1><p className="text-gray-600 max-w-2xl mx-auto">Каталог специалистов платформы. Ищи людей по ролям, навыкам, городу, формату работы и уровню опыта.</p></div>
      <div className="border rounded-xl bg-white p-5 shadow-sm mb-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">Поиск</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, роль, навык, город, портфолио..." className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <FilterSelect label="Роль" value={roleFilter} onChange={setRoleFilter} options={allRoles} empty="Все роли" />
          <FilterSelect label="Навык" value={skillFilter} onChange={setSkillFilter} options={allSkills} empty="Все навыки" />
          <FilterSelect label="Город" value={cityFilter} onChange={setCityFilter} options={allCities} empty="Все города" />
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Формат</label><select value={workFormatFilter} onChange={(e) => setWorkFormatFilter(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white"><option value="">Любой</option><option value="remote">Удалённо</option><option value="onsite">Очно</option><option value="hybrid">Гибрид</option></select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Уровень</label><select value={experienceFilter} onChange={(e) => setExperienceFilter(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white"><option value="">Любой</option><option value="junior">Junior</option><option value="middle">Middle</option><option value="senior">Senior</option><option value="expert">Expert</option></select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Мин. ч/нед</label><input type="number" min="0" value={minAvailability} onChange={(e) => setMinAvailability(e.target.value)} placeholder="Напр. 5" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        </div>
        <div className="mt-4 flex justify-end"><button onClick={resetFilters} className="text-sm text-gray-600 hover:text-blue-700 transition">Сбросить фильтры</button></div>
      </div>
      <div className="flex items-center justify-between gap-4 mb-5"><div className="text-sm text-gray-500">Найдено: <b>{filteredExperts.length}</b></div>{user && ownedProjects.length === 0 && <Link href="/listings/new" className="text-sm text-blue-600 hover:underline">Создать проект, чтобы приглашать экспертов</Link>}</div>
      {filteredExperts.length === 0 ? <div className="border rounded-xl bg-white p-8 text-center text-gray-500">По текущим фильтрам эксперты не найдены.</div> : (
        <div className="grid gap-6 md:grid-cols-2">{filteredExperts.map((expert) => {
          const roles = toList(expert.roles); const skills = toList(expert.skills); const portfolioLinks = toList(expert.portfolio_links); const canInvite = Boolean(user?.id && ownedProjects.length > 0); const selectedProjectId = selectedProjectByExpert[expert.user_id] || ''; const ratingStats = reviewStatsByUserId[expert.user_id]
          return <div key={expert.user_id} className="border rounded-xl shadow-sm p-6 hover:shadow-md transition bg-white">
            <div className="flex items-start justify-between gap-4 mb-4"><div><h2 className="text-xl font-semibold">{expert.display_name || 'Без имени'}</h2><div className="text-sm text-yellow-600 font-semibold mt-1">{formatRating(ratingStats)}</div><p className="text-sm text-gray-500 mt-1">{expert.city || 'Город не указан'} · {expert.work_format ? workFormatLabel[expert.work_format] : 'формат не указан'} · {expert.experience_level ? experienceLabel[expert.experience_level] : 'уровень не указан'}</p><p className="text-xs text-gray-400 mt-1">{expert.timezone || 'часовой пояс не указан'} · {expert.availability_hours ?? 0} ч/нед{expert.hourly_rate ? ` · ${expert.hourly_rate} ₽/час` : ''}</p></div><Link href={`/users/${expert.user_id}`} className="text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 transition whitespace-nowrap">Профиль</Link></div>
            {expert.about && <p className="text-sm text-gray-700 mb-4 line-clamp-3">{expert.about}</p>}
            <TagBlock title="Роли" items={roles} tone="blue" />
            <TagBlock title="Навыки" items={skills.slice(0, 12)} />
            {skills.length > 12 && <div className="text-xs text-gray-500 mt-1">+{skills.length - 12} навыков в профиле</div>}
            {portfolioLinks.length > 0 && <div className="mt-4"><div className="text-xs uppercase tracking-wide text-gray-400 mb-1">Портфолио</div><a href={normalizeUrl(portfolioLinks[0])} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline break-all">{portfolioLinks[0]}</a></div>}
            {canInvite && <div className="mt-5 border-t pt-4"><div className="flex flex-col gap-2 sm:flex-row"><select value={selectedProjectId} onChange={(e) => setSelectedProjectByExpert((prev) => ({ ...prev, [expert.user_id]: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm bg-white flex-1"><option value="">Пригласить в проект...</option>{ownedProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button onClick={() => handleInvite(expert)} disabled={invitingExpertId === expert.user_id} className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-60">{invitingExpertId === expert.user_id ? 'Приглашаем...' : 'Пригласить'}</button></div></div>}
          </div>
        })}</div>
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, empty }: { label: string; value: string; onChange: (value: string) => void; options: string[]; empty: string }) {
  return <div><label className="block text-sm font-medium text-gray-700 mb-1">{label}</label><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white"><option value="">{empty}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
}

function TagBlock({ title, items, tone = 'gray' }: { title: string; items: string[]; tone?: 'blue' | 'gray' }) {
  const className = tone === 'blue' ? 'text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full' : 'text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full'
  return <div className="mt-3"><div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{title}</div>{items.length === 0 ? <div className="text-sm text-gray-500">—</div> : <div className="flex flex-wrap gap-2">{items.map((item) => <span key={item} className={className}>{item}</span>)}</div>}</div>
}