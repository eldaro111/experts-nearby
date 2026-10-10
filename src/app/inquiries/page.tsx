'use client'

import { UiText } from '@/components/LocaleProvider'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, PageLoading } from '@/components/PageState'
type Inquiry = {
  id: string
  sender_id: string
  recipient_id: string
  body: string
  status: 'pending' | 'accepted' | 'declined'
  reply: string | null
  project_id: string | null
  created_at: string
}
type Identity = { user_id: string; display_name: string; expert_code: string }
export default function InquiriesPage() {
  const [userId, setUserId] = useState(''),
    [items, setItems] = useState<Inquiry[]>([]),
    [people, setPeople] = useState<Record<string, Identity>>({})
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [tab, setTab] = useState<'incoming' | 'outgoing'>('incoming')
  const [replies, setReplies] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUserId(user?.id || '')
      if (!user) return
      const { data, error: issue } = await supabase
        .from('contact_requests')
        .select('*')
        .order('created_at', { ascending: false })
      if (issue) throw issue
      setItems(data || [])
      const ids = [
        ...new Set((data || []).flatMap((i) => [i.sender_id, i.recipient_id])),
      ]
      if (ids.length) {
        const { data: identities, error: identityError } = await supabase
          .from('profiles_collaboration')
          .select('user_id,display_name,expert_code')
          .in('user_id', ids)
        if (identityError) throw identityError
        setPeople(
          Object.fromEntries((identities || []).map((p) => [p.user_id, p])),
        )
      }
    } catch {
      setError('Не удалось загрузить обращения. Повторите попытку.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  async function respond(item: Inquiry, accept: boolean) {
    if (busy) return
    setBusy(item.id)
    setError('')
    try {
      const { error: issue } = await supabase.rpc('respond_contact_request', {
        p_id: item.id,
        p_accept: accept,
        p_reply: replies[item.id]?.trim() || null,
      })
      if (issue) throw issue
      await load()
    } catch {
      setError(
        'Не удалось сохранить ответ. Обновите список и повторите попытку.',
      )
    } finally {
      setBusy('')
    }
  }
  if (loading) return <PageLoading />
  const visible = items.filter((i) =>
    tab === 'incoming' ? i.recipient_id === userId : i.sender_id === userId,
  )
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Знакомство до проекта"
        title="Обращения"
        description="Одно предложение сотрудничества и один ответ. Дальнейшая работа — в проекте."
      >
        <button onClick={load} className="action-secondary">
          <UiText text={'Обновить'} />
        </button>
      </PageHeader>
      {!userId ? (
        <EmptyState
          title="Войдите в аккаунт"
          description="Обращения видны только отправителю и получателю."
        >
          <Link href="/auth" className="action-primary">
            <UiText text={'Войти'} />
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setTab('incoming')}
              aria-pressed={tab === 'incoming'}
              className={
                tab === 'incoming' ? 'action-primary' : 'action-secondary'
              }
            >
              <UiText text={'Входящие'} />
            </button>
            <button
              onClick={() => setTab('outgoing')}
              aria-pressed={tab === 'outgoing'}
              className={
                tab === 'outgoing' ? 'action-primary' : 'action-secondary'
              }
            >
              <UiText text={'Отправленные'} />
            </button>
          </div>
          {error ? (
            <p role="alert" className="p-4 rounded-lg bg-red-50 text-red-700">
              {error}
            </p>
          ) : visible.length === 0 ? (
            <EmptyState
              title="Обращений пока нет"
              description="Откройте профиль эксперта, чтобы предложить сотрудничество."
            />
          ) : (
            <div className="space-y-4">
              {visible.map((item) => {
                const other =
                  people[
                    item.sender_id === userId
                      ? item.recipient_id
                      : item.sender_id
                  ]
                return (
                  <article
                    key={item.id}
                    className="rounded-2xl border bg-white p-6 space-y-4"
                  >
                    <div className="flex flex-wrap justify-between gap-3">
                      <h2 className="font-semibold">
                        {other
                          ? `${other.expert_code} (${other.display_name || 'Профиль не заполнен'})`
                          : 'Участник платформы'}
                      </h2>
                      <span className="text-sm text-blue-700">
                        {
                          {
                            pending: 'Ожидает ответа',
                            accepted: 'Предложение принято',
                            declined: 'Предложение отклонено',
                          }[item.status]
                        }
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(item.created_at).toLocaleString('ru-RU')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-7">
                      {item.body}
                    </p>
                    {item.reply && (
                      <div className="rounded-xl bg-blue-50 p-4">
                        <h3 className="font-semibold text-sm mb-2">
                          <UiText text={'Ответ эксперта'} />
                        </h3>
                        <p className="text-sm whitespace-pre-wrap">
                          {item.reply}
                        </p>
                      </div>
                    )}
                    {item.recipient_id === userId &&
                      item.status === 'pending' && (
                        <div className="border-t pt-4 space-y-3">
                          <label
                            className="filter-label"
                            htmlFor={`reply-${item.id}`}
                          >
                            Ответ (необязательно)
                          </label>
                          <textarea
                            id={`reply-${item.id}`}
                            rows={3}
                            maxLength={2000}
                            value={replies[item.id] || ''}
                            onChange={(e) =>
                              setReplies({
                                ...replies,
                                [item.id]: e.target.value,
                              })
                            }
                            className="w-full"
                          />
                          <div className="flex flex-wrap gap-3">
                            <button
                              disabled={Boolean(busy)}
                              onClick={() => respond(item, true)}
                              className="action-primary"
                            >
                              <UiText text={'Готовы обсудить'} />
                            </button>
                            <button
                              disabled={Boolean(busy)}
                              onClick={() => respond(item, false)}
                              className="action-secondary"
                            >
                              <UiText text={'Отклонить'} />
                            </button>
                          </div>
                        </div>
                      )}
                    {item.status === 'accepted' &&
                      (item.project_id ? (
                        <Link
                          href={`/listings/${item.project_id}`}
                          className="action-secondary"
                        >
                          <UiText text={'Открыть проект'} />
                        </Link>
                      ) : item.sender_id === userId ? (
                        <Link
                          href={`/listings/new?contact=${item.id}`}
                          className="action-primary"
                        >
                          <UiText
                            text={'Создать проект и пригласить эксперта'}
                          />
                        </Link>
                      ) : (
                        <p className="text-sm text-slate-500">
                          Отправитель сможет создать проект и пригласить вас.
                        </p>
                      ))}
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
