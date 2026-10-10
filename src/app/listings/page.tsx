'use client'

import { UiText } from '@/components/LocaleProvider'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Clock3, MessageSquare, Plus, SlidersHorizontal, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'

interface Listing {
  id: string
  title: string
  description: string
  roles_needed: string[] | string
  skills: string[] | string
  timezone: string
  created_at: string
  applications_count?: number
}

function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debounced
}

export default function ListingsPage() {

  const [listings, setListings] = useState<Listing[]>([])
  const [filtered, setFiltered] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [searchFilter, setSearchFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [tzFilter, setTzFilter] = useState('')
  const [applyingListingId, setApplyingListingId] = useState<string | null>(null)
  const [appliedListingIds, setAppliedListingIds] = useState<string[]>([])

  const debouncedSearch = useDebounce(searchFilter)
  const debouncedRole = useDebounce(roleFilter)
  const debouncedSkill = useDebounce(skillFilter)
  const debouncedTz = useDebounce(tzFilter)

  useEffect(() => {
    let active = true
    const fetchListings = async () => {
      setLoading(true)
      setLoadError(false)
      try {
        const { data, error } = await supabase
          .from('listings_with_count')
          .select('*')
          .is('completed_at', null)
          .order('created_at', { ascending: false })
        if (error) throw error
        if (active) { setListings(data || []); setFiltered(data || []) }
      } catch (error) {
        logAppError('Ошибка загрузки проектов:', error)
        if (active) setLoadError(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    void fetchListings()
    return () => { active = false }
  }, [loadAttempt])

  useEffect(() => {
    let result = listings

    const normalizeArray = (value: any): string[] => {
      if (!value) return []

      if (Array.isArray(value)) {
        return value
          .flat(Infinity)
          .filter((v) => typeof v === 'string' && v.trim() !== '')
          .map((v) => v.trim().toLowerCase())
      }

      if (typeof value === 'string') {
        return value
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v.length > 0)
      }

      return []
    }

    const searchQuery = debouncedSearch.trim().toLowerCase()
    const roleQuery = debouncedRole.trim().toLowerCase()
    const skillQuery = debouncedSkill.trim().toLowerCase()
    const tzQuery = debouncedTz.trim().toLowerCase()

    if (searchQuery) {
      result = result.filter(
        (l) =>
          (l.title && l.title.toLowerCase().includes(searchQuery)) ||
          (l.description && l.description.toLowerCase().includes(searchQuery))
      )
    }

    if (roleQuery) {
      result = result.filter((l) => {
        const roles = normalizeArray(l.roles_needed)
        return roles.some((r) => r.includes(roleQuery))
      })
    }

    if (skillQuery) {
      result = result.filter((l) => {
        const skills = normalizeArray(l.skills)
        return skills.some((s) => s.includes(skillQuery))
      })
    }

    if (tzQuery) {
      result = result.filter(
        (l) =>
          typeof l.timezone === 'string' &&
          l.timezone.toLowerCase().includes(tzQuery)
      )
    }

    setFiltered(result)
  }, [debouncedSearch, debouncedRole, debouncedSkill, debouncedTz, listings])

 const handleApply = async (item: Listing) => {
  if (applyingListingId) return

  setApplyingListingId(item.id)

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError) {
      showAppError(userError, 'Не удалось проверить авторизацию.', 'Проверка авторизации перед откликом')
      return
    }

    if (!user) {
      showAppMessage('Пожалуйста, войдите в систему, чтобы откликнуться.', 'warning')
      return
    }

    const { data: existing, error: existingError } = await supabase
      .from('applications')
      .select('id, status, invited_by_author')
      .eq('listing_id', item.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingError) {
      showAppError(existingError, 'Не удалось проверить текущий отклик.', 'Проверка отклика')
      return
    }

    if (existing) {
      if (existing.status === 'pending') {
        showAppMessage(
          existing.invited_by_author
            ? 'Вас уже пригласили в этот проект. Проверьте приглашения в профиле.'
            : 'Вы уже откликались на этот проект.',
          'info'
        )
        setAppliedListingIds((items) =>
          items.includes(item.id) ? items : [...items, item.id]
        )
        return
      }

      if (existing.status === 'accepted') {
        showAppMessage('Вы уже участвуете в этом проекте.', 'info')
        setAppliedListingIds((items) =>
          items.includes(item.id) ? items : [...items, item.id]
        )
        return
      }

      const { error: updateError } = await supabase
        .from('applications')
        .update({
          status: 'pending',
          invited_by_author: false,
        })
        .eq('id', existing.id)

      if (updateError) {
        showAppError(updateError, 'Не удалось отправить повторный отклик.', 'Повторный отклик')
        return
      }

      setAppliedListingIds((items) =>
        items.includes(item.id) ? items : [...items, item.id]
      )
      showAppMessage(`Вы снова откликнулись на проект «${item.title}».`, 'success')
      return
    }

    const { error } = await supabase.from('applications').insert([
      {
        listing_id: item.id,
        user_id: user.id,
        status: 'pending',
        invited_by_author: false,
      },
    ])

    if (error) {
      showAppError(error, 'Не удалось откликнуться на проект.', 'Создание отклика')
      return
    }

    setAppliedListingIds((items) =>
      items.includes(item.id) ? items : [...items, item.id]
    )
    showAppMessage(`Вы откликнулись на проект «${item.title}».`, 'success')
  } catch (error) {
    showAppError(error, 'Не удалось откликнуться на проект.', 'Неожиданная ошибка при отклике')
  } finally {
    setApplyingListingId(null)
  }
}


  const resetFilters = () => {
    setSearchFilter(''); setRoleFilter(''); setSkillFilter(''); setTzFilter('')
  }
  const hasFilters = Boolean(searchFilter || roleFilter || skillFilter || tzFilter)
  const tags = (value: string[] | string) => Array.isArray(value) ? value : (value || '').split(',').map((item) => item.trim()).filter(Boolean)

  if (loading) return <PageLoading label="Загружаем проекты…" />

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Возможности для совместной работы" title="Найдите свой следующий проект" description="Инженерные задачи и команды, которым нужен ваш опыт.">
        <Button asChild className="action-primary"><Link href="/listings/new"><Plus size={18} /><UiText text={"Создать проект"}/></Link></Button>
      </PageHeader>
      <section className="filter-panel" aria-label="Фильтры проектов">
        <div className="flex items-center gap-2 text-sm font-semibold mb-4"><SlidersHorizontal size={17} className="text-blue-600" />Подобрать проект</div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div><label htmlFor="project-query" className="filter-label">Название или описание</label><Input id="project-query" type="search" placeholder="Что вам интересно?" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} /></div>
          <div><label htmlFor="project-role" className="filter-label">Ваша роль</label><Input id="project-role" placeholder="Например, инженер" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} /></div>
          <div><label htmlFor="project-skill" className="filter-label">Навык</label><Input id="project-skill" placeholder="Например, CAD" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} /></div>
          <div><label htmlFor="project-timezone" className="filter-label"><UiText text={"Часовой пояс"}/></label><Input id="project-timezone" placeholder="Например, UTC+3" value={tzFilter} onChange={(e) => setTzFilter(e.target.value)} /></div>
        </div>
      </section>
      <div className="results-bar"><p aria-live="polite">{loadError ? 'Проекты недоступны' : <><UiText text={"Найдено проектов:"}/><strong className="text-slate-900">{filtered.length}</strong></>}</p><button onClick={resetFilters} disabled={!hasFilters} className="text-blue-700 disabled:text-gray-400 disabled:opacity-60 min-h-11"><UiText text={"Сбросить фильтры"}/></button></div>
      {loadError ? <EmptyState title="Не удалось загрузить проекты" description="Проверьте подключение и попробуйте ещё раз."><Button onClick={() => setLoadAttempt((value) => value + 1)} className="action-primary">Повторить загрузку</Button></EmptyState> : filtered.length === 0 ? <EmptyState title={hasFilters ? 'По этим параметрам проектов нет' : 'Новые проекты появятся здесь'} description={hasFilters ? 'Измените запрос или уберите часть фильтров.' : 'Создайте проект и пригласите специалистов к совместной работе.'}>{hasFilters ? <Button variant="outline" onClick={resetFilters}><UiText text={"Сбросить фильтры"}/></Button> : <Link href="/listings/new" className="text-link">Создать первый проект<Plus size={17} /></Link>}</EmptyState> : (
        <div className="grid gap-5 md:grid-cols-2">
          {filtered.map((item) => (
            <article key={item.id} className="listing-card">
              <div className="card-meta mb-4"><span>Инженерный проект</span><span className="ml-auto"><Clock3 size={14} />{new Date(item.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></div>
              <h2><Link href={`/listings/${item.id}`}>{item.title}</Link></h2>
              <p className="text-gray-600 leading-7 mb-5 line-clamp-3">{item.description}</p>
              <div className="mb-4"><p className="text-sm font-medium text-gray-700 mb-2">Нужны в команду</p><div className="flex flex-wrap gap-2">{tags(item.roles_needed).length ? tags(item.roles_needed).map((role, index) => <span className="skill-tag bg-blue-50 text-blue-700" key={`${role}-${index}`}>{role}</span>) : <span className="text-sm text-gray-500">Роли уточняются</span>}</div></div>
              {tags(item.skills).length > 0 && <div className="flex flex-wrap gap-2 mb-5">{tags(item.skills).slice(0, 8).map((skill, index) => <span key={`${skill}-${index}`} className="skill-tag">{skill}</span>)}{tags(item.skills).length > 8 && <span className="skill-tag">+{tags(item.skills).length - 8}</span>}</div>}
              <div className="card-meta border-t pt-4"><span><MessageSquare size={15} />Отклики: {item.applications_count || 0}</span><span><Clock3 size={15} />{item.timezone || 'Часовой пояс не указан'}</span></div>
              <div className="card-actions">
                <Button onClick={() => handleApply(item)} disabled={applyingListingId !== null || appliedListingIds.includes(item.id)} className="min-h-11 rounded-lg">{applyingListingId === item.id ? 'Отправляем…' : appliedListingIds.includes(item.id) ? 'Отклик отправлен' : 'Откликнуться'}</Button>
                <Button asChild variant="outline" className="min-h-11 rounded-lg"><Link href={`/listings/${item.id}`}>О проекте<ArrowUpRight size={16} /></Link></Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
