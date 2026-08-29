'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { AuctionCard } from '@/components/auction/AuctionCard'
import type { Auction, AuctionBid } from '@/components/auction/types'

type Tab = 'owned' | 'bids'

type BidWithAuction = AuctionBid & {
  auction?: Auction | null
  auctions?: Auction | null
}

const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    draft: 'Черновик',
    open: 'Открыт',
    closed: 'Закрыт',
    cancelled: 'Отменён',
    new: 'Новое',
    shortlisted: 'В шорт-листе',
    accepted: 'Принято',
    rejected: 'Отклонено',
    withdrawn: 'Отозвано',
  }

  return map[status] || status
}

const typeLabel = (type: string | null | undefined) => {
  if (type === 'request') return 'Заказ на разработку'
  if (type === 'offer') return 'Проект для внедрения'
  return 'Аукцион'
}

const formatDate = (value: string | null) => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const formatMoney = (amount: number | null, currency: string) => {
  if (amount === null || amount === undefined) return 'Сумма не указана'
  return `${amount.toLocaleString()} ${currency}`
}

export default function MyAuctionsPage() {
  const router = useRouter()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [ownedAuctions, setOwnedAuctions] = useState<Auction[]>([])
  const [myBids, setMyBids] = useState<BidWithAuction[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('owned')
  const [updatingAuctionId, setUpdatingAuctionId] = useState<string | null>(null)
  const [updatingBidId, setUpdatingBidId] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)

    const { data: userData, error: userError } = await supabase.auth.getUser()
    const user = userData?.user

    if (userError || !user) {
      setLoading(false)
      router.replace('/auth')
      return
    }

    setCurrentUserId(user.id)

    const [ownedResult, bidsResult] = await Promise.all([
      supabase
        .from('auctions')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('auction_bids')
        .select('*, auction:auctions(*)')
        .eq('bidder_id', user.id)
        .order('created_at', { ascending: false }),
    ])

    if (ownedResult.error) {
      logAppError('Ошибка загрузки моих аукционов:', ownedResult.error)
      setOwnedAuctions([])
    } else {
      setOwnedAuctions((ownedResult.data || []) as Auction[])
    }

    if (bidsResult.error) {
      logAppError('Ошибка загрузки моих предложений:', bidsResult.error)
      setMyBids([])
    } else {
      setMyBids((bidsResult.data || []) as unknown as BidWithAuction[])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const counts = useMemo(() => {
    return {
      owned: ownedAuctions.length,
      bids: myBids.length,
      activeOwned: ownedAuctions.filter((auction) => auction.status === 'open').length,
      acceptedBids: myBids.filter((bid) => bid.status === 'accepted').length,
    }
  }, [ownedAuctions, myBids])

  const transitionAuction = async (
    auction: Auction,
    targetStatus: 'closed' | 'cancelled'
  ) => {
    if (!currentUserId || updatingAuctionId) return

    setUpdatingAuctionId(auction.id)

    try {
      const { error } = await supabase.rpc(
        'transition_auction_status_secure',
        {
          p_expected_owner_id: currentUserId,
          p_auction_id: auction.id,
          p_target_status: targetStatus,
        }
      )

      if (error) {
        showAppError(
          error,
          targetStatus === 'closed'
            ? 'Не удалось закрыть аукцион.'
            : 'Не удалось отменить аукцион.',
          'Изменение статуса аукциона'
        )
        return
      }

      setOwnedAuctions((items) =>
        items.map((item) =>
          item.id === auction.id ? { ...item, status: targetStatus } : item
        )
      )
      showAppMessage(
        targetStatus === 'closed'
          ? 'Аукцион закрыт.'
          : 'Аукцион отменён.',
        'success'
      )
    } catch (error) {
      showAppError(error, 'Не удалось изменить статус аукциона.', 'Изменение статуса аукциона')
    } finally {
      setUpdatingAuctionId(null)
    }
  }

  const handleCloseAuction = async (auction: Auction) => {
    if (updatingAuctionId) return

    const ok = window.confirm(
      'Закрыть аукцион? Новые предложения больше нельзя будет подать, но история останется.'
    )

    if (!ok) return
    await transitionAuction(auction, 'closed')
  }

  const handleCancelAuction = async (auction: Auction) => {
    if (updatingAuctionId) return

    const ok = window.confirm(
      'Отменить аукцион? Он будет скрыт от остальных пользователей, но владелец сохранит историю.'
    )

    if (!ok) return
    await transitionAuction(auction, 'cancelled')
  }

  const handleDeleteDraft = async (auction: Auction) => {
    if (updatingAuctionId) return

    const ok = window.confirm(
      'Удалить черновик безвозвратно? Это сработает только для черновика без предложений.'
    )

    if (!ok) return

    setUpdatingAuctionId(auction.id)

    try {
      const { error } = await supabase
        .from('auctions')
        .delete()
        .eq('id', auction.id)
        .eq('owner_id', currentUserId)
        .eq('status', 'draft')

      if (error) {
        showAppError(
          error,
          'Не удалось удалить черновик. Возможно, он уже опубликован или по нему есть предложения.',
          'Удаление черновика аукциона'
        )
        return
      }

      setOwnedAuctions((items) =>
        items.filter((item) => item.id !== auction.id)
      )
      showAppMessage('Черновик удалён.', 'success')
    } catch (error) {
      showAppError(error, 'Не удалось удалить черновик.', 'Удаление черновика аукциона')
    } finally {
      setUpdatingAuctionId(null)
    }
  }

  const handleWithdrawBid = async (bid: BidWithAuction) => {
    if (!currentUserId || updatingBidId) return

    const ok = window.confirm('Отозвать своё предложение?')
    if (!ok) return

    setUpdatingBidId(bid.id)

    try {
      const { error } = await supabase.rpc(
        'withdraw_auction_bid_secure',
        {
          p_expected_bidder_id: currentUserId,
          p_bid_id: bid.id,
        }
      )

      if (error) {
        showAppError(error, 'Не удалось отозвать предложение.', 'Отзыв предложения')
        return
      }

      setMyBids((items) =>
        items.map((item) =>
          item.id === bid.id ? { ...item, status: 'withdrawn' } : item
        )
      )
      showAppMessage('Предложение отозвано.', 'success')
    } catch (error) {
      showAppError(error, 'Не удалось отозвать предложение.', 'Отзыв предложения')
    } finally {
      setUpdatingBidId(null)
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Загрузка моих аукционов...</div>
  }

  if (!currentUserId) {
    return null
  }

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Мои аукционы</h1>
          <p className="text-gray-600 mt-2">
            Управление созданными аукционами и предложениями, которые ты подавал на чужие проекты.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/auctions"
            className="border px-4 py-2 rounded hover:bg-gray-50 transition text-center"
          >
            Все аукционы
          </Link>

          <Link
            href="/auctions/new"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-center"
          >
            Создать аукцион
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <div className="border rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">Создано аукционов</div>
          <div className="text-2xl font-bold mt-1">{counts.owned}</div>
        </div>

        <div className="border rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">Активные мои</div>
          <div className="text-2xl font-bold mt-1">{counts.activeOwned}</div>
        </div>

        <div className="border rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">Мои предложения</div>
          <div className="text-2xl font-bold mt-1">{counts.bids}</div>
        </div>

        <div className="border rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">Принятые предложения</div>
          <div className="text-2xl font-bold mt-1">{counts.acceptedBids}</div>
        </div>
      </div>

      <div className="border rounded-xl bg-white p-2 shadow-sm mb-8 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('owned')}
          className={`px-4 py-2 rounded transition ${
            activeTab === 'owned'
              ? 'bg-blue-600 text-white'
              : 'hover:bg-gray-100 text-gray-700'
          }`}
        >
          Мои аукционы ({counts.owned})
        </button>

        <button
          onClick={() => setActiveTab('bids')}
          className={`px-4 py-2 rounded transition ${
            activeTab === 'bids'
              ? 'bg-blue-600 text-white'
              : 'hover:bg-gray-100 text-gray-700'
          }`}
        >
          Мои предложения ({counts.bids})
        </button>
      </div>

      {activeTab === 'owned' ? (
        <section>
          {ownedAuctions.length === 0 ? (
            <div className="text-center text-gray-500 border rounded-xl bg-white p-8">
              Ты ещё не создавал аукционы.
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {ownedAuctions.map((auction) => (
                <div key={auction.id} className="space-y-3">
                  <AuctionCard auction={auction} />

                  <div className="border rounded-xl bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-gray-600">
                        <b>Статус:</b> {statusLabel(auction.status)}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/auctions/${auction.id}`}
                          className="border px-3 py-2 rounded text-sm hover:bg-gray-50 transition"
                        >
                          Управлять
                        </Link>

                        {['open', 'draft'].includes(auction.status) && (
                          <Link
                            href={`/auctions/${auction.id}/edit`}
                            className="border px-3 py-2 rounded text-sm hover:bg-gray-50 transition"
                          >
                            Редактировать
                          </Link>
                        )}

                        {auction.status === 'open' && (
                          <>
                            <button
                              onClick={() => handleCloseAuction(auction)}
                              disabled={updatingAuctionId === auction.id}
                              className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 transition disabled:opacity-60"
                            >
                              {updatingAuctionId === auction.id ? '...' : 'Закрыть'}
                            </button>

                            <button
                              onClick={() => handleCancelAuction(auction)}
                              disabled={updatingAuctionId === auction.id}
                              className="bg-orange-600 text-white px-3 py-2 rounded text-sm hover:bg-orange-700 transition disabled:opacity-60"
                            >
                              {updatingAuctionId === auction.id ? '...' : 'Отменить'}
                            </button>
                          </>
                        )}

                        {auction.status === 'draft' && (
                          <button
                            onClick={() => handleDeleteDraft(auction)}
                            disabled={updatingAuctionId === auction.id}
                            className="bg-red-600 text-white px-3 py-2 rounded text-sm hover:bg-red-700 transition disabled:opacity-60"
                          >
                            {updatingAuctionId === auction.id ? '...' : 'Удалить черновик'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section>
          {myBids.length === 0 ? (
            <div className="text-center text-gray-500 border rounded-xl bg-white p-8">
              Ты ещё не подавал предложения на аукционы.
            </div>
          ) : (
            <div className="grid gap-4">
              {myBids.map((bid) => {
                const auction = bid.auction || bid.auctions || null
                const canWithdraw = bid.status === 'new' && auction?.status === 'open'

                return (
                  <div key={bid.id} className="border rounded-xl bg-white p-5 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2 mb-3">
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                            {statusLabel(bid.status)}
                          </span>

                          {auction && (
                            <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                              {typeLabel(auction.type)}
                            </span>
                          )}
                        </div>

                        <h2 className="text-xl font-semibold mb-2">
                          {auction ? (
                            <Link
                              href={`/auctions/${auction.id}`}
                              className="hover:text-blue-700 transition"
                            >
                              {auction.title}
                            </Link>
                          ) : (
                            <span>Аукцион недоступен или отменён</span>
                          )}
                        </h2>

                        <div className="grid gap-2 text-sm text-gray-600">
                          <div>
                            <b>Моя сумма:</b> {formatMoney(bid.amount, bid.currency)}
                          </div>

                          <div>
                            <b>Предложенный срок:</b> {formatDate(bid.proposed_deadline)}
                          </div>

                          {bid.deal_type && (
                            <div>
                              <b>Тип сделки:</b> {bid.deal_type}
                            </div>
                          )}

                          {bid.terms && (
                            <div>
                              <b>Условия/подход:</b> {bid.terms}
                            </div>
                          )}

                          {bid.message && (
                            <div>
                              <b>Сообщение:</b> {bid.message}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap md:flex-col gap-2 shrink-0">
                        {auction && (
                          <Link
                            href={`/auctions/${auction.id}`}
                            className="border px-3 py-2 rounded text-sm hover:bg-gray-50 transition text-center"
                          >
                            Открыть
                          </Link>
                        )}

                        {canWithdraw && (
                          <button
                            onClick={() => handleWithdrawBid(bid)}
                            disabled={updatingBidId === bid.id}
                            className="bg-orange-600 text-white px-3 py-2 rounded text-sm hover:bg-orange-700 transition disabled:opacity-60"
                          >
                            {updatingBidId === bid.id ? 'Отзываем...' : 'Отозвать'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}