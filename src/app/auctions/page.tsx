'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabaseClient'
import { AuctionCard } from '@/components/auction/AuctionCard'
import type { Auction, AuctionType } from '@/components/auction/types'

export default function AuctionsPage() {
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [typeFilter, setTypeFilter] = useState<'all' | AuctionType>('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => {
    let active = true
    const loadAuctions = async () => {
      setLoading(true)
      setLoadError(false)
      try {
        const { data, error } = await supabase.from('auctions').select('*').in('status', ['open', 'closed']).order('created_at', { ascending: false })
        if (error) throw error
        if (active) setAuctions((data || []) as Auction[])
      } catch (error) {
        console.error('Ошибка загрузки аукционов:', error)
        if (active) setLoadError(true)
      } finally { if (active) setLoading(false) }
    }
    void loadAuctions()
    return () => { active = false }
  }, [loadAttempt])

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

  if (loading) return <PageLoading label="Загружаем аукционы…" />
  const hasFilters = Boolean(typeFilter !== 'all' || search || category)
  const resetFilters = () => { setTypeFilter('all'); setSearch(''); setCategory('') }

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Рынок инженерных решений" title="Аукционы и готовые проекты" description="Найдите заказ на разработку или предложите решение для внедрения, лицензирования и партнёрства.">
        <Button asChild variant="outline" className="action-secondary"><Link href="/auctions/my">Мои аукционы</Link></Button>
        <Button asChild className="action-primary"><Link href="/auctions/new"><Plus size={18} />Создать аукцион</Link></Button>
      </PageHeader>
      <section className="filter-panel" aria-label="Фильтры аукционов">
        <div className="flex items-center gap-2 text-sm font-semibold mb-4"><SlidersHorizontal size={17} className="text-blue-600" />Найти возможность</div>
        <div className="grid gap-4 md:grid-cols-4">
          <div><label htmlFor="auction-type" className="filter-label">Тип аукциона</label><select id="auction-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | AuctionType)} className="w-full"><option value="all">Все типы</option><option value="request">Заказы на разработку</option><option value="offer">Готовые проекты</option></select></div>
          <div className="md:col-span-2"><label htmlFor="auction-search" className="filter-label">Поиск</label><Input id="auction-search" type="search" placeholder="Название, задача или решение" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div><label htmlFor="auction-category" className="filter-label">Категория</label><Input id="auction-category" placeholder="Например, робототехника" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
        </div>
      </section>
      <div className="results-bar"><p aria-live="polite">{loadError ? 'Аукционы недоступны' : <>Найдено аукционов: <strong className="text-slate-900">{filtered.length}</strong></>}</p><button onClick={resetFilters} disabled={!hasFilters} className="text-blue-700 disabled:text-gray-400 disabled:opacity-60 min-h-11">Сбросить фильтры</button></div>
      {loadError ? <EmptyState title="Не удалось загрузить аукционы" description="Проверьте подключение и попробуйте ещё раз."><Button className="action-primary" onClick={() => setLoadAttempt((value) => value + 1)}>Повторить загрузку</Button></EmptyState> : filtered.length === 0 ? <EmptyState title={hasFilters ? 'По этим параметрам аукционов нет' : 'Новые аукционы появятся здесь'} description={hasFilters ? 'Попробуйте изменить запрос или сбросить фильтры.' : 'Опубликуйте заказ на разработку или готовый проект.'}>{hasFilters && <Button variant="outline" onClick={resetFilters}>Сбросить фильтры</Button>}</EmptyState> : <div className="grid gap-5 md:grid-cols-2">{filtered.map((auction) => <AuctionCard key={auction.id} auction={auction} />)}</div>}
    </div>
  )
}
