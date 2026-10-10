'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { PageLoading, EmptyState } from '@/components/PageState'
import { supabase } from '@/lib/supabaseClient'
import { PUBLICATION_KINDS } from '@/lib/siteConfig'
import { safeWebUrl } from '@/lib/profileOptions'
type Publication = {
  title: string
  kind: string
  body: string
  summary: string
  starts_at: string | null
  location: string | null
  source_url: string | null
  published_at: string
}
export default function PublicationPage() {
  const { id } = useParams<{ id: string }>()
  const [item, setItem] = useState<Publication | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    supabase
      .from('publications')
      .select('*')
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) {
          setItem(data)
          setError(error ? 'Не удалось загрузить публикацию.' : '')
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [id])
  if (loading) return <PageLoading />
  return (
    <div className="page-shell form-shell">
      <Link className="text-link mb-6" href="/news">
        ← События и новости
      </Link>
      {error || !item ? (
        <EmptyState
          title="Публикация недоступна"
          description={error || 'Материал не опубликован или удалён.'}
        />
      ) : (
        <article className="rounded-2xl border bg-white p-6 sm:p-8">
          <p className="eyebrow mb-4">{PUBLICATION_KINDS[item.kind]}</p>
          <h1 className="text-3xl font-bold leading-tight">{item.title}</h1>
          <p className="text-slate-500 text-sm mt-4">
            {new Date(item.published_at).toLocaleDateString('ru-RU')}
            {item.location ? ` · ${item.location}` : ''}
          </p>
          {item.starts_at && (
            <p className="text-blue-700 text-sm mt-3">
              Начало: {new Date(item.starts_at).toLocaleString('ru-RU')}
            </p>
          )}
          <p className="mt-6 text-lg text-slate-600">{item.summary}</p>
          <div className="mt-6 whitespace-pre-wrap leading-8 text-slate-700 break-words">
            {item.body}
          </div>
          {safeWebUrl(item.source_url) && (
            <a
              className="action-secondary mt-6"
              href={safeWebUrl(item.source_url)!}
              rel="noopener noreferrer"
              target="_blank"
            >
              Сайт организатора / первоисточник
            </a>
          )}
        </article>
      )}
    </div>
  )
}
