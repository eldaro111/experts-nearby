'use client'

import { StartupFields } from '@/components/StartupFields'
import { EMPTY_STARTUP, startupPayload } from '@/lib/startups'

import { UiText } from '@/components/LocaleProvider'

import { UniversityFields } from '@/components/UniversityFields'
import { TimezoneSelect } from '@/components/TimezoneSelect'
import { FormField } from '@/components/FormField'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppError, showAppMessage } from '@/lib/appFeedback'

export default function EditListingPage() {
  const { id } = useParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [listing, setListing] = useState<any>(null)

  // 🧩 Загружаем данные проекта
  useEffect(() => {
    const fetchListing = async () => {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        logAppError('Ошибка загрузки проекта:', error)
      } else {
        setListing(data)
      }
      setLoading(false)
    }

    if (id) fetchListing()
  }, [id])

  // 💾 Сохранение изменений
  const handleSave = async () => {
    if (saving || !listing) return

    const cleanTitle = String(listing.title || '').trim()
    const cleanDescription = String(listing.description || '').trim()

    if (!cleanTitle || !cleanDescription) {
      showAppMessage('Заполните название и описание проекта.', 'warning')
      return
    }

    setSaving(true)

    try {
      const { error } = await supabase
        .from('listings')
        .update({
          ...startupPayload({ ...EMPTY_STARTUP, ...listing }),
          title: cleanTitle,
          description: cleanDescription,
          roles_needed: Array.isArray(listing.roles_needed) ? listing.roles_needed : String(listing.roles_needed || '').split(',').map(s=>s.trim()).filter(Boolean),
          skills: Array.isArray(listing.skills) ? listing.skills : String(listing.skills || '').split(',').map(s=>s.trim()).filter(Boolean),
          timezone: listing.timezone,
          visibility: listing.visibility,
          university_id: listing.university_id || null, school_id: listing.school_id || null, study_group_id: listing.study_group_id || null,
        })
        .eq('id', id)

      if (error) {
        showAppError(error, 'Не удалось сохранить проект.', 'Сохранение проекта')
        return
      }

      showAppMessage('Проект успешно обновлён.', 'success')
      router.push('/listings')
    } catch (error) {
      showAppError(error, 'Не удалось сохранить проект.', 'Сохранение проекта')
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return <div className="text-center py-12">Загрузка проекта...</div>

  if (!listing)
    return (
      <div className="text-center py-12 text-gray-500">
        Проект не найден или у вас нет доступа.
      </div>
    )

  return (
    <div className="page-shell form-shell">
      <h1 className="text-3xl font-bold mb-6 text-center">
        Редактирование проекта
      </h1>

      <div className="space-y-5 rounded-2xl border bg-white p-6">
        <StartupFields value={{ ...EMPTY_STARTUP, ...listing }} onChange={value => setListing({ ...listing, ...value })} />
        <FormField label="Название проекта"><input
          type="text"
          value={listing.title || ''}
          onChange={(e) => setListing({ ...listing, title: e.target.value })}
          placeholder="Название проекта"
          className="border rounded p-2 w-full"
        /></FormField>

        <FormField label="Описание проекта"><textarea
          value={listing.description || ''}
          onChange={(e) =>
            setListing({ ...listing, description: e.target.value })
          }
          placeholder="Описание проекта"
          className="border rounded p-2 w-full h-32"
        /></FormField>

        <FormField label="Роли в команде"><input
          type="text"
          value={listing.roles_needed || ''}
          onChange={(e) =>
            setListing({ ...listing, roles_needed: e.target.value })
          }
          placeholder="Роли, требуемые в проекте"
          className="border rounded p-2 w-full"
        /></FormField>

        <FormField label="Нужные навыки"><input
          type="text"
          value={listing.skills || ''}
          onChange={(e) => setListing({ ...listing, skills: e.target.value })}
          placeholder="Навыки"
          className="border rounded p-2 w-full"
        /></FormField>

        <FormField label="Часовой пояс"><TimezoneSelect value={listing.timezone || ''} onChange={value => setListing({...listing,timezone:value})} /></FormField>
        <section><h2 className="font-semibold mb-4">Проект вуза (необязательно)</h2><UniversityFields value={{university_id:listing.university_id || null, school_id:listing.school_id || null, study_group_id:listing.study_group_id || null}} onChange={value=>setListing({...listing,...value})} allowCreate /></section>

        <FormField label="Видимость проекта"><select
          value={listing.visibility || 'public'}
          onChange={(e) =>
            setListing({ ...listing, visibility: e.target.value })
          }
          className="border rounded p-2 w-full"
        >
          <option value="public"><UiText text={"Публичный"}/></option>
          <option value="private">Приватный</option>
        </select></FormField>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition w-full"
        >
          {saving ? 'Сохраняем...' : 'Сохранить изменения'}
        </button>
      </div>
    </div>
  )
}
