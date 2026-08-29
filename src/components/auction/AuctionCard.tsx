'use client'

import Link from 'next/link'
import type { Auction } from './types'

interface AuctionCardProps {
  auction: Auction
}

const typeLabel = (type: string) => {
  if (type === 'request') return 'Заказ на разработку'
  if (type === 'offer') return 'Проект для внедрения'
  return type
}

const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    draft: 'Черновик',
    open: 'Открыт',
    closed: 'Закрыт',
    cancelled: 'Отменён',
  }

  return map[status] || status
}

const formatMoney = (min: number | null, max: number | null, currency: string) => {
  if (min === null && max === null) return 'Бюджет не указан'
  if (min !== null && max !== null) return `${min.toLocaleString()}–${max.toLocaleString()} ${currency}`
  if (min !== null) return `от ${min.toLocaleString()} ${currency}`
  return `до ${max?.toLocaleString()} ${currency}`
}

const formatDate = (value: string | null) => {
  if (!value) return 'Без срока'
  return new Date(value).toLocaleString()
}

export function AuctionCard({ auction }: AuctionCardProps) {
  const isOffer = auction.type === 'offer'

  return (
    <div className="border rounded-xl bg-white p-5 shadow-sm hover:shadow-md transition">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`text-xs px-2 py-1 rounded-full ${isOffer ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
          {typeLabel(auction.type)}
        </span>

        <span className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
          {statusLabel(auction.status)}
        </span>

        {auction.nda_required && (
          <span className="text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
            NDA
          </span>
        )}
      </div>

      <h2 className="text-xl font-semibold mb-2">
        <Link href={`/auctions/${auction.id}`} className="hover:text-blue-700 transition">
          {auction.title}
        </Link>
      </h2>

      {auction.public_summary && (
        <p className="text-gray-700 text-sm mb-4 line-clamp-3">
          {auction.public_summary}
        </p>
      )}

      <div className="grid gap-2 text-sm text-gray-600">
        <div>
          <b>Категория:</b> {auction.category || '—'}
        </div>

        <div>
          <b>{isOffer ? 'Ожидаемые условия:' : 'Бюджет:'}</b>{' '}
          {formatMoney(auction.budget_min, auction.budget_max, auction.currency)}
        </div>

        {isOffer ? (
          <>
            <div>
              <b>Тип сделки:</b> {auction.deal_type || '—'}
            </div>
            <div>
              <b>Готовность:</b> {auction.readiness_level || '—'}
            </div>
          </>
        ) : (
          <div>
            <b>Нужны роли:</b>{' '}
            {auction.required_roles?.length ? auction.required_roles.join(', ') : '—'}
          </div>
        )}

        <div>
          <b>Приём предложений до:</b> {formatDate(auction.ends_at)}
        </div>
      </div>

      <div className="mt-4">
        <Link
          href={`/auctions/${auction.id}`}
          className="inline-block bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Открыть
        </Link>
      </div>
    </div>
  )
}
