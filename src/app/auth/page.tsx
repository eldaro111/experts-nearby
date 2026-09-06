'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { UsersRound, ListChecks, FolderLock, ArrowRight, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
    <div className="auth-layout">
      <aside className="auth-intro">
        <p className="eyebrow">Эксперты рядом</p>
        <h2>Ваш следующий<br />проект начинается<br />с людей.</h2>
        <p>Присоединяйтесь к специалистам, которые превращают инженерные идеи в результат.</p>
        <div className="auth-benefits"><div><UsersRound size={22} />Команда под вашу задачу</div><div><ListChecks size={22} />Понятный план работы</div><div><FolderLock size={22} />Закрытая рабочая зона</div></div>
      </aside>
      <div className="auth-card">
        <h1>{isLogin ? 'С возвращением' : 'Создать аккаунт'}</h1>
        <p className="auth-subtitle">{isLogin ? 'Войдите, чтобы продолжить работу над проектами.' : 'Укажите email и придумайте пароль.'}</p>
        {errorText && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorText}</div>}
        {successText && <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{successText}</div>}
        <form onSubmit={handleAuth} className="space-y-5" aria-busy={loading}>
          <div><label htmlFor="auth-email">Электронная почта</label><Input id="auth-email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={loading} className="w-full disabled:bg-gray-100" /></div>
          <div><label htmlFor="auth-password">Пароль</label><Input id="auth-password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder={isLogin ? 'Введите пароль' : 'Не менее 8 символов'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={isLogin ? undefined : 8} disabled={loading} className="w-full disabled:bg-gray-100" /></div>
          <Button type="submit" disabled={loading} className="action-primary auth-submit">{activeAction === 'password' ? 'Подождите…' : isLogin ? 'Войти' : 'Зарегистрироваться'}<ArrowRight size={18} /></Button>
        </form>
        <div className="mt-5 flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={handleMagicLink} disabled={loading || !email.trim()} className="action-secondary w-full"><Mail size={18} />{activeAction === 'magic-link' ? 'Отправляем ссылку…' : 'Получить ссылку для входа'}</Button>
          <button type="button" onClick={handleForgotPassword} disabled={loading || !email.trim()} className="min-h-11 text-sm text-blue-700 hover:underline disabled:opacity-50">{activeAction === 'reset-password' ? 'Отправляем письмо…' : 'Забыли пароль?'}</button>
        </div>
        <p className="border-t pt-5 mt-5 text-center text-sm text-gray-600">{isLogin ? 'Впервые здесь?' : 'Уже есть аккаунт?'}{' '}<button type="button" onClick={switchMode} disabled={loading} className="min-h-11 font-semibold text-blue-700 hover:underline disabled:opacity-50">{isLogin ? 'Создать аккаунт' : 'Войти'}</button></p>
      </div>
    </div>
  )
}
