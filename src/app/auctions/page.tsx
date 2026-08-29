'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { AuctionCard } from '@/components/auction/AuctionCard'
import type { Auction, AuctionType } from '@/components/auction/types'

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [loading, setLoading] = useState(true)

  const [typeFilter, setTypeFilter] = useState<'all' | AuctionType>('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => {
    const loadAuctions = async () => {
      setLoading(true)

      const { data, error } = await supabase
        .from('auctions')
        .select('*')
        .in('status', ['open', 'closed'])
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Ошибка загрузки аукционов:', error)
        setAuctions([])
      } else {
        setAuctions((data || []) as Auction[])
      }

      setLoading(false)
    }

    loadAuctions()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const c = category.trim().toLowerCase()

    return auctions.filter((auction) => {
      if (typeFilter !== 'all' && auction.type !== typeFilter) return false

      if (q) {
        const text = [
          auction.title,
          auction.public_summary,
          auction.public_description,
          auction.category,
          auction.deal_type,
          auction.readiness_level,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()

        if (!text.includes(q)) return false
      }

      if (c && !(auction.category || '').toLowerCase().includes(c)) return false

      return true
    })
  }, [auctions, typeFilter, search, category])

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Загрузка аукционов...</div>
  }

  return (
    <div className="max-w-6xl mx-auto py-10 px-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Аукционы / рынок проектов</h1>
          <p className="text-gray-600 mt-2">
            Заказы на разработку и готовые проекты для внедрения, лицензирования или партнёрства.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/auctions/my"
            className="border px-4 py-2 rounded hover:bg-gray-50 transition text-center"
          >
            Мои аукционы
          </Link>

          <Link
            href="/auctions/new"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-center"
          >
            Создать аукцион
          </Link>
        </div>
      </div>

      <div className="border rounded-xl bg-white p-4 shadow-sm mb-8">
        <div className="grid md:grid-cols-4 gap-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | AuctionType)}
            className="border rounded p-2 bg-white"
          >
            <option value="all">Все типы</option>
            <option value="request">Заказы на разработку</option>
            <option value="offer">Готовые проекты</option>
          </select>

          <input
            type="text"
            placeholder="Поиск"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded p-2 md:col-span-2"
          />

          <input
            type="text"
            placeholder="Категория"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border rounded p-2"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 border rounded-xl bg-white p-8">
          Аукционы не найдены.
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {filtered.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      )}
    </div>
  )
}