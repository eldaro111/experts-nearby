'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import type { AuctionType } from '@/components/auction/types'

const splitList = (value: string) =>
  value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

const toIsoOrNull = (value: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const parseLinks = (value: string) => {
  return value
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}


interface MyListingOption {
  id: string
  title: string
  created_at: string
}

export default function NewAuctionPage() {
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  const [saving, setSaving] = useState(false)
  const [myListings, setMyListings] = useState<MyListingOption[]>([])
  const [loadingListings, setLoadingListings] = useState(false)

  const [type, setType] = useState<AuctionType>('request')
  const [title, setTitle] = useState('')
  const [publicSummary, setPublicSummary] = useState('')
  const [publicDescription, setPublicDescription] = useState('')
  const [category, setCategory] = useState('')
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [currency, setCurrency] = useState('RUB')
  const [endsAt, setEndsAt] = useState('')

  const [requiredRoles, setRequiredRoles] = useState('')
  const [requiredSkills, setRequiredSkills] = useState('')
  const [expectedResult, setExpectedResult] = useState('')
  const [selectionCriteria, setSelectionCriteria] = useState('')

  const [dealType, setDealType] = useState('')
  const [readinessLevel, setReadinessLevel] = useState('')
  const [implementationNeeds, setImplementationNeeds] = useState('')
  const [ndaRequired, setNdaRequired] = useState(false)
  const [ipMode, setIpMode] = useState('')
  const [linkedListingId, setLinkedListingId] = useState('')
  const [protectedDescription, setProtectedDescription] = useState('')
  const [protectedLinks, setProtectedLinks] = useState('')

  const isOffer = type === 'offer'

  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/auth')
        return
      }

      setUserId(user.id)

      setLoadingListings(true)
      const { data: listingsData, error: listingsError } = await supabase
        .from('listings')
        .select('id, title, created_at')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })

      if (listingsError) {
        logAppError('Ошибка загрузки моих проектов:', listingsError)
        setMyListings([])
      } else {
        setMyListings((listingsData || []) as MyListingOption[])
      }

      setLoadingListings(false)
      setLoadingUser(false)
    }

    init()
  }, [router])

  const submitDisabled = useMemo(() => {
    return saving || !userId || !title.trim()
  }, [saving, userId, title])

  const handleCreateAuction = async (e: React.FormEvent) => {
    e.preventDefault()

    if (saving) return

    if (!userId) {
      showAppMessage('Пользователь не найден. Войдите в аккаунт повторно.', 'warning')
      return
    }

    const cleanTitle = title.trim()
    if (!cleanTitle) {
      showAppMessage('Введите название аукциона.', 'warning')
      return
    }

    setSaving(true)

    try {
      const { data: auctionData, error: auctionError } = await supabase
        .from('auctions')
        .insert([
          {
            owner_id: userId,
            type,
            title: cleanTitle,
            public_summary: publicSummary.trim() || null,
            public_description: publicDescription.trim() || null,
            category: category.trim() || null,
            budget_min: budgetMin ? Number(budgetMin) : null,
            budget_max: budgetMax ? Number(budgetMax) : null,
            currency: currency.trim() || 'RUB',
            ends_at: toIsoOrNull(endsAt),
            required_roles: type === 'request' ? splitList(requiredRoles) : [],
            required_skills: type === 'request' ? splitList(requiredSkills) : [],
            expected_result: type === 'request' ? expectedResult.trim() || null : null,
            selection_criteria: type === 'request' ? selectionCriteria.trim() || null : null,
            deal_type: isOffer ? dealType.trim() || null : null,
            readiness_level: isOffer ? readinessLevel.trim() || null : null,
            implementation_needs: isOffer ? implementationNeeds.trim() || null : null,
            nda_required: ndaRequired,
            ip_mode: ipMode.trim() || null,
            linked_listing_id:
              isOffer && linkedListingId.trim()
                ? linkedListingId.trim()
                : null,
            status: 'open',
          },
        ])
        .select('id')
        .single()

      if (auctionError || !auctionData) {
        showAppError(
          auctionError,
          'Не удалось создать аукцион.',
          'Создание аукциона'
        )
        return
      }

      if (isOffer && (protectedDescription.trim() || protectedLinks.trim())) {
        const { error: protectedError } = await supabase
          .from('auction_protected')
          .insert([
            {
              auction_id: auctionData.id,
              protected_description: protectedDescription.trim() || null,
              protected_links: parseLinks(protectedLinks),
            },
          ])

        if (protectedError) {
          logAppError('Ошибка сохранения закрытых материалов', protectedError)
          showAppMessage(
            'Аукцион создан, но закрытые материалы не сохранились. Откройте редактирование аукциона и повторите сохранение.',
            'warning',
            8000
          )
          router.replace(`/auctions/${auctionData.id}/edit`)
          return
        }
      }

      showAppMessage('Аукцион создан.', 'success')
      router.replace(`/auctions/${auctionData.id}`)
    } catch (error) {
      showAppError(error, 'Не удалось создать аукцион.', 'Создание аукциона')
    } finally {
      setSaving(false)
    }
  }

  if (loadingUser) {
    return <div className="text-center py-12 text-gray-500">Проверяем вход...</div>
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold mb-2">Создать аукцион</h1>
      <p className="text-gray-600 mb-8">
        Выберите тип: заказ на разработку или проект для внедрения/лицензирования.
      </p>

      <form onSubmit={handleCreateAuction} className="space-y-6">
        <div className="border rounded-xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Тип аукциона</h2>

          <div className="grid md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setType('request')}
              className={`border rounded-lg p-4 text-left transition ${type === 'request' ? 'border-blue-600 bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
            >
              <div className="font-semibold">Заказ на разработку</div>
              <div className="text-sm text-gray-600 mt-1">
                Нужна команда/эксперт, который выполнит задачу.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setType('offer')}
              className={`border rounded-lg p-4 text-left transition ${type === 'offer' ? 'border-purple-600 bg-purple-50' : 'bg-white hover:bg-gray-50'}`}
            >
              <div className="font-semibold">Проект для внедрения</div>
              <div className="text-sm text-gray-600 mt-1">
                Есть разработка/прототип, ищем производство, покупателя или партнёра.
              </div>
            </button>
          </div>
        </div>

        <div className="border rounded-xl bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Публичная часть</h2>

          <input
            type="text"
            placeholder="Название"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border rounded p-2 w-full"
            required
          />

          <input
            type="text"
            placeholder="Краткое описание"
            value={publicSummary}
            onChange={(e) => setPublicSummary(e.target.value)}
            className="border rounded p-2 w-full"
          />

          <textarea
            placeholder="Публичное описание"
            value={publicDescription}
            onChange={(e) => setPublicDescription(e.target.value)}
            className="border rounded p-2 w-full min-h-[140px]"
          />

          <div className="grid md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Категория: CAD, робототехника, медицина..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border rounded p-2 w-full"
            />

            <input
              type="text"
              placeholder="Валюта"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="border rounded p-2 w-full"
            />
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <input
              type="number"
              min="0"
              placeholder={isOffer ? 'Ожидаемая сумма от' : 'Бюджет от'}
              value={budgetMin}
              onChange={(e) => setBudgetMin(e.target.value)}
              className="border rounded p-2 w-full"
            />

            <input
              type="number"
              min="0"
              placeholder={isOffer ? 'Ожидаемая сумма до' : 'Бюджет до'}
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
              className="border rounded p-2 w-full"
            />

            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="border rounded p-2 w-full"
            />
          </div>
        </div>

        {type === 'request' ? (
          <div className="border rounded-xl bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Заказ на разработку</h2>

            <input
              type="text"
              placeholder="Нужные роли через запятую"
              value={requiredRoles}
              onChange={(e) => setRequiredRoles(e.target.value)}
              className="border rounded p-2 w-full"
            />

            <input
              type="text"
              placeholder="Нужные навыки через запятую"
              value={requiredSkills}
              onChange={(e) => setRequiredSkills(e.target.value)}
              className="border rounded p-2 w-full"
            />

            <textarea
              placeholder="Ожидаемый результат"
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              className="border rounded p-2 w-full min-h-[100px]"
            />

            <textarea
              placeholder="Критерии выбора исполнителя / команды"
              value={selectionCriteria}
              onChange={(e) => setSelectionCriteria(e.target.value)}
              className="border rounded p-2 w-full min-h-[100px]"
            />
          </div>
        ) : (
          <div className="border rounded-xl bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Проект для внедрения</h2>

            <div className="grid md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Тип сделки: license, pilot, partnership..."
                value={dealType}
                onChange={(e) => setDealType(e.target.value)}
                className="border rounded p-2 w-full"
              />

              <input
                type="text"
                placeholder="Готовность: idea, prototype, mvp, production"
                value={readinessLevel}
                onChange={(e) => setReadinessLevel(e.target.value)}
                className="border rounded p-2 w-full"
              />
            </div>

            <input
              type="text"
              placeholder="IP-режим / права"
              value={ipMode}
              onChange={(e) => setIpMode(e.target.value)}
              className="border rounded p-2 w-full"
            />

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Связанный проект
              </label>

              <select
                value={linkedListingId}
                onChange={(e) => setLinkedListingId(e.target.value)}
                className="border rounded p-2 w-full bg-white"
                disabled={loadingListings}
              >
                <option value="">Без привязки к проекту</option>
                {myListings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.title || 'Без названия'}
                  </option>
                ))}
              </select>

              <p className="text-xs text-gray-500 mt-1">
                Для готового проекта можно привязать уже созданный листинг/проект.
              </p>
            </div>

            <textarea
              placeholder="Что требуется от производства / партнёра"
              value={implementationNeeds}
              onChange={(e) => setImplementationNeeds(e.target.value)}
              className="border rounded p-2 w-full min-h-[100px]"
            />

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={ndaRequired}
                onChange={(e) => setNdaRequired(e.target.checked)}
              />
              Требуется NDA / подтверждение доступа к закрытым материалам
            </label>

            <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
              <h3 className="font-semibold">Закрытая часть offer-аукциона</h3>
              <p className="text-sm text-gray-600">
                Эти данные будут лежать отдельно в auction_protected и не должны попадать в публичный fetch.
              </p>

              <textarea
                placeholder="Закрытое описание: детали технологии, материалы, риски, ссылки на приватные документы"
                value={protectedDescription}
                onChange={(e) => setProtectedDescription(e.target.value)}
                className="border rounded p-2 w-full min-h-[140px] bg-white"
              />

              <textarea
                placeholder="Закрытые ссылки, каждая с новой строки"
                value={protectedLinks}
                onChange={(e) => setProtectedLinks(e.target.value)}
                className="border rounded p-2 w-full min-h-[90px] bg-white"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push('/auctions')}
            className="border px-4 py-2 rounded hover:bg-gray-50 transition"
          >
            Отмена
          </button>

          <button
            type="submit"
            disabled={submitDisabled}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {saving ? 'Создаём...' : 'Создать аукцион'}
          </button>
        </div>
      </form>
    </div>
  )
}