'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import type { Auction, AuctionProtected } from '@/components/auction/types'

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

const toDateTimeLocal = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

const parseLinks = (value: string) => {
  return value
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

const stringifyProtectedLinks = (links: any[] | null | undefined) => {
  if (!Array.isArray(links)) return ''

  return links
    .map((link) => {
      if (typeof link === 'string') return link
      if (link && typeof link === 'object') {
        if (typeof link.url === 'string') return link.url
        if (typeof link.href === 'string') return link.href
        return JSON.stringify(link)
      }
      return String(link)
    })
    .filter(Boolean)
    .join('\n')
}

const auctionTypeLabel = (type: Auction['type']) => {
  return type === 'offer' ? 'Проект для внедрения' : 'Заказ на разработку'
}

interface MyListingOption {
  id: string
  title: string
  created_at: string
}

export default function EditAuctionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [auction, setAuction] = useState<Auction | null>(null)
  const [protectedData, setProtectedData] = useState<AuctionProtected | null>(null)
  const [myListings, setMyListings] = useState<MyListingOption[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingListings, setLoadingListings] = useState(false)

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

  const isOwner = Boolean(userId && auction && userId === auction.owner_id)
  const isOffer = auction?.type === 'offer'
  const canEdit = Boolean(isOwner && auction && ['draft', 'open'].includes(auction.status))

  const submitDisabled = useMemo(() => {
    return saving || !canEdit || !title.trim()
  }, [saving, canEdit, title])

  const fillForm = (auctionData: Auction, protectedRow: AuctionProtected | null) => {
    setTitle(auctionData.title || '')
    setPublicSummary(auctionData.public_summary || '')
    setPublicDescription(auctionData.public_description || '')
    setCategory(auctionData.category || '')
    setBudgetMin(auctionData.budget_min === null ? '' : String(auctionData.budget_min))
    setBudgetMax(auctionData.budget_max === null ? '' : String(auctionData.budget_max))
    setCurrency(auctionData.currency || 'RUB')
    setEndsAt(toDateTimeLocal(auctionData.ends_at))

    setRequiredRoles((auctionData.required_roles || []).join(', '))
    setRequiredSkills((auctionData.required_skills || []).join(', '))
    setExpectedResult(auctionData.expected_result || '')
    setSelectionCriteria(auctionData.selection_criteria || '')

    setDealType(auctionData.deal_type || '')
    setReadinessLevel(auctionData.readiness_level || '')
    setImplementationNeeds(auctionData.implementation_needs || '')
    setNdaRequired(Boolean(auctionData.nda_required))
    setIpMode(auctionData.ip_mode || '')
    setLinkedListingId(auctionData.linked_listing_id || '')
    setProtectedDescription(protectedRow?.protected_description || '')
    setProtectedLinks(stringifyProtectedLinks(protectedRow?.protected_links))
  }

  const loadData = async () => {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/auth')
      return
    }

    setUserId(user.id)

    const { data: auctionData, error: auctionError } = await supabase
      .from('auctions')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (auctionError || !auctionData) {
      logAppError('Ошибка загрузки аукциона:', auctionError)
      setAuction(null)
      setLoading(false)
      return
    }

    const loadedAuction = auctionData as Auction
    setAuction(loadedAuction)

    if (loadedAuction.owner_id !== user.id) {
      setLoading(false)
      return
    }

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

    let protectedRow: AuctionProtected | null = null

    if (loadedAuction.type === 'offer') {
      const { data: protectedDataRow, error: protectedError } = await supabase
        .from('auction_protected')
        .select('*')
        .eq('auction_id', id)
        .maybeSingle()

      if (protectedError) {
        logAppError('Ошибка загрузки закрытых материалов:', protectedError)
      } else {
        protectedRow = (protectedDataRow as AuctionProtected) || null
      }
    }

    setProtectedData(protectedRow)
    fillForm(loadedAuction, protectedRow)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()

    if (saving || !auction || !userId) return

    if (!canEdit) {
      showAppMessage(
        'Редактировать можно только свой открытый аукцион или черновик.',
        'warning'
      )
      return
    }

    const cleanTitle = title.trim()
    if (!cleanTitle) {
      showAppMessage('Введите название аукциона.', 'warning')
      return
    }

    setSaving(true)

    try {
      const updatePayload = {
        title: cleanTitle,
        public_summary: publicSummary.trim() || null,
        public_description: publicDescription.trim() || null,
        category: category.trim() || null,
        budget_min: budgetMin ? Number(budgetMin) : null,
        budget_max: budgetMax ? Number(budgetMax) : null,
        currency: currency.trim() || 'RUB',
        ends_at: toIsoOrNull(endsAt),
        required_roles:
          auction.type === 'request' ? splitList(requiredRoles) : [],
        required_skills:
          auction.type === 'request' ? splitList(requiredSkills) : [],
        expected_result:
          auction.type === 'request' ? expectedResult.trim() || null : null,
        selection_criteria:
          auction.type === 'request'
            ? selectionCriteria.trim() || null
            : null,
        deal_type:
          auction.type === 'offer' ? dealType.trim() || null : null,
        readiness_level:
          auction.type === 'offer' ? readinessLevel.trim() || null : null,
        implementation_needs:
          auction.type === 'offer'
            ? implementationNeeds.trim() || null
            : null,
        nda_required: ndaRequired,
        ip_mode: ipMode.trim() || null,
        linked_listing_id:
          auction.type === 'offer' && linkedListingId.trim()
            ? linkedListingId.trim()
            : null,
      }

      const { error: auctionError } = await supabase
        .from('auctions')
        .update(updatePayload)
        .eq('id', auction.id)
        .eq('owner_id', userId)

      if (auctionError) {
        showAppError(
          auctionError,
          'Не удалось сохранить аукцион.',
          'Сохранение аукциона'
        )
        return
      }

      if (auction.type === 'offer') {
        const hasProtectedContent =
          protectedDescription.trim().length > 0 ||
          protectedLinks.trim().length > 0

        if (protectedData || hasProtectedContent) {
          const { error: protectedError } = await supabase
            .from('auction_protected')
            .upsert(
              {
                auction_id: auction.id,
                protected_description:
                  protectedDescription.trim() || null,
                protected_links: parseLinks(protectedLinks),
              },
              { onConflict: 'auction_id' }
            )

          if (protectedError) {
            logAppError(
              'Ошибка сохранения закрытых материалов',
              protectedError
            )
            showAppMessage(
              'Публичная часть сохранена, но закрытые материалы не обновились. Повторите сохранение этой формы.',
              'warning',
              8000
            )
            return
          }
        }
      }

      showAppMessage('Аукцион сохранён.', 'success')
      router.replace(`/auctions/${auction.id}`)
    } catch (error) {
      showAppError(error, 'Не удалось сохранить аукцион.', 'Сохранение аукциона')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Загружаем аукцион...</div>
  }

  if (!auction) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4 text-center">
        <h1 className="text-2xl font-bold mb-3">Аукцион не найден</h1>
        <Link href="/auctions" className="text-blue-600 hover:underline">
          Вернуться к аукционам
        </Link>
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4 text-center">
        <h1 className="text-2xl font-bold mb-3">Нет доступа к редактированию</h1>
        <p className="text-gray-600 mb-5">Редактировать аукцион может только его владелец.</p>
        <Link href={`/auctions/${auction.id}`} className="text-blue-600 hover:underline">
          Вернуться к аукциону
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/auctions/${auction.id}`} className="text-sm text-blue-600 hover:underline">
            ← К аукциону
          </Link>
          <h1 className="text-3xl font-bold mt-2">Редактировать аукцион</h1>
          <p className="text-gray-600 mt-1">
            Тип: <b>{auctionTypeLabel(auction.type)}</b>. Тип аукциона после создания не меняем,
            чтобы не ломать ставки и доступы.
          </p>
        </div>

        <span className="text-sm px-3 py-1 rounded-full bg-gray-50 border text-gray-700">
          Статус: {auction.status}
        </span>
      </div>

      {!canEdit && (
        <div className="border rounded-xl bg-orange-50 text-orange-800 p-5 mb-6">
          Этот аукцион уже нельзя редактировать. Редактирование разрешено только для статусов
          <b> open</b> и <b>draft</b>.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="border rounded-xl bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Публичная часть</h2>

          <input
            type="text"
            placeholder="Название"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border rounded p-2 w-full"
            required
            disabled={!canEdit}
          />

          <input
            type="text"
            placeholder="Краткое описание"
            value={publicSummary}
            onChange={(e) => setPublicSummary(e.target.value)}
            className="border rounded p-2 w-full"
            disabled={!canEdit}
          />

          <textarea
            placeholder="Публичное описание"
            value={publicDescription}
            onChange={(e) => setPublicDescription(e.target.value)}
            className="border rounded p-2 w-full min-h-[140px]"
            disabled={!canEdit}
          />

          <div className="grid md:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Категория: CAD, робототехника, медицина..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
            />

            <input
              type="text"
              placeholder="Валюта"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
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
              disabled={!canEdit}
            />

            <input
              type="number"
              min="0"
              placeholder={isOffer ? 'Ожидаемая сумма до' : 'Бюджет до'}
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
            />

            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
            />
          </div>
        </div>

        {auction.type === 'request' ? (
          <div className="border rounded-xl bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Заказ на разработку</h2>

            <input
              type="text"
              placeholder="Нужные роли через запятую"
              value={requiredRoles}
              onChange={(e) => setRequiredRoles(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
            />

            <input
              type="text"
              placeholder="Нужные навыки через запятую"
              value={requiredSkills}
              onChange={(e) => setRequiredSkills(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
            />

            <textarea
              placeholder="Ожидаемый результат"
              value={expectedResult}
              onChange={(e) => setExpectedResult(e.target.value)}
              className="border rounded p-2 w-full min-h-[100px]"
              disabled={!canEdit}
            />

            <textarea
              placeholder="Критерии выбора исполнителя / команды"
              value={selectionCriteria}
              onChange={(e) => setSelectionCriteria(e.target.value)}
              className="border rounded p-2 w-full min-h-[100px]"
              disabled={!canEdit}
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
                disabled={!canEdit}
              />

              <input
                type="text"
                placeholder="Готовность: idea, prototype, mvp, production"
                value={readinessLevel}
                onChange={(e) => setReadinessLevel(e.target.value)}
                className="border rounded p-2 w-full"
                disabled={!canEdit}
              />
            </div>

            <input
              type="text"
              placeholder="IP-режим / права"
              value={ipMode}
              onChange={(e) => setIpMode(e.target.value)}
              className="border rounded p-2 w-full"
              disabled={!canEdit}
            />

            <div>
              <label className="block text-sm text-gray-600 mb-1">Связанный проект</label>

              <select
                value={linkedListingId}
                onChange={(e) => setLinkedListingId(e.target.value)}
                className="border rounded p-2 w-full bg-white"
                disabled={!canEdit || loadingListings}
              >
                <option value="">Без привязки к проекту</option>
                {myListings.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.title || 'Без названия'}
                  </option>
                ))}
              </select>

              <p className="text-xs text-gray-500 mt-1">
                Можно сменить связанный проект или убрать привязку.
              </p>
            </div>

            <textarea
              placeholder="Что требуется от производства / партнёра"
              value={implementationNeeds}
              onChange={(e) => setImplementationNeeds(e.target.value)}
              className="border rounded p-2 w-full min-h-[100px]"
              disabled={!canEdit}
            />

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={ndaRequired}
                onChange={(e) => setNdaRequired(e.target.checked)}
                disabled={!canEdit}
              />
              Требуется NDA / подтверждение доступа к закрытым материалам
            </label>

            <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
              <h3 className="font-semibold">Закрытая часть offer-аукциона</h3>
              <p className="text-sm text-gray-600">
                Эти данные обновляются отдельно в auction_protected и не попадают в публичную часть.
              </p>

              <textarea
                placeholder="Закрытое описание: детали технологии, материалы, риски, ссылки на приватные документы"
                value={protectedDescription}
                onChange={(e) => setProtectedDescription(e.target.value)}
                className="border rounded p-2 w-full min-h-[140px] bg-white"
                disabled={!canEdit}
              />

              <textarea
                placeholder="Закрытые ссылки, каждая с новой строки"
                value={protectedLinks}
                onChange={(e) => setProtectedLinks(e.target.value)}
                className="border rounded p-2 w-full min-h-[90px] bg-white"
                disabled={!canEdit}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push(`/auctions/${auction.id}`)}
            className="border px-4 py-2 rounded hover:bg-gray-50 transition"
          >
            Отмена
          </button>

          <button
            type="submit"
            disabled={submitDisabled}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {saving ? 'Сохраняем...' : 'Сохранить изменения'}
          </button>
        </div>
      </form>
    </div>
  )
}