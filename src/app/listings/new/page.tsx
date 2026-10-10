'use client'

import { UiText } from '@/components/LocaleProvider'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { showAppError, showAppMessage } from '@/lib/appFeedback'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { UniversityFields } from '@/components/UniversityFields'
import { TimezoneSelect } from '@/components/TimezoneSelect'
import { EMPTY_UNIVERSITY_PATH, type UniversityPath } from '@/lib/profileOptions'
import { Input } from '@/components/ui/input'

export default function NewListingPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [roles, setRoles] = useState('')
  const [skills, setSkills] = useState('')
  const [timezone, setTimezone] = useState('')
  const [loading, setLoading] = useState(false)
  const [university,setUniversity] = useState<UniversityPath>(EMPTY_UNIVERSITY_PATH)
  const [contactId,setContactId] = useState('')
  const [contactError,setContactError] = useState('')
  useEffect(() => {
    const contact = new URLSearchParams(window.location.search).get('contact')
    if (!contact) return
    setContactId(contact)
    supabase.from('contact_requests').select('id,body,status,project_id,sender_id').eq('id',contact).single().then(async ({data,error}) => {
      const {data:{user}} = await supabase.auth.getUser()
      if (error || !data || data.sender_id !== user?.id || data.status !== 'accepted') { setContactError('Обращение недоступно или эксперт ещё не принял предложение.'); return }
      if (data.project_id) { router.replace(`/listings/${data.project_id}`); return }
      setDescription(data.body)
    })
  },[router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (loading || contactError) return

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

      const rolesList = roles.split(',').map(role=>role.trim()).filter(Boolean)
      const skillsList = skills.split(',').map(skill=>skill.trim()).filter(Boolean)
      let projectId: string | null = null
      let error
      if (contactId) {
        const result = await supabase.rpc('create_project_from_contact', {
          p_contact: contactId, p_title: cleanTitle, p_description: cleanDescription,
          p_roles: rolesList, p_skills: skillsList, p_timezone: timezone || null,
          p_university: university.university_id, p_school: university.school_id, p_group: university.study_group_id,
        })
        projectId = result.data; error = result.error
      } else {
        const result = await supabase.from('listings').insert({
          title: cleanTitle, description: cleanDescription, roles_needed: rolesList, skills: skillsList,
          timezone: timezone || null, created_by: user.id, user_id: user.id, ...university,
        }).select('id').single()
        projectId = result.data?.id || null; error = result.error
      }

      if (error) {
        showAppError(error, 'Не удалось создать проект.', 'Создание проекта')
        return
      }

      showAppMessage('Проект успешно создан.', 'success')
      router.replace(projectId ? `/listings/${projectId}` : '/listings')
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
      {contactError && <p role="alert" className="mb-4 text-red-700">{contactError}</p>}
      {contactId && !contactError && <p className="mb-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">Описание перенесено из обращения. Уточните задачу: после создания эксперт получит приглашение в проект.</p>}
      <form onSubmit={handleSubmit} className="space-y-6" aria-busy={loading}>
        <div><label className="filter-label" htmlFor="listing-title">Название проекта <span className="text-blue-600">*</span></label><Input id="listing-title" placeholder="Например, система управления протезом кисти" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div><label className="filter-label" htmlFor="listing-description">Задача и ожидаемый результат <span className="text-blue-600">*</span></label><textarea id="listing-description" className="w-full min-h-44" placeholder="Что нужно сделать? На каком этапе проект? Какой результат вы ожидаете?" value={description} onChange={(e) => setDescription(e.target.value)} required /></div>
        <div className="border-t pt-6"><h2 className="text-lg font-semibold mb-5">Кого вы ищете</h2><div className="grid gap-5 sm:grid-cols-2">
          <div><label className="filter-label" htmlFor="listing-roles">Роли в команде</label><Input id="listing-roles" placeholder="Конструктор, технический переводчик, технический писатель" value={roles} onChange={(e) => setRoles(e.target.value)} aria-describedby="roles-hint" /><p id="roles-hint" className="text-xs text-gray-500 mt-2">Перечислите через запятую.</p></div>
          <div><label className="filter-label" htmlFor="listing-skills">Нужные навыки</label><Input id="listing-skills" placeholder="CAD, Python, электроника" value={skills} onChange={(e) => setSkills(e.target.value)} aria-describedby="skills-hint" /><p id="skills-hint" className="text-xs text-gray-500 mt-2">Перечислите через запятую.</p></div>
        </div></div>
        <div><label className="filter-label" htmlFor="listing-timezone"><UiText text={"Часовой пояс"}/></label><TimezoneSelect id="listing-timezone" value={timezone} onChange={setTimezone} /></div>
        <section className="border-t pt-6"><h2 className="text-lg font-semibold mb-4">Проект вуза (необязательно)</h2><UniversityFields value={university} onChange={setUniversity} allowCreate /></section>
        <div className="border-t pt-6 flex flex-wrap justify-between items-center gap-4"><p className="text-sm text-gray-500">* Обязательные поля</p><Button type="submit" disabled={loading} className="action-primary">{loading ? 'Публикуем…' : 'Опубликовать проект'}<ArrowRight size={18} /></Button></div>
      </form>
    </div>
  )
}
