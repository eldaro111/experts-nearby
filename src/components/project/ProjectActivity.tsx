'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError } from '@/lib/appFeedback'

interface ProjectActivityProps {
  projectId: string
}

interface ProjectActivityRow {
  id: string
  project_id: string
  actor_id: string | null
  type: string
  title: string
  body: string | null
  entity_type: string | null
  entity_id: string | null
  metadata: Record<string, any>
  created_at: string
}

interface ActorProfile {
  user_id: string
  display_name: string | null
}

const activityTypeLabel = (type: string) => {
  const map: Record<string, string> = {
    project_member_added: 'Участник',
    project_member_added_via_auction: 'Аукцион',
    task_created: 'Задача',
    task_completed: 'Задача',
    task_status_changed: 'Задача',
    task_assignee_changed: 'Задача',
    task_deleted: 'Задача',
    file_uploaded: 'Файл',
    file_deleted: 'Файл',
    contribution_added: 'Вклад',
    contribution_verified: 'Вклад',
  }

  return map[type] || 'Событие'
}

const activityTone = (type: string) => {
  if (type.includes('auction')) return 'bg-purple-50 text-purple-700 border-purple-200'
  if (type.includes('task')) return 'bg-blue-50 text-blue-700 border-blue-200'
  if (type.includes('file')) return 'bg-amber-50 text-amber-700 border-amber-200'
  if (type.includes('contribution')) return 'bg-green-50 text-green-700 border-green-200'
  if (type.includes('member')) return 'bg-indigo-50 text-indigo-700 border-indigo-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

export function ProjectActivity({ projectId }: ProjectActivityProps) {
  const [items, setItems] = useState<ProjectActivityRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, ActorProfile>>({})
  const [loading, setLoading] = useState(false)

  const loadActivity = async () => {
    setLoading(true)

    const { data, error } = await supabase
      .from('project_activity')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(80)

    if (error) {
      logAppError('Ошибка загрузки истории проекта', error)
      setItems([])
      setProfiles({})
      setLoading(false)
      return
    }

    const loadedItems = (data || []) as ProjectActivityRow[]
    setItems(loadedItems)

    const actorIds = Array.from(
      new Set(
        loadedItems
          .map((item) => item.actor_id)
          .filter((actorId): actorId is string => Boolean(actorId))
      )
    )

    if (actorIds.length === 0) {
      setProfiles({})
      setLoading(false)
      return
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles_collaboration')
      .select('user_id, display_name')
      .in('user_id', actorIds)

    if (profileError) {
      logAppError('Ошибка загрузки авторов событий', profileError)
      setProfiles({})
    } else {
      const map = Object.fromEntries(
        ((profileData || []) as ActorProfile[]).map((profile) => [
          profile.user_id,
          profile,
        ])
      )

      setProfiles(map)
    }

    setLoading(false)
  }

  useEffect(() => {
    loadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const getActorName = (actorId: string | null) => {
    if (!actorId) return 'Система'
    return profiles[actorId]?.display_name || 'Участник проекта'
  }

  return (
    <div className="border rounded-xl bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-semibold">История действий</h2>
          <p className="text-sm text-gray-500 mt-1">
            Лента ключевых изменений в рабочей зоне проекта.
          </p>
        </div>

        <button
          onClick={loadActivity}
          disabled={loading}
          className="text-sm border rounded-lg px-3 py-2 hover:bg-gray-50 transition disabled:opacity-60"
        >
          {loading ? 'Обновляем...' : 'Обновить'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">
          Загружаем историю...
        </div>
      ) : items.length === 0 ? (
        <div className="border rounded-lg bg-gray-50 p-5 text-sm text-gray-500">
          История пока пустая. Новые задачи, файлы, вклад и события аукциона будут появляться здесь.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  className={`text-xs px-2 py-1 rounded-full border ${activityTone(item.type)}`}
                >
                  {activityTypeLabel(item.type)}
                </span>

                <span className="text-xs text-gray-500">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>

              <div className="font-medium text-gray-900">{item.title}</div>

              {item.body && (
                <div className="text-sm text-gray-600 mt-1">{item.body}</div>
              )}

              <div className="text-xs text-gray-400 mt-2">
                Автор события: {getActorName(item.actor_id)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
