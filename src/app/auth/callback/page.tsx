'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

function getHashParams() {
  const hash =
    typeof window !== 'undefined' ? window.location.hash : ''

  return new URLSearchParams(
    hash.startsWith('#') ? hash.slice(1) : hash
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }

  return 'Ссылка недействительна или уже истекла.'
}

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState(
    'Проверяем ссылку авторизации...'
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const url = new URL(window.location.href)
      const hashParams = getHashParams()

      const type =
        url.searchParams.get('type') ||
        hashParams.get('type') ||
        ''

      const code = url.searchParams.get('code')
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')

      const authError =
        url.searchParams.get('error_description') ||
        url.searchParams.get('error') ||
        hashParams.get('error_description') ||
        hashParams.get('error')

      try {
        if (authError) {
          throw new Error(authError)
        }

        const hasCodePayload = Boolean(code)
        const hasHashPayload = Boolean(accessToken && refreshToken)
        const hasAuthPayload = hasCodePayload || hasHashPayload

        if (code) {
          setMessage('Подтверждаем код...')

          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code)

          if (exchangeError) throw exchangeError
        } else if (accessToken && refreshToken) {
          setMessage('Устанавливаем сессию...')

          const { error: sessionError } =
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

          if (sessionError) throw sessionError
        }

        const { data: userResult, error: userError } =
          await supabase.auth.getUser()

        if (userError) throw userError

        const user = userResult.user

        if (!user) {
          throw new Error(
            'Не удалось подтвердить пользователя. Запросите новую ссылку.'
          )
        }

        const { data: profile, error: profileError } =
          await supabase
            .from('profiles')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle()

        if (profileError) {
          console.error(
            'Ошибка проверки профиля в auth callback:',
            profileError
          )
        }

        if (type === 'recovery') {
          // Нельзя считать обычную уже существующую сессию recovery-сессией.
          // Должен присутствовать реальный code либо токены из письма.
          if (!hasAuthPayload) {
            throw new Error(
              'Ссылка восстановления отсутствует или уже была использована.'
            )
          }

          document.cookie =
            'needs_pw_reset=1; Path=/; Max-Age=1800; SameSite=Lax'

          const nextPath = profile ? '/profile' : '/onboarding'

          router.replace(
            `/auth/set-password?next=${encodeURIComponent(nextPath)}`
          )
          return
        }

        if (!profile) {
          if (type === 'magiclink' || type === 'invite') {
            document.cookie =
              'needs_pw_setup=1; Path=/; Max-Age=1800; SameSite=Lax'

            router.replace(
              '/auth/set-password?next=%2Fonboarding'
            )
            return
          }

          router.replace('/onboarding')
          return
        }

        router.replace('/profile')
      } catch (callbackError: unknown) {
        if (cancelled) return

        console.error('Auth callback error:', callbackError)
        setError(getErrorMessage(callbackError))
        setMessage('')
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [router])

  if (error) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            Не удалось открыть ссылку
          </h1>

          <p className="mt-3 text-sm leading-6 text-red-700">
            {error}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth/reset-password"
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Запросить новую ссылку
            </Link>

            <Link
              href="/auth"
              className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Вернуться ко входу
            </Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="py-10 text-center text-gray-600">
      {message}
    </div>
  )
}