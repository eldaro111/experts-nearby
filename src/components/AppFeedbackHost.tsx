'use client'

import { useEffect, useState } from 'react'
import {
  appFeedbackEventName,
  drainPendingAppFeedback,
  setAppFeedbackHostReady,
  type AppFeedbackPayload,
} from '@/lib/appFeedback'

const toneClasses: Record<AppFeedbackPayload['tone'], string> = {
  success: 'border-green-200 bg-green-50 text-green-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
}

const toneLabels: Record<AppFeedbackPayload['tone'], string> = {
  success: 'Готово',
  error: 'Ошибка',
  warning: 'Обратите внимание',
  info: 'Информация',
}

export function AppFeedbackHost() {
  const [items, setItems] = useState<AppFeedbackPayload[]>([])

  useEffect(() => {
    let isMounted = true

    const handleFeedback = (event: Event) => {
      const payload = (
        event as CustomEvent<AppFeedbackPayload>
      ).detail

      if (!payload?.id || !payload.message) return

      setItems((current) => {
        const withoutDuplicate = current.filter(
          (item) => item.id !== payload.id
        )

        return [...withoutDuplicate, payload].slice(-4)
      })
    }

    window.addEventListener(
      appFeedbackEventName,
      handleFeedback
    )
    setAppFeedbackHostReady(true)

    queueMicrotask(() => {
      if (!isMounted) return

      const pending = drainPendingAppFeedback()
      if (pending.length > 0) {
        setItems((current) => [...current, ...pending].slice(-4))
      }
    })

    return () => {
      isMounted = false
      setAppFeedbackHostReady(false)
      window.removeEventListener(
        appFeedbackEventName,
        handleFeedback
      )
    }
  }, [])

  useEffect(() => {
    if (items.length === 0) return

    const timers = items.map((item) =>
      window.setTimeout(() => {
        setItems((current) =>
          current.filter(
            (currentItem) => currentItem.id !== item.id
          )
        )
      }, item.durationMs)
    )

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [items])

  if (items.length === 0) return null

  return (
    <div
      className="fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border p-4 shadow-lg ${toneClasses[item.tone]}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {toneLabels[item.tone]}
              </div>
              <div className="mt-1 break-words text-sm">
                {item.message}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setItems((current) =>
                  current.filter(
                    (currentItem) =>
                      currentItem.id !== item.id
                  )
                )
              }
              className="shrink-0 rounded px-2 py-1 text-sm opacity-70 hover:bg-black/5 hover:opacity-100"
              aria-label="Закрыть сообщение"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
