'use client'

import { UiText } from '@/components/LocaleProvider'

import { PageLoading } from '@/components/PageState'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { marketTypeLabel, proposalStatusLabel as statusLabel } from '@/lib/marketLabels'
import type {
  Auction,
  AuctionAccessRequest,
  AuctionBid,
  AuctionProtected,
} from '@/components/auction/types'
const formatMoney = (amount: number | null, currency: string) => {
  if (amount === null) return '—'
  return `${amount.toLocaleString()} ${currency}`
}

const formatRange = (min: number | null, max: number | null, currency: string) => {
  if (min === null && max === null) return '—'
  if (min !== null && max !== null) return `${min.toLocaleString()}–${max.toLocaleString()} ${currency}`
  if (min !== null) return `от ${min.toLocaleString()} ${currency}`
  return `до ${max?.toLocaleString()} ${currency}`
}

const formatDate = (value: string | null) => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const toIsoOrNull = (value: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}


interface LinkedListingPreview {
  id: string
  title: string
  description: string | null
  created_at: string
}

interface AcceptAuctionBidResult {
  auction_id: string
  accepted_bid_id: string
  winner_id: string
  project_id: string | null
  project_was_created: boolean
  already_completed: boolean
}

interface SaveAuctionBidResult {
  bid_id: string
  created: boolean
  resumed: boolean
}

interface AuctionStatusTransitionResult {
  auction_id: string
  status: 'closed' | 'cancelled'
  already_completed: boolean
}

function firstRpcRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null
  }

  if (value && typeof value === 'object') {
    return value as T
  }

  return null
}

export default function AuctionDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [auction, setAuction] = useState<Auction | null>(null)
  const [linkedListing, setLinkedListing] = useState<LinkedListingPreview | null>(null)
  const [protectedData, setProtectedData] = useState<AuctionProtected | null>(null)
  const [bids, setBids] = useState<AuctionBid[]>([])
  const [accessRequests, setAccessRequests] = useState<AuctionAccessRequest[]>([])
  const [myAccessRequest, setMyAccessRequest] = useState<AuctionAccessRequest | null>(null)
  const [loading, setLoading] = useState(true)

  const [bidAmount, setBidAmount] = useState('')
  const [bidCurrency, setBidCurrency] = useState('RUB')
  const [bidDeadline, setBidDeadline] = useState('')
  const [bidTerms, setBidTerms] = useState('')
  const [bidMessage, setBidMessage] = useState('')
  const [bidDealType, setBidDealType] = useState('')
  const [savingBid, setSavingBid] = useState(false)
  const [withdrawingBid, setWithdrawingBid] = useState(false)

  const [accessMessage, setAccessMessage] = useState('')
  const [requestingAccess, setRequestingAccess] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [updatingAuctionStatus, setUpdatingAuctionStatus] = useState(false)
  const [deletingAuction, setDeletingAuction] = useState(false)

  const isOwner = Boolean(userId && auction && userId === auction.owner_id)
  const isOffer = auction?.type === 'offer'

  const myBid = useMemo(() => {
    if (!userId) return null
    return bids.find((bid) => bid.bidder_id === userId) || null
  }, [bids, userId])

  const canBid = useMemo(() => {
    if (!userId || !auction || isOwner) return false
    if (auction.status !== 'open') return false
    if (auction.ends_at && new Date(auction.ends_at).getTime() <= Date.now()) return false
    return true
  }, [auction, isOwner, userId])

  const loadAuction = async () => {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    setUserId(user?.id || null)

    const { data: auctionData, error: auctionError } = await supabase
      .from('auctions')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (auctionError || !auctionData) {
      logAppError('Ошибка загрузки объявления:', auctionError)
      setAuction(null)
      setLoading(false)
      return
    }

    const loadedAuction = auctionData as Auction
    setAuction(loadedAuction)

    if (loadedAuction.linked_listing_id) {
      const { data: linkedData, error: linkedError } = await supabase
        .from('listings')
        .select('id, title, description, created_at')
        .eq('id', loadedAuction.linked_listing_id)
        .maybeSingle()

      if (linkedError) {
        logAppError('Ошибка загрузки связанного проекта:', linkedError)
        setLinkedListing(null)
      } else {
        setLinkedListing((linkedData as LinkedListingPreview) || null)
      }
    } else {
      setLinkedListing(null)
    }

    const { data: protectedRows, error: protectedError } = await supabase
      .from('auction_protected')
      .select('*')
      .eq('auction_id', id)
      .maybeSingle()

    if (protectedError) {
      logAppError('Ошибка загрузки закрытых материалов:', protectedError)
      setProtectedData(null)
    } else {
      setProtectedData((protectedRows as AuctionProtected) || null)
    }

    const { data: bidData, error: bidError } = await supabase
      .from('auction_bids')
      .select('*')
      .eq('auction_id', id)
      .order('created_at', { ascending: false })

    if (bidError) {
      logAppError('Ошибка загрузки предложений:', bidError)
      setBids([])
    } else {
      setBids((bidData || []) as AuctionBid[])
    }

    const { data: accessData, error: accessError } = await supabase
      .from('auction_access_requests')
      .select('*')
      .eq('auction_id', id)
      .order('created_at', { ascending: false })

    if (accessError) {
      logAppError('Ошибка загрузки запросов доступа:', accessError)
      setAccessRequests([])
      setMyAccessRequest(null)
    } else {
      const rows = (accessData || []) as AuctionAccessRequest[]
      setAccessRequests(rows)
      setMyAccessRequest(user?.id ? rows.find((r) => r.requester_id === user.id) || null : null)
    }

    setLoading(false)
  }

  useEffect(() => {
    loadAuction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleCreateOrUpdateBid = async (e: React.FormEvent) => {
    e.preventDefault()

    if (savingBid || !userId || !auction || !canBid) return

    setSavingBid(true)

    try {
      const { data, error } = await supabase.rpc(
        'save_auction_bid_secure',
        {
          p_expected_bidder_id: userId,
          p_auction_id: auction.id,
          p_amount: bidAmount ? Number(bidAmount) : null,
          p_currency:
            bidCurrency.trim().toUpperCase() ||
            auction.currency ||
            'RUB',
          p_proposed_deadline: toIsoOrNull(bidDeadline),
          p_terms: bidTerms.trim() || null,
          p_message: bidMessage.trim() || null,
          p_deal_type: bidDealType.trim() || null,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось сохранить предложение.', 'Сохранение предложения по объявлению')
        return
      }

      const result = firstRpcRow<SaveAuctionBidResult>(data)

      if (!result?.bid_id) {
        logAppError('RPC сохранения предложения не вернул результат', data)
        showAppMessage('Сервер не вернул результат сохранения предложения.', 'error')
        return
      }

      setBidAmount('')
      setBidDeadline('')
      setBidTerms('')
      setBidMessage('')
      setBidDealType('')

      await loadAuction()

      showAppMessage(
        result.created
          ? 'Предложение отправлено.'
          : result.resumed
            ? 'Предложение отправлено повторно.'
            : 'Предложение обновлено.',
        'success'
      )
    } catch (error) {
      showAppError(error, 'Не удалось сохранить предложение.', 'Сохранение предложения по объявлению')
    } finally {
      setSavingBid(false)
    }
  }

  const handleWithdrawBid = async () => {
    if (withdrawingBid || !userId || !myBid) return

    const ok = window.confirm('Отозвать предложение?')
    if (!ok) return

    setWithdrawingBid(true)

    try {
      const { error } = await supabase.rpc(
        'withdraw_auction_bid_secure',
        {
          p_expected_bidder_id: userId,
          p_bid_id: myBid.id,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось отозвать предложение.', 'Отзыв предложения по объявлению')
        return
      }

      await loadAuction()
      showAppMessage('Предложение отозвано.', 'success')
    } catch (error) {
      showAppError(error, 'Не удалось отозвать предложение.', 'Отзыв предложения по объявлению')
    } finally {
      setWithdrawingBid(false)
    }
  }

  const changeAuctionStatus = async (
    targetStatus: 'closed' | 'cancelled'
  ) => {
    if (updatingAuctionStatus || !userId || !auction) return

    setUpdatingAuctionStatus(true)

    try {
      const { data, error } = await supabase.rpc(
        'transition_auction_status_secure',
        {
          p_expected_owner_id: userId,
          p_auction_id: auction.id,
          p_target_status: targetStatus,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось изменить статус объявления.', 'Изменение статуса объявления')
        return
      }

      const result =
        firstRpcRow<AuctionStatusTransitionResult>(data)

      if (!result?.auction_id) {
        logAppError('RPC статуса объявления не вернул результат', data)
        showAppMessage('Сервер не вернул результат изменения статуса.', 'error')
        return
      }

      await loadAuction()

      showAppMessage(
        result.already_completed
          ? targetStatus === 'closed'
            ? 'Объявление уже закрыто.'
            : 'Объявление уже отменено.'
          : targetStatus === 'closed'
            ? 'Объявление закрыто. Активные предложения отклонены.'
            : 'Объявление отменено. Активные предложения отклонены.',
        result.already_completed ? 'info' : 'success'
      )
    } catch (error) {
      showAppError(error, 'Не удалось изменить статус объявления.', 'Изменение статуса объявления')
    } finally {
      setUpdatingAuctionStatus(false)
    }
  }

  const handleCloseAuction = async () => {
    if (!auction || updatingAuctionStatus) return

    if (auction.status !== 'open') {
      showAppMessage('Закрыть можно только открытое объявление.', 'warning')
      return
    }

    const ok = window.confirm(
      'Закрыть объявление, не выбрав предложение? Все активные предложения будут отклонены.'
    )

    if (!ok) return

    await changeAuctionStatus('closed')
  }

  const handleCancelAuction = async () => {
    if (!auction || updatingAuctionStatus) return

    if (!['open', 'draft'].includes(auction.status)) {
      showAppMessage('Отменить можно только открытое объявление или черновик.', 'warning')
      return
    }

    const ok = window.confirm(
      'Отменить объявление? Активные предложения будут отклонены, а объявление скроется от остальных пользователей.'
    )

    if (!ok) return

    await changeAuctionStatus('cancelled')
  }

  const handleDeleteAuction = async () => {
    if (!auction || deletingAuction) return

    if (auction.status !== 'draft') {
      showAppMessage(
        'Физически удалить можно только черновик без предложений. Открытое объявление можно отменить.',
        'warning'
      )
      return
    }

    const ok = window.confirm(
      'Удалить объявление безвозвратно? Это возможно только для черновика без предложений.'
    )

    if (!ok) return

    setDeletingAuction(true)

    try {
      const { error } = await supabase
        .from('auctions')
        .delete()
        .eq('id', auction.id)
        .eq('owner_id', userId)
        .eq('status', 'draft')

      if (error) {
        showAppError(
          error,
          'Не удалось удалить объявление. Возможно, оно уже опубликовано или по нему есть предложения.',
          'Удаление объявления'
        )
        return
      }

      showAppMessage('Объявление удалено.', 'success')
      router.replace('/auctions')
    } catch (error) {
      showAppError(error, 'Не удалось удалить объявление.', 'Удаление объявления')
    } finally {
      setDeletingAuction(false)
    }
  }

  const handleBidDecision = async (
    bid: AuctionBid,
    status: 'shortlisted' | 'accepted' | 'rejected'
  ) => {
    if (updatingId || !userId || !auction || !isOwner) return

    setUpdatingId(bid.id)

    try {
      if (status === 'accepted') {
        if (auction.status !== 'open') {
          showAppMessage('Выбрать предложение можно только в открытом объявлении.', 'warning')
          return
        }

        const { data, error } = await supabase.rpc(
          'accept_auction_bid_secure',
          {
            p_expected_owner_id: userId,
            p_bid_id: bid.id,
          }
        )

        if (error) {
          showAppError(error, 'Не удалось выбрать предложение.', 'Выбор предложения')
          return
        }

        const result = firstRpcRow<AcceptAuctionBidResult>(data)

        if (!result?.accepted_bid_id) {
          logAppError('RPC выбора предложения не вернул результат', data)
          showAppMessage('Сервер не вернул результат выбора предложения.', 'error')
          return
        }

        await loadAuction()

        showAppMessage(
          auction.type === 'request' && result.project_id
            ? result.project_was_created
              ? 'Предложение выбрано. Проект создан, автор предложения добавлен в рабочую зону.'
              : result.already_completed
                ? 'Это предложение уже было выбрано ранее.'
                : 'Предложение выбрано. Автор предложения добавлен в связанный проект.'
            : result.already_completed
              ? 'Это предложение уже было выбрано ранее.'
              : 'Предложение выбрано. Объявление закрыто.',
          result.already_completed ? 'info' : 'success'
        )

        return
      }

      const { error } = await supabase.rpc(
        'review_auction_bid_secure',
        {
          p_expected_owner_id: userId,
          p_bid_id: bid.id,
          p_target_status: status,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось обновить статус предложения.', 'Рассмотрение предложения по объявлению')
        return
      }

      await loadAuction()
      showAppMessage(
        status === 'shortlisted'
          ? 'Предложение добавлено в шорт-лист.'
          : 'Предложение отклонено.',
        'success'
      )
    } catch (error) {
      showAppError(error, 'Не удалось обработать предложение.', 'Рассмотрение предложения по объявлению')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRequestAccess = async () => {
    if (requestingAccess || !userId || !auction || !isOffer) return

    setRequestingAccess(true)

    try {
      const { error } = await supabase.rpc(
        'request_auction_access_secure',
        {
          p_expected_requester_id: userId,
          p_auction_id: auction.id,
          p_message: accessMessage.trim() || null,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось запросить доступ.', 'Запрос доступа к закрытым материалам')
        return
      }

      setAccessMessage('')
      await loadAuction()
      showAppMessage('Запрос доступа отправлен.', 'success')
    } catch (error) {
      showAppError(error, 'Не удалось запросить доступ.', 'Запрос доступа к закрытым материалам')
    } finally {
      setRequestingAccess(false)
    }
  }

  const handleAccessDecision = async (
    request: AuctionAccessRequest,
    status: 'approved' | 'rejected'
  ) => {
    if (updatingId || !userId || !auction || !isOwner) return

    setUpdatingId(request.id)

    try {
      const { error } = await supabase.rpc(
        'decide_auction_access_secure',
        {
          p_expected_owner_id: userId,
          p_request_id: request.id,
          p_target_status: status,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось обработать запрос доступа.', 'Решение по доступу к объявлению')
        return
      }

      await loadAuction()
      showAppMessage(
        status === 'approved'
          ? 'Доступ к закрытым материалам предоставлен.'
          : 'Запрос доступа отклонён.',
        'success'
      )
    } catch (error) {
      showAppError(error, 'Не удалось обработать запрос доступа.', 'Решение по доступу к объявлению')
    } finally {
      setUpdatingId(null)
    }
  }

  if (loading) return <PageLoading />

  if (!auction) {
    return (
      <div className="page-shell text-center">
        <h1 className="text-2xl font-bold mb-3">Объявление не найдено</h1>
        <Link href="/auctions" className="text-blue-600 underline">
          Вернуться к объявлениям
        </Link>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <div className="mb-6">
        <Link href="/auctions" className="text-sm text-blue-600 hover:underline">
          ← К списку объявлений
        </Link>
      </div>

      <div className="border rounded-xl bg-white p-6 shadow-sm mb-8">
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`text-xs px-2 py-1 rounded-full border ${auction.type === 'offer' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
            {marketTypeLabel(auction.type)}
          </span>
          <span className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
            {auction.status}
          </span>
          {auction.nda_required && (
            <span className="text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
              NDA
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold mb-3">{auction.title}</h1>

        {auction.public_summary && (
          <p className="text-lg text-gray-700 mb-4">{auction.public_summary}</p>
        )}

        <div className="grid md:grid-cols-3 gap-3 text-sm mb-6">
          <div className="border rounded-lg bg-gray-50 p-3">
            <div className="text-gray-500">Категория</div>
            <div className="font-medium">{auction.category || '—'}</div>
          </div>
          <div className="border rounded-lg bg-gray-50 p-3">
            <div className="text-gray-500">Бюджет / сумма</div>
            <div className="font-medium">{formatRange(auction.budget_min, auction.budget_max, auction.currency)}</div>
          </div>
          <div className="border rounded-lg bg-gray-50 p-3">
            <div className="text-gray-500">Приём предложений до</div>
            <div className="font-medium">{formatDate(auction.ends_at)}</div>
          </div>
        </div>

        {auction.public_description && (
          <div className="prose max-w-none mb-6 whitespace-pre-wrap text-gray-800">
            {auction.public_description}
          </div>
        )}


        {isOwner && (
          <div className="mt-6 border rounded-lg bg-gray-50 p-4">
            <h2 className="font-semibold mb-3">Управление объявлением</h2>

            <div className="flex flex-wrap gap-3 items-center">
              {['open', 'draft'].includes(auction.status) && (
                <Link
                  href={`/auctions/${auction.id}/edit`}
                  className="border bg-white px-4 py-2 rounded hover:bg-gray-100 transition"
                >
                  Редактировать
                </Link>
              )}

              {auction.status === 'open' && (
                <>
                  <button
                    onClick={handleCloseAuction}
                    disabled={updatingAuctionStatus}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
                  >
                    {updatingAuctionStatus ? 'Закрываем...' : 'Закрыть объявление'}
                  </button>

                  <button
                    onClick={handleCancelAuction}
                    disabled={updatingAuctionStatus}
                    className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition disabled:opacity-60"
                  >
                    {updatingAuctionStatus ? 'Отменяем...' : 'Отменить объявление'}
                  </button>
                </>
              )}

              {auction.status === 'draft' && (
                <>
                  <button
                    onClick={handleCancelAuction}
                    disabled={updatingAuctionStatus}
                    className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition disabled:opacity-60"
                  >
                    {updatingAuctionStatus ? 'Отменяем...' : 'Отменить черновик'}
                  </button>

                  <button
                    onClick={handleDeleteAuction}
                    disabled={deletingAuction}
                    className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition disabled:opacity-60"
                  >
                    {deletingAuction ? 'Удаляем...' : 'Удалить черновик'}
                  </button>
                </>
              )}

              {auction.status === 'closed' && (
                <div className="text-sm text-gray-600">
                  Объявление закрыто. Новые предложения больше не принимаются.
                </div>
              )}

              {auction.status === 'cancelled' && (
                <div className="text-sm text-orange-700">
                  Объявление отменено и скрыто от остальных пользователей.
                </div>
              )}
            </div>
          </div>
        )}

        {auction.type === 'request' ? (
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="border rounded-lg p-4 bg-gray-50">
              <b>Нужные роли:</b>{' '}
              {auction.required_roles?.length ? auction.required_roles.join(', ') : '—'}
            </div>
            <div className="border rounded-lg p-4 bg-gray-50">
              <b>Нужные навыки:</b>{' '}
              {auction.required_skills?.length ? auction.required_skills.join(', ') : '—'}
            </div>
            <div className="border rounded-lg p-4 bg-gray-50 whitespace-pre-wrap">
              <b>Ожидаемый результат:</b>
              <div className="mt-2">{auction.expected_result || '—'}</div>
            </div>
            <div className="border rounded-lg p-4 bg-gray-50 whitespace-pre-wrap">
              <b>Критерии выбора:</b>
              <div className="mt-2">{auction.selection_criteria || '—'}</div>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="border rounded-lg p-4 bg-gray-50">
              <b>Тип сделки:</b> {auction.deal_type || '—'}
            </div>
            <div className="border rounded-lg p-4 bg-gray-50">
              <b>Готовность:</b> {auction.readiness_level || '—'}
            </div>
            <div className="border rounded-lg p-4 bg-gray-50">
              <b>IP / права:</b> {auction.ip_mode || '—'}
            </div>
            <div className="border rounded-lg p-4 bg-gray-50 whitespace-pre-wrap">
              <b>Что нужно от партнёра:</b>
              <div className="mt-2">{auction.implementation_needs || '—'}</div>
            </div>
          </div>
        )}

        {auction.type === 'offer' && auction.linked_listing_id && (
          <div className="mt-6 border rounded-lg bg-blue-50 border-blue-200 p-4">
            <h2 className="font-semibold mb-2 text-blue-900">Связанный проект</h2>

            {linkedListing ? (
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-blue-950">
                    {linkedListing.title || 'Без названия'}
                  </div>

                  {linkedListing.description && (
                    <div className="text-sm text-blue-900/80 mt-1 line-clamp-2">
                      {linkedListing.description}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/listings/${linkedListing.id}`}
                    className="bg-white border border-blue-300 text-blue-800 text-sm px-3 py-2 rounded hover:bg-blue-100 transition"
                  >
                    Открыть обзор
                  </Link>

                  <Link
                    href={`/projects/${linkedListing.id}`}
                    className="bg-blue-600 text-white text-sm px-3 py-2 rounded hover:bg-blue-700 transition"
                  >
                    Рабочая зона
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-sm text-blue-900">
                Проект привязан, но недоступен текущему пользователю или был удалён.
              </div>
            )}
          </div>
        )}
      </div>

      {isOffer && (
        <div className="border rounded-xl bg-white p-5 shadow-sm mb-8">
          <h2 className="text-xl font-semibold mb-3">Закрытые материалы</h2>

          {protectedData ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-green-50 p-3 text-sm text-green-800">
                Доступ к закрытым материалам открыт.
              </div>

              {protectedData.protected_description && (
                <div className="whitespace-pre-wrap text-gray-800 border rounded-lg p-4 bg-gray-50">
                  {protectedData.protected_description}
                </div>
              )}

              {Array.isArray(protectedData.protected_links) && protectedData.protected_links.length > 0 && (
                <div className="border rounded-lg p-4 bg-gray-50">
                  <h3 className="font-semibold mb-2">Ссылки</h3>
                  <ul className="list-disc ml-5 text-sm text-blue-700">
                    {protectedData.protected_links.map((link: any, index: number) => (
                      <li key={`${link}-${index}`}>
                        <a href={String(link)} target="_blank" className="underline">
                          {String(link)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : isOwner ? (
            <p className="text-sm text-gray-500">Закрытая часть не заполнена.</p>
          ) : !userId ? (
            <p className="text-sm text-gray-500">Войдите, чтобы запросить доступ к закрытым материалам.</p>
          ) : myAccessRequest ? (
            <div className="text-sm text-gray-700">
              Ваш запрос доступа: <b>{statusLabel(myAccessRequest.status)}</b>
            </div>
          ) : auction.status !== 'open' ? (
            <p className="text-sm text-gray-500">
              Запросить доступ нельзя: объявление уже закрыто или отменено.
            </p>
          ) : (
            <div className="space-y-3">
              <textarea
                placeholder="Комментарий к запросу доступа"
                value={accessMessage}
                onChange={(e) => setAccessMessage(e.target.value)}
                className="border rounded p-2 w-full min-h-[90px]"
              />
              <button
                onClick={handleRequestAccess}
                disabled={requestingAccess}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
              >
                {requestingAccess ? 'Отправляем...' : 'Запросить доступ'}
              </button>
            </div>
          )}
        </div>
      )}

      {canBid && (
        <div className="border rounded-xl bg-white p-5 shadow-sm mb-8">
          <h2 className="text-xl font-semibold mb-4">
            {myBid ? 'Ваше предложение' : 'Подать предложение'}
          </h2>

          {myBid && (
            <div className="mb-4 rounded-lg border bg-blue-50 p-3 text-sm text-blue-800">
              Текущий статус: <b>{statusLabel(myBid.status)}</b>
            </div>
          )}

          <form onSubmit={handleCreateOrUpdateBid} className="space-y-3">
            <div className="grid md:grid-cols-3 gap-3">
              <input
                type="number"
                min="0"
                placeholder="Сумма"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="border rounded p-2 w-full"
              />

              <input
                type="text"
                placeholder="Валюта"
                value={bidCurrency}
                onChange={(e) => setBidCurrency(e.target.value)}
                className="border rounded p-2 w-full"
              />

              <input
                type="datetime-local"
                value={bidDeadline}
                onChange={(e) => setBidDeadline(e.target.value)}
                className="border rounded p-2 w-full"
              />
            </div>

            {isOffer && (
              <input
                type="text"
                placeholder="Тип интереса: buy, license, pilot, partner..."
                value={bidDealType}
                onChange={(e) => setBidDealType(e.target.value)}
                className="border rounded p-2 w-full"
              />
            )}

            <textarea
              placeholder={isOffer ? 'Условия сделки / внедрения' : 'План выполнения / подход'}
              value={bidTerms}
              onChange={(e) => setBidTerms(e.target.value)}
              className="border rounded p-2 w-full min-h-[120px]"
            />

            <textarea
              placeholder="Сообщение автору"
              value={bidMessage}
              onChange={(e) => setBidMessage(e.target.value)}
              className="border rounded p-2 w-full min-h-[90px]"
            />

            <div className="flex gap-3 flex-wrap">
              <button
                type="submit"
                disabled={savingBid}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
              >
                {savingBid ? 'Сохраняем...' : myBid ? 'Обновить предложение' : 'Подать предложение'}
              </button>

              {myBid && ['new', 'shortlisted'].includes(myBid.status) && (
                <button
                  type="button"
                  onClick={handleWithdrawBid}
                  disabled={withdrawingBid}
                  className="border px-4 py-2 rounded hover:bg-gray-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {withdrawingBid ? 'Отзываем...' : 'Отозвать'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {isOwner && (
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <div className="border rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">Предложения</h2>

            {bids.length === 0 ? (
              <p className="text-sm text-gray-500">Пока предложений нет.</p>
            ) : (
              <div className="space-y-3">
                {bids.map((bid) => (
                  <div key={bid.id} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="font-medium">
                        {formatMoney(bid.amount, bid.currency)}
                      </div>
                      <div className="text-sm text-gray-600">
                        {statusLabel(bid.status)}
                      </div>
                    </div>

                    <div className="text-sm text-gray-600 mb-2">
                      Срок: {formatDate(bid.proposed_deadline)}
                    </div>

                    {bid.deal_type && (
                      <div className="text-sm text-gray-600 mb-2">
                        Тип сделки: {bid.deal_type}
                      </div>
                    )}

                    {bid.terms && <div className="text-sm whitespace-pre-wrap mb-2">{bid.terms}</div>}
                    {bid.message && <div className="text-sm text-gray-600 whitespace-pre-wrap mb-3">{bid.message}</div>}

                    {auction.status === 'open' && !['accepted', 'rejected', 'withdrawn'].includes(bid.status) && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleBidDecision(bid, 'shortlisted')}
                          disabled={updatingId === bid.id}
                          className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded hover:bg-gray-300 disabled:opacity-60"
                        >
                          В шорт-лист
                        </button>

                        <button
                          onClick={() => handleBidDecision(bid, 'accepted')}
                          disabled={updatingId === bid.id}
                          className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 disabled:opacity-60"
                        >
                          Выбрать предложение
                        </button>

                        <button
                          onClick={() => handleBidDecision(bid, 'rejected')}
                          disabled={updatingId === bid.id}
                          className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 disabled:opacity-60"
                        ><UiText text={"Отклонить"}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isOffer && (
            <div className="border rounded-xl bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold mb-4">Запросы доступа</h2>

              {accessRequests.length === 0 ? (
                <p className="text-sm text-gray-500">Пока запросов нет.</p>
              ) : (
                <div className="space-y-3">
                  {accessRequests.map((request) => (
                    <div key={request.id} className="border rounded-lg p-4 bg-gray-50">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="font-medium">Запрос доступа</div>
                        <div className="text-sm text-gray-600">{statusLabel(request.status)}</div>
                      </div>

                      {request.message && (
                        <div className="text-sm whitespace-pre-wrap mb-3">{request.message}</div>
                      )}

                      {request.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAccessDecision(request, 'approved')}
                            disabled={updatingId === request.id}
                            className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 disabled:opacity-60"
                          >
                            Одобрить
                          </button>

                          <button
                            onClick={() => handleAccessDecision(request, 'rejected')}
                            disabled={updatingId === request.id}
                            className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 disabled:opacity-60"
                          ><UiText text={"Отклонить"}/></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}