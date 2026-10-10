'use client'
import { useEffect, useState } from 'react'
import { useParams, notFound } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/PageState'
import { LEGAL_TITLES, siteConfig } from '@/lib/siteConfig'
type LegalDocument = { body: string; version: string; published_at: string }
export default function LegalPage() {
  const { slug } = useParams<{ slug: string }>()
  const [doc, setDoc] = useState<LegalDocument | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setDoc(null)
    supabase
      .from('legal_documents')
      .select('body,version,published_at')
      .eq('slug', slug)
      .not('published_at', 'is', null)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) {
          setDoc(data)
          setError(
            error
              ? 'Не удалось загрузить документ. Обновите страницу или свяжитесь с администрацией.'
              : '',
          )
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [slug])
  if (!LEGAL_TITLES[slug]) notFound()
  return (
    <div className="page-shell form-shell">
      <PageHeader
        title={LEGAL_TITLES[slug] || 'Документ не найден'}
        eyebrow="Документы платформы"
      />
      <section className="rounded-2xl border bg-white p-6 sm:p-8">
        {loading ? (
          <PageLoading />
        ) : error ? (
          <p role="alert">{error}</p>
        ) : doc ? (
          <>
            <p className="text-sm text-slate-500 mb-6">
              Редакция {doc.version} ·{' '}
              {new Date(doc.published_at).toLocaleDateString('ru-RU')}
            </p>
            <div className="whitespace-pre-wrap leading-8 break-words">
              {doc.body}
            </div>
          </>
        ) : (
          <p className="text-slate-600">
            Документ готовится к публикации. Действующая редакция появится на
            этой странице после утверждения.
          </p>
        )}
        {siteConfig.contactEmail && (
          <p className="border-t pt-5 mt-6 text-sm">
            Вопросы по документам:{' '}
            <a
              className="text-blue-700 underline"
              href={`mailto:${siteConfig.contactEmail}`}
            >
              {siteConfig.contactEmail}
            </a>
          </p>
        )}
      </section>
    </div>
  )
}
