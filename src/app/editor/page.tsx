'use client'

import { UiText } from '@/components/LocaleProvider'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
import { FormField } from '@/components/FormField'
import { LEGAL_TITLES, PUBLICATION_KINDS } from '@/lib/siteConfig'
import { safeWebUrl } from '@/lib/profileOptions'
type Draft = {
  id?: string
  title: string
  kind: string
  summary: string
  body: string
  starts_at: string
  location: string
  source_url: string
  status: string
}
const EMPTY: Draft = {
  title: '',
  kind: 'news',
  summary: '',
  body: '',
  starts_at: '',
  location: '',
  source_url: '',
  status: 'draft',
}
export default function EditorPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null),
    [tab, setTab] = useState('news'),
    [items, setItems] = useState<Draft[]>([]),
    [draft, setDraft] = useState<Draft>(EMPTY),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const [slug, setSlug] = useState('ethics'),
    [legalBody, setLegalBody] = useState(''),
    [version, setVersion] = useState(''),
    [legalPublished, setLegalPublished] = useState(false)
  async function loadItems() {
    const { data, error } = await supabase
      .from('publications')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      setMessage('Не удалось загрузить публикации.')
      return
    }
    setItems(data || [])
  }
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setAllowed(false)
        return
      }
      const { data, error } = await supabase.rpc('is_site_editor')
      setAllowed(!error && data === true)
      if (data === true) await loadItems()
    })
  }, [])
  useEffect(() => {
    if (!allowed) return
    let active = true
    setLegalBody('')
    setVersion('')
    supabase
      .from('legal_documents')
      .select('*')
      .eq('slug', slug)
      .single()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setMessage('Не удалось загрузить документ.')
          return
        }
        setLegalBody(data.body)
        setVersion(data.version)
        setLegalPublished(Boolean(data.published_at))
      })
    return () => {
      active = false
    }
  }, [slug, allowed])
  async function savePublication(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    if (draft.source_url && !safeWebUrl(draft.source_url)) {
      setMessage('Проверьте ссылку на первоисточник.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        ...draft,
        source_url: safeWebUrl(draft.source_url),
        starts_at: draft.starts_at
          ? new Date(draft.starts_at).toISOString()
          : null,
        published_at:
          draft.status === 'published' ? new Date().toISOString() : null,
      }
      const { error } = await supabase.from('publications').upsert(payload)
      if (error) throw error
      setDraft(EMPTY)
      setMessage('Публикация сохранена.')
      await loadItems()
    } catch {
      setMessage('Не удалось сохранить публикацию.')
    } finally {
      setBusy(false)
    }
  }
  async function saveLegal(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    if (
      legalPublished &&
      !window.confirm(
        'Опубликовать эту редакцию документа? Убедитесь, что текст согласован с юристом.',
      )
    )
      return
    setBusy(true)
    setMessage('')
    const { error } = await supabase
      .from('legal_documents')
      .update({
        body: legalBody,
        version,
        published_at: legalPublished ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('slug', slug)
    setMessage(error ? 'Не удалось сохранить документ.' : 'Документ сохранён.')
    setBusy(false)
  }
  if (allowed === null) return <PageLoading />
  if (!allowed)
    return (
      <div className="page-shell">
        <EmptyState
          title="Доступ только для редакторов"
          description="Этот раздел доступен назначенным редакторам платформы."
        />
      </div>
    )
  return (
    <div className="page-shell form-shell">
      <PageHeader
        title="Редактор платформы"
        description="Публикации сообщества и утверждённые юридические документы."
      />
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setTab('news')}
          className={tab === 'news' ? 'action-primary' : 'action-secondary'}
        >
          Публикации
        </button>
        <button
          onClick={() => setTab('legal')}
          className={tab === 'legal' ? 'action-primary' : 'action-secondary'}
        >
          Документы
        </button>
      </div>
      {message && (
        <p role="status" className="rounded-lg bg-blue-50 p-4 text-sm mb-5">
          {message}
        </p>
      )}
      {tab === 'news' ? (
        <>
          <form
            onSubmit={savePublication}
            className="rounded-2xl border bg-white p-6 space-y-4"
          >
            <FormField label="Название">
              <input
                required
                minLength={3}
                maxLength={200}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </FormField>
            <FormField label="Раздел">
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              >
                {Object.entries(PUBLICATION_KINDS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Краткое описание">
              <textarea
                maxLength={600}
                rows={3}
                value={draft.summary}
                onChange={(e) =>
                  setDraft({ ...draft, summary: e.target.value })
                }
              />
            </FormField>
            <FormField label="Текст (обычный текст, без HTML)">
              <textarea
                rows={10}
                maxLength={50000}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </FormField>
            <FormField label="Начало события (в часовом поясе вашего устройства)">
              <input
                type="datetime-local"
                value={draft.starts_at}
                onChange={(e) =>
                  setDraft({ ...draft, starts_at: e.target.value })
                }
              />
            </FormField>
            <FormField label="Место проведения">
              <input
                value={draft.location || ''}
                onChange={(e) =>
                  setDraft({ ...draft, location: e.target.value })
                }
              />
            </FormField>
            <FormField label="Первоисточник / сайт организатора">
              <input
                value={draft.source_url || ''}
                onChange={(e) =>
                  setDraft({ ...draft, source_url: e.target.value })
                }
                placeholder="https://…"
              />
            </FormField>
            <FormField label="Статус">
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="draft">Черновик</option>
                <option value="published">Опубликовано</option>
              </select>
            </FormField>
            <div className="flex gap-3">
              <button disabled={busy} className="action-primary">
                <UiText text={'Сохранить'} />
              </button>
              <button
                type="button"
                onClick={() => setDraft(EMPTY)}
                className="action-secondary"
              >
                Новая публикация
              </button>
            </div>
          </form>
          <div className="space-y-2 mt-6">
            {items.map((item) => (
              <button
                key={item.id}
                className="block w-full text-left rounded-xl border bg-white p-4"
                onClick={() => {
                  const date = item.starts_at ? new Date(item.starts_at) : null
                  setDraft({
                    ...item,
                    starts_at: date
                      ? new Date(
                          date.getTime() - date.getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : '',
                  })
                }}
              >
                {item.title} ·{' '}
                {item.status === 'published' ? 'Опубликовано' : 'Черновик'}
              </button>
            ))}
          </div>
        </>
      ) : (
        <form
          onSubmit={saveLegal}
          className="rounded-2xl border bg-white p-6 space-y-4"
        >
          <FormField label="Документ">
            <select value={slug} onChange={(e) => setSlug(e.target.value)}>
              {Object.entries(LEGAL_TITLES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Редакция / версия">
            <input
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="Например, 2026-10-04"
            />
          </FormField>
          <FormField label="Утверждённый текст">
            <textarea
              required
              minLength={20}
              rows={18}
              value={legalBody}
              onChange={(e) => setLegalBody(e.target.value)}
            />
          </FormField>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={legalPublished}
              onChange={(e) => setLegalPublished(e.target.checked)}
            />
            Текст утверждён и готов к публикации
          </label>
          <button disabled={busy} className="action-primary">
            Сохранить документ
          </button>
        </form>
      )}
    </div>
  )
}
