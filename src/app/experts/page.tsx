'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowUpRight, MapPin, Clock3, SlidersHorizontal, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
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
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
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
      setLoadError(false)
      try {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user || null)
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles_public')
        .select('user_id, display_name, roles, skills, timezone, availability_hours, city, work_format, experience_level, hourly_rate, portfolio_links, about, visibility')
        .order('display_name', { ascending: true })
      if (profilesError) { logAppError('Ошибка загрузки экспертов:', profilesError); setLoadError(true); setExperts([]) } else setExperts((profilesData || []) as Profile[])

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
      } catch (error) {
        logAppError('Ошибка загрузки каталога:', error)
        setLoadError(true)
      } finally { setLoading(false) }
    }
    void fetchData()
  }, [loadAttempt])

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

  if (loading) return <PageLoading label="Загружаем каталог экспертов…" />

  const hasFilters = Boolean(query || roleFilter || skillFilter || cityFilter || workFormatFilter || experienceFilter || minAvailability)

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Люди, которые знают как" title="Эксперты под вашу задачу" description="Подберите специалиста по навыкам, опыту и формату работы. Посмотрите профиль и пригласите в проект.">
        <Button asChild variant="outline" className="action-secondary"><Link href="/profile"><UserPlus size={18} />Мой профиль эксперта</Link></Button>
      </PageHeader>
      <section className="filter-panel" aria-label="Фильтры экспертов">
        <div className="flex items-center gap-2 text-sm font-semibold mb-4"><SlidersHorizontal size={17} className="text-blue-600" />Подобрать специалиста</div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2"><label htmlFor="expert-query" className="filter-label">Поиск</label><input id="expert-query" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, специализация или навык" className="w-full" /></div>
          <FilterSelect label="Роль" value={roleFilter} onChange={setRoleFilter} options={allRoles} empty="Все роли" />
          <FilterSelect label="Навык" value={skillFilter} onChange={setSkillFilter} options={allSkills} empty="Все навыки" />
          <FilterSelect label="Город" value={cityFilter} onChange={setCityFilter} options={allCities} empty="Все города" />
          <div><label htmlFor="expert-format" className="filter-label">Формат работы</label><select id="expert-format" value={workFormatFilter} onChange={(e) => setWorkFormatFilter(e.target.value)} className="w-full"><option value="">Любой формат</option><option value="remote">Удалённо</option><option value="onsite">Очно</option><option value="hybrid">Гибрид</option></select></div>
          <div><label htmlFor="expert-level" className="filter-label">Уровень опыта</label><select id="expert-level" value={experienceFilter} onChange={(e) => setExperienceFilter(e.target.value)} className="w-full"><option value="">Любой уровень</option><option value="junior">Junior</option><option value="middle">Middle</option><option value="senior">Senior</option><option value="expert">Expert</option></select></div>
          <div><label htmlFor="expert-hours" className="filter-label">Минимум часов в неделю</label><input id="expert-hours" type="number" min="0" value={minAvailability} onChange={(e) => setMinAvailability(e.target.value)} placeholder="Например, 10" className="w-full" /></div>
        </div>
      </section>
      <div className="results-bar"><p aria-live="polite">{loadError ? 'Каталог недоступен' : <>Найдено специалистов: <strong className="text-slate-900">{filteredExperts.length}</strong></>}</p><button onClick={resetFilters} disabled={!hasFilters} className="text-blue-700 disabled:text-gray-400 disabled:opacity-60 min-h-11">Сбросить фильтры</button></div>
      {user && ownedProjects.length === 0 && <Link href="/listings/new" className="mb-5 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800">Создайте проект, чтобы приглашать экспертов<ArrowUpRight size={17} /></Link>}
      {loadError ? <EmptyState title="Не удалось загрузить экспертов" description="Проверьте подключение и попробуйте ещё раз."><Button className="action-primary" onClick={() => setLoadAttempt((value) => value + 1)}>Повторить загрузку</Button></EmptyState> : filteredExperts.length === 0 ? <EmptyState title={hasFilters ? 'Подходящих специалистов пока нет' : 'Профили специалистов появятся здесь'} description={hasFilters ? 'Попробуйте изменить запрос или убрать часть фильтров.' : 'Заполните свой профиль, чтобы другие участники могли найти вас.'}>{hasFilters && <Button variant="outline" onClick={resetFilters}>Сбросить фильтры</Button>}</EmptyState> : (
        <div className="grid gap-5 md:grid-cols-2">{filteredExperts.map((expert) => {
          const roles = toList(expert.roles)
          const skills = toList(expert.skills)
          const portfolioLinks = toList(expert.portfolio_links)
          const canInvite = Boolean(user?.id && ownedProjects.length > 0)
          const selectedProjectId = selectedProjectByExpert[expert.user_id] || ''
          const ratingStats = reviewStatsByUserId[expert.user_id]
          const initials = (expert.display_name || 'Э').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
          return <article key={expert.user_id} className="expert-card">
            <div className="flex items-start gap-3 mb-4">
              <span className="expert-avatar" aria-hidden="true">{initials}</span>
              <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold"><Link href={`/users/${expert.user_id}`}>{expert.display_name || 'Имя не указано'}</Link></h2><p className="text-sm text-gray-500 mt-1">{expert.experience_level ? experienceLabel[expert.experience_level] : 'Уровень не указан'}{expert.work_format ? ` · ${workFormatLabel[expert.work_format]}` : ''}</p></div>
              <span className="text-sm font-semibold text-amber-700 shrink-0">{formatRating(ratingStats)}</span>
            </div>
            <div className="card-meta mb-4"><span><MapPin size={15} />{expert.city || 'Город не указан'}</span><span><Clock3 size={15} />{expert.availability_hours ?? 0} ч/нед</span><span>{expert.timezone || 'Часовой пояс не указан'}</span></div>
            {expert.about && <p className="text-gray-600 mb-4 leading-7 line-clamp-3">{expert.about}</p>}
            <TagBlock title="Специализация" items={roles} tone="blue" />
            <TagBlock title="Навыки" items={skills.slice(0, 12)} />
            {skills.length > 12 && <p className="text-xs text-gray-500 mt-2">Ещё {skills.length - 12} навыков в профиле</p>}
            {portfolioLinks.length > 0 && <div className="mt-4"><a href={normalizeUrl(portfolioLinks[0])} target="_blank" rel="noopener noreferrer" className="text-link text-sm break-all">Портфолио<ArrowUpRight size={16} /></a></div>}
            <div className="flex items-center justify-between flex-wrap gap-3 mt-auto pt-5"><p className="text-sm font-semibold">{expert.hourly_rate ? `${Number(expert.hourly_rate).toLocaleString('ru-RU')} ₽ / час` : 'Ставка не указана'}</p><Button asChild variant="outline" className="min-h-11"><Link href={`/users/${expert.user_id}`}>Посмотреть профиль<ArrowUpRight size={16} /></Link></Button></div>
            {canInvite && <div className="mt-5 border-t pt-4"><label htmlFor={`invite-${expert.user_id}`} className="filter-label">Пригласить к работе</label><div className="flex flex-col gap-2 sm:flex-row"><select id={`invite-${expert.user_id}`} value={selectedProjectId} onChange={(e) => setSelectedProjectByExpert((prev) => ({ ...prev, [expert.user_id]: e.target.value }))} className="flex-1 min-w-0 w-full"><option value="">Выберите проект</option>{ownedProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><Button onClick={() => handleInvite(expert)} disabled={invitingExpertId !== null || !selectedProjectId} className="min-h-11">{invitingExpertId === expert.user_id ? 'Приглашаем…' : 'Пригласить'}</Button></div></div>}
          </article>
        })}</div>
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, empty }: { label: string; value: string; onChange: (value: string) => void; options: string[]; empty: string }) {
  const id = useId()
  return <div><label htmlFor={id} className="filter-label">{label}</label><select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full"><option value="">{empty}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
}

function TagBlock({ title, items, tone = 'gray' }: { title: string; items: string[]; tone?: 'blue' | 'gray' }) {
  return <div className="mt-3"><p className="text-sm font-medium text-gray-700 mb-2">{title}</p>{items.length === 0 ? <p className="text-sm text-gray-500">Не указаны</p> : <div className="flex flex-wrap gap-2">{items.map((item) => <span key={item} className={`skill-tag ${tone === 'blue' ? 'bg-blue-50 text-blue-700' : ''}`}>{item}</span>)}</div>}</div>
}
