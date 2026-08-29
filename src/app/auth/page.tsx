'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type AuthAction = 'password' | 'magic-link' | 'reset-password' | null

function isNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()

  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('fetch failed')
  )
}

function getAuthErrorMessage(error: unknown) {
  if (isNetworkError(error)) {
    return 'Сервис входа временно недоступен. Проверьте интернет, VPN и блокировщики, затем повторите попытку.'
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''

  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) {
    return 'Неверный email или пароль.'
  }

  if (normalized.includes('email not confirmed')) {
    return 'Сначала подтвердите email по ссылке из письма.'
  }

  if (normalized.includes('user already registered')) {
    return 'Аккаунт с таким email уже существует.'
  }

  if (
    normalized.includes('password should be') ||
    normalized.includes('weak password')
  ) {
    return 'Пароль слишком простой. Используйте не менее 8 символов.'
  }

  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('over_email_send_rate_limit')
  ) {
    return 'Слишком много попыток. Подождите немного и повторите.'
  }

  return message || 'Не удалось выполнить операцию авторизации.'
}

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLogin, setIsLogin] = useState(true)
  const [activeAction, setActiveAction] = useState<AuthAction>(null)
  const [errorText, setErrorText] = useState('')
  const [successText, setSuccessText] = useState('')

  const router = useRouter()
  const loading = activeAction !== null

  const getOrigin = () =>
    typeof window !== 'undefined' ? window.location.origin : ''

  const startAction = (action: AuthAction) => {
    setActiveAction(action)
    setErrorText('')
    setSuccessText('')
  }

  const finishAction = () => {
    setActiveAction(null)
  }

  const handleLoginPassword = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      setErrorText(getAuthErrorMessage(error))
      return
    }

    if (!data.user) {
      setErrorText('Supabase не вернул данные пользователя.')
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', data.user.id)
      .maybeSingle()

    if (profileError) {
      setSuccessText('Вход выполнен. Открываем профиль...')
      router.replace('/profile')
      router.refresh()
      return
    }

    router.replace(profile ? '/profile' : '/onboarding')
    router.refresh()
  }

  const handleSignUpPassword = async () => {
    const origin = getOrigin()

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?type=signup`,
      },
    })

    if (error) {
      setErrorText(getAuthErrorMessage(error))
      return
    }

    if (data.session) {
      router.replace('/onboarding')
      router.refresh()
      return
    }

    setSuccessText(
      'Письмо для подтверждения отправлено. Проверьте входящие и папку «Спам».'
    )
    setIsLogin(true)
  }

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault()

    if (loading) return

    startAction('password')

    try {
      if (isLogin) {
        await handleLoginPassword()
      } else {
        await handleSignUpPassword()
      }
    } catch (error) {
      setErrorText(getAuthErrorMessage(error))
    } finally {
      finishAction()
    }
  }

  const handleMagicLink = async () => {
    if (loading) return

    if (!email.trim()) {
      setErrorText('Введите email.')
      return
    }

    startAction('magic-link')

    try {
      const origin = getOrigin()

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${origin}/auth/callback?type=magiclink`,
        },
      })

      if (error) {
        setErrorText(getAuthErrorMessage(error))
        return
      }

      setSuccessText(
        'Ссылка для входа отправлена. Проверьте входящие и папку «Спам».'
      )
    } catch (error) {
      setErrorText(getAuthErrorMessage(error))
    } finally {
      finishAction()
    }
  }

  const handleForgotPassword = async () => {
    if (loading) return

    if (!email.trim()) {
      setErrorText('Введите email.')
      return
    }

    startAction('reset-password')

    try {
      const origin = getOrigin()

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${origin}/auth/callback?type=recovery`,
        }
      )

      if (error) {
        setErrorText(getAuthErrorMessage(error))
        return
      }

      setSuccessText(
        'Письмо для сброса пароля отправлено. Проверьте входящие и папку «Спам».'
      )
    } catch (error) {
      setErrorText(getAuthErrorMessage(error))
    } finally {
      finishAction()
    }
  }

  const switchMode = () => {
    if (loading) return

    setIsLogin((current) => !current)
    setErrorText('')
    setSuccessText('')
  }

  return (
    <div className="max-w-sm mx-auto py-16 px-4">
      <h1 className="text-2xl font-bold mb-6 text-center">
        {isLogin ? 'Вход' : 'Регистрация'}
      </h1>

      {errorText && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {errorText}
        </div>
      )}

      {successText && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700"
        >
          {successText}
        </div>
      )}

      <form onSubmit={handleAuth} className="space-y-4">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={loading}
          className="border rounded w-full p-2 disabled:bg-gray-100 disabled:text-gray-500"
        />

        <input
          type="password"
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          placeholder="Пароль"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={isLogin ? undefined : 8}
          disabled={loading}
          className="border rounded w-full p-2 disabled:bg-gray-100 disabled:text-gray-500"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activeAction === 'password'
            ? 'Подождите...'
            : isLogin
              ? 'Войти'
              : 'Зарегистрироваться'}
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleMagicLink}
          disabled={loading || !email.trim()}
          className="w-full border py-2 rounded hover:bg-gray-50 transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activeAction === 'magic-link'
            ? 'Отправляем ссылку...'
            : 'Войти по Magic Link'}
        </button>

        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={loading || !email.trim()}
          className="w-full text-sm text-blue-600 underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {activeAction === 'reset-password'
            ? 'Отправляем письмо...'
            : 'Забыли пароль?'}
        </button>
      </div>

      <p className="text-center mt-4 text-sm text-gray-600">
        {isLogin ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}{' '}
        <button
          type="button"
          onClick={switchMode}
          disabled={loading}
          className="text-blue-600 underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLogin ? 'Зарегистрироваться' : 'Войти'}
        </button>
      </p>
    </div>
  )
}