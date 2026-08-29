'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type AccessState = 'checking' | 'allowed' | 'denied'

const ALLOWED_PASSWORD_FLOW_METHODS = new Set([
  'recovery',
  'invite',
  'magiclink',
  'otp',
  'email/signup',
])

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null

  const prefix = `${encodeURIComponent(name)}=`
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null
}

function hasPasswordFlowCookie(): boolean {
  return Boolean(getCookie('needs_pw_setup') || getCookie('needs_pw_reset'))
}

function getAuthMethods(claims: unknown): string[] {
  if (!claims || typeof claims !== 'object') return []

  const amr = (claims as Record<string, unknown>).amr
  if (!Array.isArray(amr)) return []

  return amr
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const method = (item as Record<string, unknown>).method
      return typeof method === 'string' ? method : null
    })
    .filter((method): method is string => Boolean(method))
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

  return 'Неизвестная ошибка.'
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="py-10 text-center text-gray-500">
          Проверяем ссылку...
        </div>
      }
    >
      <SetPasswordContent />
    </Suspense>
  )
}

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [accessState, setAccessState] = useState<AccessState>('checking')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const nextPath = useMemo(() => {
    const raw = searchParams.get('next') || '/profile'

    // Разрешаем только внутренний путь. `//example.com` тоже запрещён.
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/profile'

    return raw
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    let recoveryEventSeen = false

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryEventSeen = true

        if (!cancelled) {
          setAccessState('allowed')
        }
      }
    })

    const verifyPasswordFlow = async () => {
      const [claimsResult, userResult] = await Promise.all([
        supabase.auth.getClaims(),
        supabase.auth.getUser(),
      ])

      if (cancelled) return

      if (claimsResult.error || userResult.error || !userResult.data.user) {
        setAccessState('denied')
        return
      }

      setUserEmail(userResult.data.user.email ?? 'Без email')

      const methods = getAuthMethods(claimsResult.data?.claims)
      const allowedByClaims = methods.some((method) =>
        ALLOWED_PASSWORD_FLOW_METHODS.has(method)
      )

      // Cookie сохраняет совместимость с уже существующим callback/setup-flow.
      // Он не является отдельной границей авторизации: updateUser всё равно работает
      // только для владельца действующей Supabase-сессии.
      const allowedByExistingFlow = hasPasswordFlowCookie()

      setAccessState(
        allowedByClaims || allowedByExistingFlow || recoveryEventSeen
          ? 'allowed'
          : 'denied'
      )
    }

    void verifyPasswordFlow()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const clearLocks = () => {
    document.cookie =
      'needs_pw_setup=; Path=/; Max-Age=0; SameSite=Lax'
    document.cookie =
      'needs_pw_reset=; Path=/; Max-Age=0; SameSite=Lax'
  }

  const handleSetPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErr(null)

    if (accessState !== 'allowed') {
      setErr('Сессия установки пароля недействительна или уже истекла.')
      return
    }

    if (password.length < 8) {
      setErr('Пароль должен содержать минимум 8 символов.')
      return
    }

    if (password !== password2) {
      setErr('Пароли не совпадают.')
      return
    }

    setLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })

      if (error) throw error

      clearLocks()
      router.replace(nextPath)
      router.refresh()
    } catch (error: unknown) {
      setErr(`Не удалось установить пароль: ${getErrorMessage(error)}`)
    } finally {
      setLoading(false)
    }
  }

  if (accessState === 'checking') {
    return (
      <div className="py-10 text-center text-gray-500">
        Проверяем ссылку и сессию...
      </div>
    )
  }

  if (accessState === 'denied') {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            Ссылка недействительна
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-700">
            Сессия восстановления пароля отсутствует или уже истекла.
            Запросите новую ссылку восстановления.
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
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-center text-2xl font-bold">
        Придумайте новый пароль
      </h1>

      <p className="mb-4 text-center text-sm text-gray-600">
        Аккаунт: <b>{userEmail || 'Загрузка...'}</b>
      </p>

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
          {err}
        </div>
      )}

      <form onSubmit={handleSetPassword} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Новый пароль
          </span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Минимум 8 символов"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
            className="w-full rounded border p-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Повторите пароль
          </span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Повторите новый пароль"
            value={password2}
            onChange={(event) => setPassword2(event.target.value)}
            minLength={8}
            required
            className="w-full rounded border p-2"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-blue-600 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Сохраняем...' : 'Сохранить и продолжить'}
        </button>
      </form>
    </main>
  )
}