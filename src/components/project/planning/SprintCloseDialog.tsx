'use client'

import { useId, useState } from 'react'
import { useLocale, useT } from '@/components/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import * as P from '@/lib/planning'
import { boardStatusLabel } from '@/lib/taskLabels'
import type { Task } from '../types'
import { formatHours, formatPoints, sprintTitle } from './text'
import { NoticeBox, errorNotice, type Notice } from './shared'
import type { PlanningController, PlanningData } from './usePlanning'

/**
 * Completion or cancellation of a sprint. Step 1: an explicit decision for exactly each unfinished task
 * (backlog or a planned sprint of this project) and, for a cancellation, the reason. Step 2: the summary
 * to check. Then one atomic server call. Statuses of tasks are never changed here, nothing is duplicated.
 * After a timeout the sprint is read again: the result is shown as it is on the server, never re-sent
 * automatically.
 */
export function SprintCloseDialog({ sprint, cancel, planning, data, projectId, tasks, onClose, onClosed }: {
  sprint: P.Sprint
  cancel: boolean
  planning: PlanningController
  data: PlanningData
  projectId: string
  tasks: Task[]
  onClose: () => void
  onClosed: (sprint: P.Sprint, notice: Notice) => void
}) {
  const t = useT()
  const locale = useLocale()
  const id = useId()
  const [step, setStep] = useState<'decide' | 'review'>('decide')
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  const notEstimated = t('Не оценено')

  const scope = data.openItems.filter((item) => item.sprint_id === sprint.id)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const scopeTasks = scope.map((item) => (item.live_task_id ? byId.get(item.live_task_id) : undefined)).filter((task): task is Task => Boolean(task))
  const unfinished = P.unfinishedScope(scope, sprint.id, tasks)
  const done = scopeTasks.filter((task) => task.status === 'done')
  const planned = data.sprints.filter((item) => item.state === 'planned' && item.id !== sprint.id)
  const decided = P.buildDecisions(choices, unfinished.map((task) => task.id), planned)
  const sprintName = (sprintId: string) => {
    const target = data.sprints.find((item) => item.id === sprintId)
    return target ? sprintTitle(target, t) : t('Спринт')
  }
  const estimates = (list: Task[]) => P.sumEstimates(list.map((task) => ({ story_points: task.story_points ?? null, planned_hours: task.planned_hours ?? null })))
  const doneTotals = estimates(done)

  const toReview = () => {
    const reasonCheck = P.checkCloseReason(cancel, reason)
    if (reasonCheck) { setNotice({ tone: 'error', text: reasonCheck }); return }
    if (!decided.ok) { setNotice({ tone: 'error', text: decided.message }); return }
    setNotice(null)
    setStep('review')
  }

  const confirm = async () => {
    if (!decided.ok) { setStep('decide'); return }
    const startedAt = P.requestMoment()
    const result = await planning.perform('close', (db) => P.closeSprint(db, sprint.id, sprint.version, { cancel, reason: reason.trim() || null, decisions: decided.value }))
    if (!result) return
    if (result.ok) {
      onClosed(result.data, { tone: 'success', text: cancel ? 'Спринт отменён. Итоги сохранены.' : 'Спринт завершён. Итоги сохранены.' })
      return
    }
    if (result.error.kind === 'timeout' || result.error.kind === 'network') {
      // The outcome is unknown: read the sprint again instead of sending the same request twice.
      const check = await P.loadSprints(planning.db, projectId)
      const now = check.ok ? check.data.find((item) => item.id === sprint.id) : undefined
      if (now && (now.state === 'completed' || now.state === 'cancelled') && now.closed_at && new Date(now.closed_at).getTime() >= startedAt - 120_000) {
        onClosed(now, { tone: 'info', text: 'Ответ сервера не дошёл, но спринт уже закрыт: показаны сохранённые итоги. Повторно запрос не отправлялся.' })
        return
      }
      setStep('review')
      setNotice({ tone: 'warning', text: now ? 'Сервер не подтвердил закрытие: спринт не закрыт. Проверьте решения и отправьте ещё раз, если нужно.' : 'Не удалось проверить результат. Обновите данные, прежде чем повторять.' })
      return
    }
    setStep('decide')
    setNotice(result.error.kind === 'conflict'
      ? { tone: 'warning', text: 'Спринт, его состав или целевой спринт изменились. Показаны актуальные данные — проверьте решения и подтвердите снова.', detail: result.error.message }
      : errorNotice(result.error))
  }

  const setAll = (value: string) => { setNotice(null); setChoices(Object.fromEntries(unfinished.map((task) => [task.id, value]))) }
  const title = `${t(cancel ? 'Отмена спринта' : 'Завершение спринта')}: ${sprint.name}`

  return (
    <Modal open onClose={onClose} className="planning-dialog" title={title} description={t(step === 'decide' ? 'Шаг 1 из 2: решение по каждой незавершённой задаче' : 'Шаг 2 из 2: проверьте итог')}>
      {step === 'decide' ? (
        <div className="planning-dialog-body">
          <p className="planning-hint">{t('Выполненные задачи останутся в итогах спринта. Для каждой незавершённой задачи выберите, куда она пойдёт. Статусы задач не меняются.')}</p>
          {unfinished.length === 0 ? (
            <p className="planning-empty">{t('Незавершённых задач нет — решения не нужны.')}</p>
          ) : (
            <>
              <div className="planning-actions">
                <button type="button" className="action-secondary planning-button" onClick={() => setAll('backlog')}>{t('Все в бэклог')}</button>
                {planned.map((target) => (
                  <button key={target.id} type="button" className="action-secondary planning-button" onClick={() => setAll(target.id)}>{t('Все в')} {sprintName(target.id)}</button>
                ))}
              </div>
              <ul className="planning-decisions">
                {unfinished.map((task) => (
                  <li key={task.id}>
                    <label className="planning-field">
                      <span className="planning-label">{task.title} <span className="planning-item-meta">· {boardStatusLabel(task.status)}</span></span>
                      <select value={choices[task.id] ?? ''} onChange={(e) => { setNotice(null); setChoices({ ...choices, [task.id]: e.target.value }) }} aria-describedby={`${id}-help`}>
                        <option value="">{t('Выберите решение')}</option>
                        <option value="backlog">{t('Вернуть в бэклог')}</option>
                        {planned.map((target) => <option key={target.id} value={target.id}>{t('Перенести в')} {sprintName(target.id)}</option>)}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
              <p id={`${id}-help`} className="planning-hint">{t(planned.length ? 'Перенести можно только в планируемый спринт этого проекта.' : 'Планируемых спринтов нет: задачи можно вернуть в бэклог.')}</p>
            </>
          )}
          <label className="planning-field">
            <span className="planning-label">{t(cancel ? 'Причина отмены (обязательно)' : 'Комментарий к итогам (необязательно)')}</span>
            <textarea rows={2} maxLength={P.REASON_MAX} value={reason} required={cancel} onChange={(e) => { setNotice(null); setReason(e.target.value) }} />
          </label>
          <NoticeBox notice={notice} />
          <div className="planning-actions">
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={toReview}>{t('Проверить итог')}</button>
            <button type="button" className="action-secondary planning-button" onClick={onClose}>{t('Отмена')}</button>
          </div>
        </div>
      ) : (
        <div className="planning-dialog-body">
          <dl className="planning-dl">
            <div><dt>{t('Выполнено')}</dt><dd>{done.length} · {formatPoints(doneTotals.story_points, locale, notEstimated)} · {formatHours(doneTotals.planned_hours, locale, notEstimated)}</dd></div>
            <div><dt>{t('Вернутся в бэклог')}</dt><dd>{decided.ok ? decided.value.filter((d) => d.destination === 'backlog').length : 0}</dd></div>
            {decided.ok && P.summarizeClose(scopeTasks, decided.value).moved.map((item) => (
              <div key={item.sprintId}><dt>{t('Перенесутся в')} {sprintName(item.sprintId)}</dt><dd>{item.count}</dd></div>
            ))}
            {cancel && <div><dt>{t('Причина отмены')}</dt><dd>{reason.trim()}</dd></div>}
          </dl>
          <p className="planning-hint">{t('Суммы показаны по текущим оценкам. Окончательный итог сохранит сервер в момент закрытия; позже он не изменится, даже если задачи отредактируют или удалят.')}</p>
          {cancel && <p className="planning-hint">{t('Отменённый спринт хранится отдельно и не учитывается как выполненный.')}</p>}
          <NoticeBox notice={notice} />
          <div className="planning-actions">
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => void confirm()}>
              {t(planning.busy === 'close' ? 'Отправляем…' : cancel ? 'Подтвердить отмену' : 'Подтвердить завершение')}
            </button>
            <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setStep('decide'); setNotice(null) }}>{t('Назад к решениям')}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
