'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

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

  return 'Не удалось отправить письмо восстановления.'
}

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadCurrentEmail = async () => {
      const { data } = await supabase.auth.getUser()

      if (!cancelled && data.user?.email) {
        setEmail(data.user.email)
      }
    }

    void loadCurrentEmail()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSent(false)

    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      setError('Введите email.')
      return
    }

    setLoading(true)

    try {
      // Удаляем старый локальный маркер, если пользователь раньше уже проходил recovery.
      document.cookie =
        'needs_pw_reset=; Path=/; Max-Age=0; SameSite=Lax'

      const redirectTo =
        `${window.location.origin}/auth/callback?type=recovery`

      const { error: resetError } =
        await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo,
        })

      if (resetError) throw resetError

      // Сообщение намеренно одинаковое для существующего и несуществующего email.
      setSent(true)
    } catch (submitError: unknown) {
      setError(getErrorMessage(submitError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <section className="rounded-xl border bg-white p-6 shadow-sm">
        <p className="mb-2 text-sm font-medium text-blue-700">
          Восстановление доступа
        </p>

        <h1 className="text-2xl font-bold text-gray-900">
          Сброс пароля
        </h1>

        <p className="mt-3 text-sm leading-6 text-gray-600">
          Введите email аккаунта. Мы отправим ссылку, после перехода
          по которой можно будет установить новый пароль.
        </p>

        {sent ? (
          <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="font-medium text-green-800">
              Проверьте почту
            </div>

            <p className="mt-2 text-sm leading-6 text-green-700">
              Если аккаунт с таким email существует, письмо со ссылкой
              восстановления уже отправлено. Проверьте также папку «Спам».
            </p>

            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-4 text-sm font-medium text-green-800 underline"
            >
              Отправить ещё раз
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </span>

              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
                className="w-full rounded-lg border px-3 py-2 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Отправляем...' : 'Отправить ссылку'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link
            href="/auth"
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            Вернуться ко входу
          </Link>
        </div>
      </section>
    </main>
  )
}