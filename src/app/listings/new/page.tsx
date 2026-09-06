'use client'

import React, { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { showAppError, showAppMessage } from '@/lib/appFeedback'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function NewListingPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [roles, setRoles] = useState('')
  const [skills, setSkills] = useState('')
  const [timezone, setTimezone] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (loading) return

    const cleanTitle = title.trim()
    const cleanDescription = description.trim()

    if (!cleanTitle || !cleanDescription) {
      showAppMessage('Заполните название и описание проекта.', 'warning')
      return
    }

    setLoading(true)

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        showAppError(userError, 'Не удалось проверить авторизацию.', 'Создание проекта')
        return
      }

      if (!user) {
        showAppMessage('Вы не авторизованы.', 'warning')
        router.replace('/auth')
        return
      }

      const { error } = await supabase.from('listings').insert([
        {
          title: cleanTitle,
          description: cleanDescription,
          roles_needed: roles
            .split(',')
            .map((role) => role.trim())
            .filter(Boolean),
          skills: skills
            .split(',')
            .map((skill) => skill.trim())
            .filter(Boolean),
          timezone: timezone.trim(),
          created_by: user.id,
          user_id: user.id,
        },
      ])

      if (error) {
        showAppError(error, 'Не удалось создать проект.', 'Создание проекта')
        return
      }

      showAppMessage('Проект успешно создан.', 'success')
      router.replace('/listings')
    } catch (error) {
      showAppError(error, 'Не удалось создать проект.', 'Создание проекта')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell form-shell">
      <Link href="/listings" className="text-link mb-5"><ArrowLeft size={17} />К проектам</Link>
      <PageHeader eyebrow="Новый проект" title="Расскажите о вашей задаче" description="Понятное описание поможет нужным специалистам найти проект и откликнуться." />
      <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading}>
        <div><label className="filter-label" htmlFor="listing-title">Название проекта <span className="text-blue-600">*</span></label><Input id="listing-title" placeholder="Например, система управления протезом кисти" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div><label className="filter-label" htmlFor="listing-description">Задача и ожидаемый результат <span className="text-blue-600">*</span></label><textarea id="listing-description" className="w-full min-h-44" placeholder="Что нужно сделать? На каком этапе проект? Какой результат вы ожидаете?" value={description} onChange={(e) => setDescription(e.target.value)} required /></div>
        <div className="border-t pt-6"><h2 className="text-lg font-semibold mb-5">Кого вы ищете</h2><div className="grid gap-5 sm:grid-cols-2">
          <div><label className="filter-label" htmlFor="listing-roles">Роли в команде</label><Input id="listing-roles" placeholder="Конструктор, программист" value={roles} onChange={(e) => setRoles(e.target.value)} aria-describedby="roles-hint" /><p id="roles-hint" className="text-xs text-gray-500 mt-2">Перечислите через запятую.</p></div>
          <div><label className="filter-label" htmlFor="listing-skills">Нужные навыки</label><Input id="listing-skills" placeholder="CAD, Python, электроника" value={skills} onChange={(e) => setSkills(e.target.value)} aria-describedby="skills-hint" /><p id="skills-hint" className="text-xs text-gray-500 mt-2">Перечислите через запятую.</p></div>
        </div></div>
        <div><label className="filter-label" htmlFor="listing-timezone">Часовой пояс</label><Input id="listing-timezone" placeholder="Например, UTC+3" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></div>
        <div className="border-t pt-6 flex flex-wrap justify-between items-center gap-4"><p className="text-sm text-gray-500">* Обязательные поля</p><Button type="submit" disabled={loading} className="action-primary">{loading ? 'Публикуем…' : 'Опубликовать проект'}<ArrowRight size={18} /></Button></div>
      </form>
    </div>
  )
}
