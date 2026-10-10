'use client'

import { UiText } from '@/components/LocaleProvider'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ArrowUpRight } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
import { PUBLICATION_KINDS } from '@/lib/siteConfig'
type Publication = {
  id: string
  title: string
  kind: string
  summary: string
  starts_at: string | null
  location: string | null
  published_at: string
}
export default function NewsPage() {
  const [items, setItems] = useState<Publication[]>([]),
    [kind, setKind] = useState(''),
    [query, setQuery] = useState(''),
    [upcoming, setUpcoming] = useState(false)
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [editor, setEditor] = useState(false)
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { data, error: issue } = await supabase
          .from('publications')
          .select('id,title,kind,summary,starts_at,location,published_at')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
        if (issue) throw issue
        if (active) setItems(data || [])
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user) {
          const { data: allowed } = await supabase.rpc('is_site_editor')
          if (active) setEditor(Boolean(allowed))
        }
      } catch {
        if (active) setError('Не удалось загрузить публикации.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [attempt])
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (!kind || item.kind === kind) &&
          `${item.title} ${item.summary} ${item.location || ''}`
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (!upcoming ||
            (item.starts_at &&
              new Date(item.starts_at).getTime() >= Date.now())),
      ),
    [items, kind, query, upcoming],
  )
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Инженерное сообщество"
        title="События и новости"
        description="Выставки, семинары, научные журналы и новости инженерной среды."
      >
        {editor && (
          <Link href="/editor" className="action-secondary">
            <UiText text={'Редактор публикаций'} />
          </Link>
        )}
      </PageHeader>
      <section
        className="filter-panel grid gap-4 sm:grid-cols-3"
        aria-label="Фильтры публикаций"
      >
        <div>
          <label htmlFor="news-search" className="filter-label">
            <UiText text={'Поиск'} />
          </label>
          <input
            id="news-search"
            className="w-full"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Тема, название, город"
          />
        </div>
        <div>
          <label htmlFor="news-kind" className="filter-label">
            <UiText text={'Раздел'} />
          </label>
          <select
            id="news-kind"
            className="w-full"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">
              <UiText text={'Все публикации'} />
            </option>
            {Object.entries(PUBLICATION_KINDS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 self-end min-h-12 text-sm">
          <input
            type="checkbox"
            checked={upcoming}
            onChange={(e) => setUpcoming(e.target.checked)}
          />
          <UiText text={'Только предстоящие события'} />
        </label>
      </section>
      <div className="mt-7">
        {loading ? (
          <PageLoading />
        ) : error ? (
          <EmptyState title="Публикации недоступны" description={error}>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="action-primary"
            >
              <UiText text={'Повторить'} />
            </button>
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            title="Публикаций пока нет"
            description="Здесь появятся материалы редакции. Если включены фильтры, попробуйте изменить их."
          />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map((item) => (
              <article key={item.id} className="expert-card">
                <p className="eyebrow mb-4">{PUBLICATION_KINDS[item.kind]}</p>
                <h2 className="text-xl font-semibold">
                  <Link href={`/news/${item.id}`}>{item.title}</Link>
                </h2>
                <p className="my-4 text-sm text-slate-600 leading-7">
                  {item.summary}
                </p>
                {item.starts_at && (
                  <p className="flex gap-2 text-sm text-slate-500 mb-2">
                    <CalendarDays size={17} />
                    {new Date(item.starts_at).toLocaleString('ru-RU')}
                  </p>
                )}
                {item.location && (
                  <p className="text-sm text-slate-500">{item.location}</p>
                )}
                <Link
                  href={`/news/${item.id}`}
                  className="text-link mt-auto pt-5"
                >
                  <UiText text={'Читать подробнее'} />
                  <ArrowUpRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
