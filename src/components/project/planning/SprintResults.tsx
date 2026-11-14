'use client'

import { useState } from 'react'
import { useLocale, useT } from '@/components/LocaleProvider'
import * as P from '@/lib/planning'
import { boardStatusLabel } from '@/lib/taskLabels'
import type { ProjectMember } from '../types'
import { OUTCOME_TEXT, eventText, formatHours, formatMoment, formatPoints, sprintTitle } from './text'
import { useMemberName } from './shared'
import type { PlanningController } from './usePlanning'

/**
 * Results of a closed sprint, read only from the server snapshots: the start snapshot (scope and
 * estimates at the start) and the final snapshot (outcome of every item at closing). Nothing is
 * recalculated from today's tasks. Points and hours are shown apart, with unestimated counters.
 */
export function SprintResults({ sprint, sprints, planning, members }: { sprint: P.Sprint; sprints: P.Sprint[]; planning: PlanningController; members: ProjectMember[] }) {
  const t = useT()
  const locale = useLocale()
  const name = useMemberName(members)
  const notEstimated = t('Не оценено')
  const [events, setEvents] = useState<{ status: 'idle' | 'loading' | 'error' } | { status: 'ready'; list: P.SprintEvent[] }>({ status: 'idle' })
  const final = sprint.final_snapshot
  const start = sprint.start_snapshot
  const sprintName = (id: string | null) => {
    const target = sprints.find((item) => item.id === id)
    return target ? sprintTitle(target, t) : t('другой спринт')
  }

  const totalsText = (totals: P.SnapshotTotals) => (
    <>
      {t('Задач')}: {totals.tasks} · {formatPoints(totals.story_points, locale, notEstimated)}
      {totals.unestimated_points ? ` (${t('без оценки')}: ${totals.unestimated_points})` : ''} · {formatHours(totals.planned_hours, locale, notEstimated)}
      {totals.unestimated_hours ? ` (${t('без часов')}: ${totals.unestimated_hours})` : ''}
    </>
  )

  const loadEvents = async () => {
    setEvents({ status: 'loading' })
    const result = await P.loadSprintEvents(planning.db, sprint.id)
    setEvents(result.ok ? { status: 'ready', list: result.data } : { status: 'error' })
  }

  return (
    <div className="planning-results">
      <p className="planning-hint">{t('Итоги сохранены сервером при закрытии и не пересчитываются по текущим задачам.')}{sprint.state === 'cancelled' ? ` ${t('Отменённый спринт не учитывается как выполненный.')}` : ''}</p>
      <div className="planning-stats">
        <div className="planning-stat">
          <span className="planning-label">{t('На старте')}</span>
          <p>{start ? totalsText(start.totals) : t('Спринт не начинался')}</p>
          {start && <span className="planning-hint">{formatMoment(start.captured_at, locale, '')}</span>}
        </div>
        {final && (
          <>
            <div className="planning-stat">
              <span className="planning-label">{t('При закрытии (выполнено, в бэклог, перенесено)')}</span>
              <p>{totalsText(final.totals)}</p>
              <span className="planning-hint">{formatMoment(final.captured_at, locale, '')}</span>
            </div>
            <div className="planning-stat is-done">
              <span className="planning-label">{t('Выполнено')}</span>
              <p>{totalsText(final.completed)}</p>
            </div>
          </>
        )}
      </div>
      {sprint.close_reason && <p className="planning-reason"><strong>{t(sprint.state === 'cancelled' ? 'Причина отмены' : 'Комментарий')}:</strong> {sprint.close_reason}</p>}

      {final && final.items.length > 0 && (
        <div className="planning-table-wrap">
          <table className="planning-table">
            <caption className="sr-only">{t('Состав спринта при закрытии')}</caption>
            <thead><tr><th scope="col">{t('Задача')}</th><th scope="col">{t('Итог')}</th><th scope="col">{t('Статус')}</th><th scope="col">Story Points</th><th scope="col">{t('Плановые часы')}</th></tr></thead>
            <tbody>
              {final.items.map((item) => (
                <tr key={item.item_id}>
                  <th scope="row">{item.task.title || t('Без названия')}</th>
                  <td>{item.outcome ? t(OUTCOME_TEXT[item.outcome]) : '—'}{item.outcome === 'moved' ? `: ${sprintName(item.destination_sprint_id)}` : ''}</td>
                  <td>{boardStatusLabel(item.task.status)}</td>
                  <td>{formatPoints(item.task.story_points, locale, notEstimated)}</td>
                  <td>{formatHours(item.task.planned_hours, locale, notEstimated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="planning-subblock">
        {events.status === 'idle' && <button type="button" className="planning-link" onClick={() => void loadEvents()}>{t('Показать историю спринта')}</button>}
        {events.status === 'loading' && <p className="planning-hint" role="status">{t('Загружаем историю…')}</p>}
        {events.status === 'error' && <p className="planning-hint" role="alert">{t('Не удалось загрузить историю.')} <button type="button" className="planning-link" onClick={() => void loadEvents()}>{t('Повторить')}</button></p>}
        {events.status === 'ready' && (
          <ol className="planning-events">
            {events.list.map((event) => (
              <li key={event.id}><span>{formatMoment(event.created_at, locale, '')}</span> {t(eventText(event.kind))}{event.actor_id ? ` — ${name(event.actor_id)}` : ''}</li>
            ))}
          </ol>
        )}
      </div>
      <p className="planning-hint">{t('Графики сгорания и скорости — следующий этап. Данные для них сервер уже сохраняет в снимках и истории спринта.')}</p>
    </div>
  )
}
