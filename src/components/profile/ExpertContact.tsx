'use client'

import { UiText } from '@/components/LocaleProvider'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
export function ExpertContact({
  expertId,
  currentUserId,
}: {
  expertId: string
  currentUserId?: string
}) {
  const [body, setBody] = useState(
    'Здравствуйте! Хочу обсудить возможность сотрудничества. Подскажите, пожалуйста, готовы ли вы рассмотреть новую инженерную задачу?',
  )
  const [existing, setExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => {
    let active = true
    if (!currentUserId) {
      setChecking(false)
      return
    }
    supabase
      .from('contact_requests')
      .select('id')
      .eq('sender_id', currentUserId)
      .eq('recipient_id', expertId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) {
          setExisting(Boolean(data))
          setChecking(false)
          if (error)
            setError(
              'Не удалось проверить прежние обращения. Обновите страницу.',
            )
        }
      })
    return () => {
      active = false
    }
  }, [currentUserId, expertId])
  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (busy || existing) return
    setBusy(true)
    setError('')
    try {
      const { error: issue } = await supabase.rpc('send_contact_request', {
        p_recipient: expertId,
        p_body: body.trim(),
      })
      if (issue) throw issue
      setExisting(true)
      setSuccess('Обращение отправлено. Ответ появится в разделе «Обращения».')
    } catch (issue) {
      setError(
        issue && typeof issue === 'object' && 'message' in issue
          ? String(issue.message)
          : 'Не удалось отправить обращение.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      id="contact"
      className="mt-6 rounded-xl border bg-white p-6 scroll-mt-32"
    >
      <h2 className="text-xl font-semibold">
        <UiText text={'Предложить сотрудничество'} />
      </h2>
      <p className="text-sm text-slate-500 mt-2 mb-4">
        Опишите задачу одним сообщением. Эксперт сможет ответить и принять или
        отклонить предложение. После согласия вы сможете создать проект и
        отправить приглашение.
      </p>
      {!currentUserId ? (
        <Link href="/auth" className="action-primary">
          Войти и написать эксперту
        </Link>
      ) : checking ? (
        <p>Проверяем обращения…</p>
      ) : existing ? (
        <p className="text-sm text-blue-800">
          {success || 'Вы уже отправляли обращение этому эксперту.'}{' '}
          <Link href="/inquiries" className="underline">
            Открыть обращения
          </Link>
        </p>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <label htmlFor="contact-message" className="filter-label">
            <UiText text={'Сообщение эксперту'} />
          </label>
          <textarea
            id="contact-message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            className="w-full"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {body.length} / 2000 · до 5 новых обращений за сутки
            </span>
            <button
              disabled={busy || Boolean(error && error.includes('проверить'))}
              type="submit"
              className="action-primary"
            >
              <UiText
                text={busy ? 'Отправляем…' : 'Отправить одно сообщение'}
              />
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 mt-3">
          {error}
        </p>
      )}
    </section>
  )
}
