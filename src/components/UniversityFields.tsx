'use client'

import { UiText } from '@/components/LocaleProvider'
import { useEffect, useId, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  EMPTY_UNIVERSITY_PATH,
  type UniversityPath,
} from '@/lib/profileOptions'
type Entry = {
  id: string
  name: string
  university_id?: string
  school_id?: string
  verified?: boolean
}
export function UniversityFields({
  value,
  onChange,
  allowCreate = false,
  lockedUniversity = false,
}: {
  value: UniversityPath
  onChange: (value: UniversityPath) => void
  allowCreate?: boolean
  lockedUniversity?: boolean
}) {
  const id = useId()
  const [universities, setUniversities] = useState<Entry[]>([])
  const [schools, setSchools] = useState<Entry[]>([])
  const [groups, setGroups] = useState<Entry[]>([])
  const [creating, setCreating] = useState(false)
  const [names, setNames] = useState({ university: '', school: '', group: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([
      supabase.from('universities').select('id,name,verified').order('name'),
      supabase
        .from('university_schools')
        .select('id,name,university_id')
        .order('name'),
      supabase
        .from('university_groups')
        .select('id,name,school_id')
        .order('name'),
    ])
      .then((results) => {
        if (!active) return
        if (results.some((r) => r.error)) {
          setError('Не удалось загрузить справочник вузов. Повторите загрузку.')
          return
        }
        setError('')
        setUniversities(results[0].data || [])
        setSchools(results[1].data || [])
        setGroups(results[2].data || [])
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить справочник вузов.')
      })
    return () => {
      active = false
    }
  }, [attempt])
  async function addPath() {
    if (!names.university.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const { data, error: issue } = await supabase.rpc(
        'propose_university_path',
        {
          p_university: names.university.trim(),
          p_school: names.school.trim() || null,
          p_group: names.group.trim() || null,
        },
      )
      if (issue) throw issue
      onChange(data as UniversityPath)
      setCreating(false)
      setAttempt((n) => n + 1)
    } catch {
      setError(
        'Не удалось добавить вуз. Войдите в аккаунт и проверьте названия. Новую запись можно добавлять не чаще одного раза в минуту.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="university-fields space-y-3">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="filter-label" htmlFor={`${id}-uni`}>
            <UiText text={'Вуз'} />
          </label>
          <select
            id={`${id}-uni`}
            disabled={lockedUniversity}
            value={value.university_id || ''}
            onChange={(e) =>
              onChange({
                ...EMPTY_UNIVERSITY_PATH,
                university_id: e.target.value || null,
              })
            }
            className="w-full"
          >
            <option value="">
              <UiText text={'Не выбран'} />
            </option>
            {universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="filter-label" htmlFor={`${id}-school`}>
            <UiText text={'Направление / инженерная школа'} />
          </label>
          <select
            id={`${id}-school`}
            disabled={!value.university_id}
            value={value.school_id || ''}
            onChange={(e) =>
              onChange({
                ...value,
                school_id: e.target.value || null,
                study_group_id: null,
              })
            }
            className="w-full"
          >
            <option value="">
              <UiText text={'Все направления'} />
            </option>
            {schools
              .filter((s) => s.university_id === value.university_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="filter-label" htmlFor={`${id}-group`}>
            <UiText text={'Учебная группа'} />
          </label>
          <select
            id={`${id}-group`}
            disabled={!value.school_id}
            value={value.study_group_id || ''}
            onChange={(e) =>
              onChange({ ...value, study_group_id: e.target.value || null })
            }
            className="w-full"
          >
            <option value="">
              <UiText text={'Все группы'} />
            </option>
            {groups
              .filter((g) => g.school_id === value.school_id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      {error && (
        <div role="alert" className="text-sm text-red-700">
          {error}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <UiText text={'Повторить'} />
          </button>
        </div>
      )}
      {allowCreate && (
        <>
          <button
            type="button"
            className="text-sm text-blue-700 underline"
            onClick={() => {
              setNames({
                university:
                  universities.find((u) => u.id === value.university_id)
                    ?.name || '',
                school:
                  schools.find((s) => s.id === value.school_id)?.name || '',
                group: '',
              })
              setCreating(!creating)
            }}
          >
            <UiText text={'Нет вашего вуза, направления или группы?'} />
          </button>
          {creating && (
            <div className="rounded-xl border bg-blue-50 p-4 space-y-3">
              <p className="text-sm">
                Добавьте полные названия. Запись и принадлежность к вузу
                считаются указанными пользователем до проверки представителем
                вуза.
              </p>
              {(['university', 'school', 'group'] as const).map(
                (key, index) => (
                  <div key={key}>
                    <label
                      className="filter-label"
                      htmlFor={`${id}-${key}-new`}
                    >
                      {
                        [
                          'Название вуза',
                          'Направление / школа (необязательно)',
                          'Группа (нужно выбрать направление)',
                        ][index]
                      }
                    </label>
                    <input
                      id={`${id}-${key}-new`}
                      maxLength={key === 'group' ? 80 : 160}
                      value={names[key]}
                      onChange={(e) =>
                        setNames({ ...names, [key]: e.target.value })
                      }
                      className="w-full"
                    />
                  </div>
                ),
              )}
              <button
                type="button"
                onClick={addPath}
                disabled={
                  busy ||
                  !names.university.trim() ||
                  Boolean(names.group.trim() && !names.school.trim())
                }
                className="action-primary"
              >
                <UiText text={busy ? 'Добавляем…' : 'Добавить в справочник'} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
