'use client'

import { useEffect } from 'react'
import { getAppErrorMessage, logAppError } from '@/lib/appFeedback'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logAppError('Ошибка страницы', error)
  }, [error])

  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">
        Страница временно недоступна
      </h1>

      <p className="mt-4 text-gray-600">
        {getAppErrorMessage(
          error,
          'Не удалось загрузить страницу.'
        )}
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-blue-600 px-5 py-2 text-white transition hover:bg-blue-700"
      >
        Повторить
      </button>
    </main>
  )
}
