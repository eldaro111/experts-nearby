'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/PageState'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
import { returnPathFromLocation } from '@/lib/authReturn'
import { resolveAccessibleDestination } from '@/lib/projectAccess'
import { signInHref } from '@/lib/safeRedirect'
export default function OnboardingPage() {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const {
          data: { user },
          error: issue,
        } = await supabase.auth.getUser()
        if (!user) {
          // A destination chosen before sign-in survives a lost session.
          const next = returnPathFromLocation()
          router.replace(next ? signInHref(next) : '/auth')
          return
        }
        if (issue) throw issue
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()
        if (profileError) throw profileError
        if (active) {
          setUserId(user.id)
          setProfile(data)
          setLoaded(true)
        }
      } catch {
        if (active)
          setError(
            'Не удалось загрузить профиль. Обновите страницу и повторите попытку.',
          )
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [router])
  if (error)
    return (
      <div className="page-shell" role="alert">
        {error}
      </div>
    )
  if (!loaded) return <PageLoading />
  return (
    <div className="page-shell form-shell">
      <PageHeader
        eyebrow="Знакомство с платформой"
        title="Расскажите о себе"
        description="Заполните профиль. Если вы учитесь или работаете в вузе, укажите его, направление и учебную группу."
      />
      <section className="rounded-2xl border bg-white p-6">
        <ProfileEditor
          userId={userId}
          initial={profile || {}}
          onSaved={async () => {
            // `?next=` — the section chosen before sign-in; onboarding itself is never a destination.
            const next = returnPathFromLocation()
            router.replace(next ? await resolveAccessibleDestination(next, userId) : '/profile')
          }}
        />
      </section>
    </div>
  )
}
