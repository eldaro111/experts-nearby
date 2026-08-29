'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { showAppError, showAppMessage } from '@/lib/appFeedback'

const parseList = (value: string): string[] => value.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)
const numberOrNull = (value: string): number | null => { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
const parseLinksObject = (value: string): Record<string, string> => {
  const result: Record<string, string> = {}
  value.split('\n').map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex > 0) {
      const key = line.slice(0, separatorIndex).trim(); const url = line.slice(separatorIndex + 1).trim(); if (key && url) result[key] = url
    } else result[`Ссылка ${index + 1}`] = line
  })
  return result
}

export default function OnboardingPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [roles, setRoles] = useState('')
  const [skills, setSkills] = useState('')
  const [timezone, setTimezone] = useState('')
  const [availabilityHours, setAvailabilityHours] = useState('')
  const [city, setCity] = useState('')
  const [workFormat, setWorkFormat] = useState('')
  const [experienceLevel, setExperienceLevel] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [about, setAbout] = useState('')
  const [linksText, setLinksText] = useState('')
  const [portfolioLinksText, setPortfolioLinksText] = useState('')

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth'); return }
      setUser(user)
      const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle()
      if (profile) {
        setDisplayName(profile.display_name || '')
        setRoles(Array.isArray(profile.roles) ? profile.roles.join(', ') : profile.roles || '')
        setSkills(Array.isArray(profile.skills) ? profile.skills.join(', ') : profile.skills || '')
        setTimezone(profile.timezone || '')
        setAvailabilityHours(String(profile.availability_hours ?? ''))
        setCity(profile.city || '')
        setWorkFormat(profile.work_format || '')
        setExperienceLevel(profile.experience_level || '')
        setHourlyRate(String(profile.hourly_rate ?? ''))
        setAbout(profile.about || '')
        setLinksText(profile.links ? Object.entries(profile.links).map(([key, value]) => `${key}: ${String(value ?? '')}`).join('\n') : '')
        setPortfolioLinksText(Array.isArray(profile.portfolio_links) ? profile.portfolio_links.join('\n') : '')
      }
      setLoading(false)
    }
    loadUser()
  }, [router])

  const handleSubmit = async () => {
    if (!user?.id || saving) return

    if (!displayName.trim()) {
      showAppMessage('Укажи имя или никнейм.', 'warning')
      return
    }

    setSaving(true)

    const payload = {
      user_id: user.id,
      display_name: displayName.trim(),
      roles: parseList(roles),
      skills: parseList(skills),
      timezone: timezone.trim() || null,
      availability_hours: numberOrNull(availabilityHours),
      city: city.trim() || null,
      work_format: workFormat || null,
      experience_level: experienceLevel || null,
      hourly_rate: numberOrNull(hourlyRate),
      about: about.trim() || null,
      links: parseLinksObject(linksText),
      portfolio_links: parseList(portfolioLinksText),
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })

      if (error) {
        showAppError(error, 'Не удалось сохранить профиль.', 'Ошибка сохранения профиля')
        return
      }

      showAppMessage('Профиль сохранён.', 'success')
      router.replace('/dashboard')
    } catch (error) {
      showAppError(error, 'Не удалось сохранить профиль.', 'Ошибка сохранения профиля')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Загрузка...</div>

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold text-center mb-3">Настройка профиля</h1>
      <p className="text-center text-gray-600 mb-8">Заполни экспертную анкету. Эти данные используются в каталоге экспертов и при приглашениях в проекты.</p>
      <div className="bg-white border rounded-xl shadow-sm p-6 space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Имя / никнейм" className="border rounded-lg p-2 w-full" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Город" className="border rounded-lg p-2 w-full" />
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Часовой пояс, например UTC+7" className="border rounded-lg p-2 w-full" />
          <input type="number" value={availabilityHours} onChange={(e) => setAvailabilityHours(e.target.value)} placeholder="Доступность, часов в неделю" className="border rounded-lg p-2 w-full" />
          <select value={workFormat} onChange={(e) => setWorkFormat(e.target.value)} className="border rounded-lg p-2 w-full bg-white"><option value="">Формат работы</option><option value="remote">Удалённо</option><option value="onsite">Очно</option><option value="hybrid">Гибрид</option></select>
          <select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)} className="border rounded-lg p-2 w-full bg-white"><option value="">Уровень опыта</option><option value="junior">Junior</option><option value="middle">Middle</option><option value="senior">Senior</option><option value="expert">Expert</option></select>
          <input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="Ставка, ₽/час" className="border rounded-lg p-2 w-full" />
          <input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Роли через запятую" className="border rounded-lg p-2 w-full" />
          <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Навыки через запятую" className="border rounded-lg p-2 w-full md:col-span-2" />
        </div>
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} placeholder="О себе: опыт, специализация, сильные стороны" className="border rounded-lg p-2 w-full min-h-28" />
        <textarea value={linksText} onChange={(e) => setLinksText(e.target.value)} placeholder={'Ссылки, по одной на строку. Например:\nGitHub: github.com/name\nTelegram: t.me/name'} className="border rounded-lg p-2 w-full min-h-24" />
        <textarea value={portfolioLinksText} onChange={(e) => setPortfolioLinksText(e.target.value)} placeholder="Портфолио, по одной ссылке на строку" className="border rounded-lg p-2 w-full min-h-24" />
        <div className="flex justify-end gap-3"><button onClick={() => router.push('/dashboard')} className="px-4 py-2 rounded border text-gray-700 hover:bg-gray-100">Пропустить</button><button onClick={handleSubmit} disabled={saving} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Сохраняем...' : 'Сохранить профиль'}</button></div>
      </div>
    </div>
  )
}