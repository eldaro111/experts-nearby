'use client'

import { useEffect, useId, useState } from 'react'
import { useLocale, useT } from '@/components/LocaleProvider'
import * as P from '@/lib/planning'
import type { Task } from '../types'
import { formatHours, formatPoints } from './text'
import { NoticeBox, errorNotice, type Notice } from './shared'
import type { PlanningController } from './usePlanning'

/**
 * Estimates in every mode, as two separate fields: Story Points and planned hours. NULL means
 * «not estimated». Actual hours are the sum of the task's contributions, not a new field. Points are
 * never converted to hours or to a rating of a person.
 */
export function TaskPlanningEditor({ task, planning }: { task: Task; planning: PlanningController }) {
  const t = useT()
  const locale = useLocale()
  const id = useId()
  const fields = P.readTaskPlanning(task)
  const data = planning.data
  const [edit, setEdit] = useState<{ stage: string; points: string; hours: string; base: number } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [actual, setActual] = useState<{ taskId: string; hours: number | null; count: number } | 'error' | null>(null)
  const notEstimated = t('Не оценено')

  // Actual hours for this task only; an answer for another task (or after closing) is ignored.
  useEffect(() => {
    if (planning.status !== 'ready') return
    let current = true
    void P.loadTaskActualHours(planning.db, task.id).then((result) => {
      if (!current) return
      setActual(result.ok ? { taskId: task.id, hours: result.data.hours, count: result.data.contributions } : 'error')
    })
    return () => { current = false }
  }, [planning.db, planning.status, task.id])

  if (planning.status === 'unavailable' || (planning.status === 'ready' && !fields)) {
    return <p className="planning-hint">{t('Оценки задач появятся после обновления базы данных на сервере.')}</p>
  }
  if (planning.status !== 'ready' || !data || !fields) {
    return <p className="planning-hint">{t(planning.status === 'loading' ? 'Загружаем оценки…' : planning.status === 'session_changed' ? 'Аккаунт изменился — обновите страницу.' : 'Оценки сейчас недоступны.')}</p>
  }

  const stage = data.stages.find((item) => item.id === fields.stage_id) ?? null
  const canEdit = planning.caps.canEditTasks
  const showStages = data.stages.length > 0 && data.settings.mode !== 'simple'

  const begin = () => {
    setNotice(null)
    setConflict(false)
    setEdit({ stage: fields.stage_id ?? '', points: fields.story_points === null ? '' : String(fields.story_points), hours: fields.planned_hours === null ? '' : String(fields.planned_hours).replace('.', locale === 'ru' ? ',' : '.'), base: fields.planning_version })
  }

  const save = async (base: number) => {
    if (!edit) return
    const points = P.parseStoryPoints(edit.points)
    if (!points.ok) { setNotice({ tone: 'error', text: points.message }); return }
    const hours = P.parsePlannedHours(edit.hours)
    if (!hours.ok) { setNotice({ tone: 'error', text: hours.message }); return }
    const result = await planning.perform(`task-${task.id}`, (db) => P.editTaskPlanning(db, task.id, base, { stage_id: showStages ? edit.stage || null : fields.stage_id, story_points: points.value, planned_hours: hours.value }))
    if (!result) return
    if (result.ok) {
      setEdit(null)
      setConflict(false)
      setNotice({ tone: 'success', text: 'Оценка сохранена.' })
    } else {
      setConflict(result.error.kind === 'conflict')
      setNotice(errorNotice(result.error))
    }
  }

  const actualText = actual === null || actual === 'error' || actual.taskId !== task.id
    ? t(actual === 'error' ? 'не удалось загрузить' : 'загружаем…')
    : actual.hours === null ? t('нет записей с часами') : formatHours(actual.hours, locale, notEstimated)

  return (
    <section className="task-planning" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="task-planning-title">{t('Планирование')}</h3>
      {!edit ? (
        <>
          <dl className="task-details-list">
            {showStages && <div><dt>{t('Этап')}</dt><dd>{stage ? stage.name : t('Без этапа')}</dd></div>}
            <div><dt>Story Points</dt><dd>{formatPoints(fields.story_points, locale, notEstimated)}</dd></div>
            <div><dt>{t('Плановые часы')}</dt><dd>{formatHours(fields.planned_hours, locale, notEstimated)}</dd></div>
            <div><dt>{t('Фактические часы (по вкладам)')}</dt><dd>{actualText}</dd></div>
          </dl>
          {canEdit && <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={begin}>{t('Изменить оценку')}</button>}
        </>
      ) : (
        <form className="planning-inline-form" onSubmit={(event) => { event.preventDefault(); void save(edit.base) }}>
          <div className="planning-grid">
            {showStages && (
              <label className="planning-field">
                <span className="planning-label">{t('Этап')}</span>
                <select value={edit.stage} onChange={(e) => setEdit({ ...edit, stage: e.target.value })}>
                  <option value="">{t('Без этапа')}</option>
                  {data.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            <label className="planning-field">
              <span className="planning-label">Story Points</span>
              <select value={edit.points} onChange={(e) => setEdit({ ...edit, points: e.target.value })}>
                <option value="">{notEstimated}</option>
                {P.STORY_POINTS.map((value) => <option key={value} value={String(value)}>{value}</option>)}
              </select>
            </label>
            <label className="planning-field">
              <span className="planning-label">{t('Плановые часы')}</span>
              <input inputMode="decimal" value={edit.hours} placeholder={notEstimated} onChange={(e) => setEdit({ ...edit, hours: e.target.value })} aria-describedby={`${id}-hours`} />
              <span id={`${id}-hours`} className="planning-hint">{t('Больше 0 и не более 2000, до двух знаков после запятой. Пусто — не оценено.')}</span>
            </label>
          </div>
          {showStages && <p className="planning-hint">{t('Смена этапа меняет статус задачи на статус этапа.')}</p>}
          <div className="planning-actions">
            <button type="submit" className="action-primary planning-button" disabled={Boolean(planning.busy)}>{t(planning.busy === `task-${task.id}` ? 'Сохраняем…' : 'Сохранить оценку')}</button>
            <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setEdit(null); setConflict(false); setNotice(null) }}>{t('Отмена')}</button>
          </div>
        </form>
      )}
      <NoticeBox notice={notice}>
        {conflict && edit && (
          <>
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setEdit({ ...edit, base: fields.planning_version }); void save(fields.planning_version) }}>{t('Сохранить мою оценку поверх новой')}</button>
            <button type="button" className="action-secondary planning-button" onClick={() => { setEdit(null); setConflict(false); setNotice(null) }}>{t('Взять актуальные значения')}</button>
          </>
        )}
      </NoticeBox>
      {conflict && edit && (
        <p className="planning-hint">{t('Сейчас на сервере')}: {formatPoints(fields.story_points, locale, notEstimated)} · {formatHours(fields.planned_hours, locale, notEstimated)}{showStages ? ` · ${stage ? stage.name : t('Без этапа')}` : ''}</p>
      )}
    </section>
  )
}
