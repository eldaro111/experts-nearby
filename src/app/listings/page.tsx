'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()

  const [listings, setListings] = useState<Listing[]>([])
  const [filtered, setFiltered] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)

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
    const fetchListings = async () => {
      const { data, error } = await supabase
        .from('listings_with_count')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        logAppError('Ошибка загрузки:', error)
      } else {
        setListings(data || [])
        setFiltered(data || [])
      }

      setLoading(false)
    }

    fetchListings()
  }, [])

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


  if (loading) {
    return <div className="text-center py-12">Загрузка...</div>
  }

  return (
    <div className="max-w-5xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-6 text-center">Лента проектов</h1>

      <div className="bg-gray-50 border rounded-lg p-4 mb-8">
        <h2 className="font-semibold mb-2">Фильтр по параметрам:</h2>

        <div className="grid md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Поиск по названию или описанию"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="border rounded p-2 w-full"
          />

          <input
            type="text"
            placeholder="Роль (например, инженер)"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="border rounded p-2 w-full"
          />

          <input
            type="text"
            placeholder="Навык (например, CAD)"
            value={skillFilter}
            onChange={(e) => setSkillFilter(e.target.value)}
            className="border rounded p-2 w-full"
          />

          <input
            type="text"
            placeholder="Часовой пояс (например, UTC+3)"
            value={tzFilter}
            onChange={(e) => setTzFilter(e.target.value)}
            className="border rounded p-2 w-full"
          />
        </div>

        <div className="text-right mt-3">
          <button
            onClick={() => {
              setSearchFilter('')
              setRoleFilter('')
              setSkillFilter('')
              setTzFilter('')
              setFiltered(listings)
            }}
            className="text-sm text-gray-600 hover:text-gray-900 transition"
          >
            Сбросить фильтры
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-gray-500">
          Проекты не найдены по выбранным фильтрам.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="border rounded-lg shadow-sm p-6 hover:shadow-md transition bg-white"
            >
              <h2 className="text-xl font-semibold mb-2">{item.title}</h2>
              <p className="text-gray-700 mb-4">{item.description}</p>

              <div className="text-sm text-gray-500 mb-1">
                <b>Роли:</b>{' '}
                {Array.isArray(item.roles_needed)
                  ? item.roles_needed.join(', ')
                  : item.roles_needed}
              </div>

              <div className="text-sm text-gray-500 mb-1">
                <b>Навыки:</b>{' '}
                {Array.isArray(item.skills)
                  ? item.skills.join(', ')
                  : item.skills}
              </div>

              <div className="text-sm text-gray-500">
                <b>Часовой пояс:</b> {item.timezone || '—'}
              </div>

              <div className="text-xs text-gray-400 mt-3 mb-2">
                Опубликовано:{' '}
                {new Date(item.created_at)
                  .toISOString()
                  .slice(0, 19)
                  .replace('T', ' ')}
              </div>

              <div className="text-xs text-gray-400 mb-4">
                💬 {item.applications_count || 0} откликов
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => router.push(`/listings/${item.id}`)}
                  className="bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded hover:bg-gray-300 transition"
                >
                  Подробнее
                </button>

                <button
                  onClick={() => handleApply(item)}
                  disabled={
                    applyingListingId !== null ||
                    appliedListingIds.includes(item.id)
                  }
                  className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {applyingListingId === item.id
                    ? 'Отправляем...'
                    : appliedListingIds.includes(item.id)
                      ? 'Отклик отправлен'
                      : 'Откликнуться'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
