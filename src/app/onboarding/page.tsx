'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading } from '@/components/PageState'
import { ProfileEditor } from '@/components/profile/ProfileEditor'
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
          router.replace('/auth')
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
          onSaved={() => router.replace('/profile')}
        />
      </section>
    </div>
  )
}
