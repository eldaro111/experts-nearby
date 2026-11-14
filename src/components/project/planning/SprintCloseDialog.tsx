'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useLocale, useT } from '@/components/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import * as P from '@/lib/planning'
import { storePending, clearPending } from '@/lib/planningPending'
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
export function SprintCloseDialog({ sprint, cancel, initialRequest, planning, data, projectId, tasks, onClose, onClosed }: {
  sprint: P.Sprint
  cancel: boolean
  initialRequest: P.CloseSprintRequest | null
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
  const [step, setStep] = useState<'decide' | 'review'>(initialRequest ? 'review' : 'decide')
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries((initialRequest?.close.decisions ?? []).map((d) => [d.task_id, d.destination === 'backlog' ? 'backlog' : d.sprint_id])))
  const [reason, setReason] = useState(initialRequest?.close.reason ?? '')
  const [pending, setPending] = useState<P.CloseSprintRequest | null>(initialRequest)
  const [notice, setNotice] = useState<Notice>(null)
  const live = useRef(false)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const notEstimated = t('Не оценено')

  const scope = data.openItems.filter((item) => item.sprint_id === sprint.id)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const scopeTasks = scope.map((item) => (item.live_task_id ? byId.get(item.live_task_id) : undefined)).filter((task): task is Task => Boolean(task))
  const unfinished = P.unfinishedScope(scope, sprint.id, tasks)
  const done = scopeTasks.filter((task) => task.status === 'done')
  const planned = data.sprints.filter((item) => item.state === 'planned' && item.id !== sprint.id)
  const decided: P.Check<P.CloseDecision[]> = pending ? { ok: true, value: pending.close.decisions } : P.buildDecisions(choices, unfinished.map((task) => task.id), planned)
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
    const request = pending ?? { requestId: crypto.randomUUID(), sprintId: sprint.id, expectedVersion: sprint.version, close: { cancel, reason: reason.trim() || null, decisions: decided.value } }
    setPending(request); storePending(planning.userId!, projectId, request)
    const result = await planning.perform('close', (db) => P.closeSprintOnce(db, request))
    if (!live.current || !result) return
    if (result.ok) {
      clearPending(planning.userId!, projectId, request)
      onClosed(result.data, { tone: 'success', text: cancel ? 'Спринт отменён. Итоги сохранены.' : 'Спринт завершён. Итоги сохранены.' })
      return
    }
    if (P.uncertainWrite(result.error)) {
      await checkClosure(request)
      return
    }
    clearPending(planning.userId!, projectId, request); setPending(null)
    setStep('decide')
    setNotice(result.error.kind === 'conflict'
      ? { tone: 'warning', text: 'Спринт, его состав или целевой спринт изменились. Показаны актуальные данные — проверьте решения и подтвердите снова.', detail: result.error.message }
      : errorNotice(result.error))
  }

  const checkClosure = async (request: P.CloseSprintRequest) => {
    const check = await planning.inspect((db) => P.loadRequest(db, projectId, request.requestId))
    if (!live.current || !check) return
    if (check.ok && check.data?.kind === 'close_sprint' && check.data.actor_id === planning.userId && check.data.result.id === sprint.id) {
      clearPending(planning.userId!, projectId, request)
      onClosed(check.data.result, { tone: 'info', text: 'Закрытие подтверждено по идентификатору операции. Показаны сохранённые итоги.' })
      await planning.refresh()
    } else {
      setNotice({ tone: 'warning', text: 'Результат закрытия пока неизвестен. Отсутствие подтверждения не означает отказ. Можно проверить снова или явно повторить тот же запрос.' })
    }
  }

  const setAll = (value: string) => { setNotice(null); setChoices(Object.fromEntries(unfinished.map((task) => [task.id, value]))) }
  const title = `${t(cancel ? 'Отмена спринта' : 'Завершение спринта')}: ${sprint.name}`

  return (
    <Modal open onClose={() => { if (!planning.busy) onClose() }} className="planning-dialog" title={title} description={t(step === 'decide' ? 'Шаг 1 из 2: решение по каждой незавершённой задаче' : 'Шаг 2 из 2: проверьте итог')}>
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
          {pending && <p className="planning-warning">{t('Запрос уже отправлялся. Его решения и версия сохранены; повтор использует тот же идентификатор.')}</p>}
          {(sprint.state === 'completed' || sprint.state === 'cancelled') && <p className="planning-hint">{t('На сервере спринт закрыт. Это само по себе не подтверждает результат именно Вашего запроса.')}</p>}
          <NoticeBox notice={notice} />
          <div className="planning-actions">
            {pending && <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => void checkClosure(pending)}>{t('Проверить результат закрытия')}</button>}
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => void confirm()}>
              {t(planning.busy === 'close' ? 'Отправляем…' : pending ? 'Повторить тот же запрос' : cancel ? 'Подтвердить отмену' : 'Подтвердить завершение')}
            </button>
            <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy) || Boolean(pending)} onClick={() => { setStep('decide'); setNotice(null) }}>{t('Назад к решениям')}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
