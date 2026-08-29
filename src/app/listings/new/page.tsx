'use client'

import React, { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'
import { useRouter } from 'next/navigation'

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
    <div className="max-w-2xl mx-auto py-12">
      <h1 className="text-3xl font-bold mb-6 text-center">Создать проект</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          className="border p-2 w-full"
          placeholder="Название проекта"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <textarea
          className="border p-2 w-full"
          placeholder="Описание проекта"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <input
          className="border p-2 w-full"
          placeholder="Роли (через запятую)"
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
        />
        <input
          className="border p-2 w-full"
          placeholder="Навыки (через запятую)"
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
        />
        <input
          className="border p-2 w-full"
          placeholder="Часовой пояс (например UTC+3)"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {loading ? 'Сохраняем...' : 'Опубликовать'}
        </button>
      </form>
    </div>
  )
}
