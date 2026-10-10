'use client'

import { UiText } from '@/components/LocaleProvider'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
export function ProjectCompletion({
  projectId,
  isAuthor,
  completedAt,
  onCompleted,
}: {
  projectId: string
  isAuthor: boolean
  completedAt?: string | null
  onCompleted: (date: string) => void
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function complete() {
    if (
      busy ||
      !window.confirm(
        'Подтвердить завершение совместной работы? Состав команды и задачи будут зафиксированы, участники смогут оставить отзывы. Отменить завершение в интерфейсе нельзя.',
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const { data, error: issue } = await supabase
        .from('listings')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', projectId)
        .select('completed_at')
        .single()
      if (issue) throw issue
      onCompleted(data.completed_at)
    } catch (issue) {
      setError(
        issue && typeof issue === 'object' && 'message' in issue
          ? String(issue.message)
          : 'Не удалось завершить проект.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-xl border bg-white p-5 my-5">
      <h2 className="font-semibold">Завершение работы</h2>
      {completedAt ? (
        <p className="text-sm text-green-700 mt-2">
          Проект завершён {new Date(completedAt).toLocaleDateString('ru-RU')}.
          Команда и задачи зафиксированы. Участникам доступны отзывы.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-500 my-3">
            Отзывы доступны после завершения проекта автором. К этому моменту
            все задачи должны быть выполнены и в проекте должен быть хотя бы
            один принятый участник.
          </p>
          {isAuthor && (
            <button
              disabled={busy}
              onClick={complete}
              className="action-secondary"
            >
              <UiText
                text={busy ? 'Сохраняем…' : 'Подтвердить завершение проекта'}
              />
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 mt-3">
          {error}
        </p>
      )}
    </section>
  )
}
