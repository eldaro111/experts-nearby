'use client'

import { useEffect } from 'react'
import { getAppErrorMessage, logAppError } from '@/lib/appFeedback'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logAppError('Критическая ошибка приложения', error)
  }, [error])

  return (
    <html lang="ru">
      <body>
        <main
          style={{
            maxWidth: 640,
            margin: '0 auto',
            padding: '64px 24px',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1>Приложение временно недоступно</h1>
          <p>
            {getAppErrorMessage(
              error,
              'Произошла непредвиденная ошибка.'
            )}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: '10px 18px',
              border: 0,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Повторить
          </button>
        </main>
      </body>
    </html>
  )
}
