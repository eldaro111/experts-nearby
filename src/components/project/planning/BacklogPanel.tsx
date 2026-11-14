'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { useLocale, useT } from '@/components/LocaleProvider'
import * as P from '@/lib/planning'
import { boardStatusLabel } from '@/lib/taskLabels'
import { formatHours, formatMoment, formatPoints, sprintTitle } from './text'
import { NoticeBox, errorNotice, useMemberName, type Notice, type PanelProps } from './shared'

const PAGE = 200

/**
 * The backlog in server order. Moves change a local draft; «Сохранить порядок» sends the whole list of
 * UUIDs with the backlog version in one call. Only the author and the current Product Owner reorder.
 * Selected tasks can be added to a planned (or, for managers, the active) sprint.
 */
export function BacklogPanel({ planning, data, projectId, members, onOpenTask }: PanelProps) {
  const t = useT()
  const locale = useLocale()
  const id = useId()
  const name = useMemberName(members)
  const backlog = data.backlog
  const [draft, setDraft] = useState<{ order: string[]; base: number } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [announcement, setAnnouncement] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const refocus = useRef<string | null>(null)
  const notEstimated = t('Не оценено')

  useEffect(() => {
    if (!refocus.current) return
    document.querySelector<HTMLElement>(`[data-backlog-handle="${CSS.escape(refocus.current)}"]`)?.focus()
    refocus.current = null
  })

  if (!backlog) return <p className="planning-hint">{t('Бэклог пока недоступен на сервере.')}</p>

  const byId = new Map(backlog.tasks.map((task) => [task.id, task]))
  const order = (draft?.order ?? backlog.tasks.map((task) => task.id)).filter((taskId) => byId.has(taskId))
  const canReorder = planning.caps.canReorderBacklog && backlog.tasks.length <= P.MAX_BACKLOG
  const targets = data.sprints.filter((sprint) => sprint.state === 'planned' || (sprint.state === 'active' && planning.caps.canManage))
  const selectedHere = selected.filter((taskId) => byId.has(taskId))

  const move = (index: number, to: number) => {
    if (!canReorder || to < 0 || to >= order.length) return
    const next = P.moveInOrder(order, index, to)
    setDraft({ order: next, base: draft?.base ?? backlog.version })
    setNotice(null)
    const task = byId.get(order[index])
    refocus.current = order[index]
    if (to >= shown) setShown(to + 1)
    setAnnouncement(`${t('Задача')} «${task?.title ?? ''}»: ${t('позиция')} ${to + 1} ${t('из')} ${order.length}`)
  }

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : null
    if (to === null) return
    event.preventDefault()
    move(index, to)
  }

  const save = async (base: number, ids: string[]) => {
    const result = await planning.perform('backlog', (db) => P.reorderBacklog(db, projectId, base, ids))
    if (!result) return
    if (result.ok) {
      setDraft(null)
      setConflict(false)
      setNotice({ tone: 'success', text: 'Порядок бэклога сохранён.' })
    } else {
      setConflict(result.error.kind === 'conflict')
      setNotice(errorNotice(result.error))
    }
  }

  const addSelected = async () => {
    const sprint = targets.find((item) => item.id === target)
    if (!sprint || selectedHere.length === 0) return
    const tasks = selectedHere.map((taskId) => ({ task_id: taskId, expected_version: (byId.get(taskId) as P.PlanningTask).planning_version }))
    const result = await planning.perform('backlog-add', (db) => P.addTasksToSprint(db, sprint.id, sprint.version, tasks))
    if (!result) return
    if (result.ok) {
      setSelected([])
      setNotice({ tone: 'success', text: `${t('Задачи добавлены в спринт')} «${sprint.name}».` })
    } else setNotice(errorNotice(result.error))
  }

  const totals = P.sumEstimates(backlog.tasks)
  return (
    <div className="planning-block" aria-labelledby={`${id}-title`}>
      <div className="planning-block-head">
        <h3 id={`${id}-title`} className="planning-block-title">{t('Бэклог')}</h3>
        <p className="planning-hint">
          {t('Задач')}: {backlog.tasks.length} · {formatPoints(totals.story_points, locale, notEstimated)}{totals.unestimated_points ? ` (${t('без оценки')}: ${totals.unestimated_points})` : ''} · {formatHours(totals.planned_hours, locale, notEstimated)}{totals.unestimated_hours ? ` (${t('без часов')}: ${totals.unestimated_hours})` : ''}
        </p>
      </div>
      <p className="planning-hint">
        {t(canReorder
          ? 'Порядок меняется кнопками или клавишами ↑/↓ (Home/End) на ручке задачи и сохраняется целиком.'
          : backlog.tasks.length > P.MAX_BACKLOG ? 'В бэклоге больше 5000 задач: порядок такого списка нельзя сохранить целиком.' : 'Порядок бэклога меняют автор проекта и Product Owner.')}
      </p>
      <p className="sr-only" id={`${id}-keys`}>{t('Стрелки вверх и вниз перемещают задачу, Home и End — в начало и конец списка.')}</p>
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {draft && (
        <div className="planning-draft-bar" role="status">
          <span>{t('Порядок изменён, но ещё не сохранён.')}</span>
          <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => void save(draft.base, order)}>{t(planning.busy === 'backlog' ? 'Сохраняем…' : 'Сохранить порядок')}</button>
          <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setDraft(null); setConflict(false); setNotice(null) }}>{t('Отменить перестановки')}</button>
        </div>
      )}
      <NoticeBox notice={notice}>
        {conflict && draft && (
          <>
            <button type="button" className="action-primary planning-button" onClick={() => { setDraft({ order: P.reapplyOrder(draft.order, backlog.tasks.map((task) => task.id)), base: backlog.version }); setConflict(false); setNotice({ tone: 'info', text: 'Ваш порядок применён к актуальному списку. Проверьте его и сохраните.' }) }}>{t('Применить мой порядок к актуальному списку')}</button>
            <button type="button" className="action-secondary planning-button" onClick={() => { setDraft(null); setConflict(false); setNotice(null) }}>{t('Оставить порядок с сервера')}</button>
          </>
        )}
      </NoticeBox>

      {order.length === 0 ? (
        <p className="planning-empty">{t('Бэклог пуст: все незавершённые задачи уже в спринтах, или задач пока нет.')}</p>
      ) : (
        <ol className="planning-list" aria-label={t('Задачи бэклога по приоритету')}>
          {order.slice(0, shown).map((taskId, index) => {
            const task = byId.get(taskId) as P.PlanningTask
            return (
              <li key={taskId} className="planning-item" data-backlog-task={taskId}>
                <span className="planning-rank" aria-hidden="true">{index + 1}</span>
                {targets.length > 0 && !planning.caps.readOnly && (
                  <input type="checkbox" className="planning-select" aria-label={`${t('Выбрать задачу')} «${task.title}»`} checked={selected.includes(taskId)} onChange={(e) => setSelected((list) => (e.target.checked ? [...list, taskId] : list.filter((item) => item !== taskId)))} />
                )}
                <div className="planning-item-main">
                  <button type="button" className="planning-task-link" onClick={() => onOpenTask(taskId)}>{task.title}</button>
                  <span className="planning-item-meta">
                    {boardStatusLabel(task.status)} · {formatPoints(task.story_points, locale, notEstimated)} · {formatHours(task.planned_hours, locale, notEstimated)} · {name(task.assignee_id)}{task.due_at ? ` · ${t('до')} ${formatMoment(task.due_at, locale, '')}` : ''}
                  </span>
                </div>
                {canReorder && (
                  <div className="planning-order-controls">
                    <button type="button" className="planning-handle" data-backlog-handle={taskId} aria-label={`${t('Порядок задачи')} «${task.title}»: ${index + 1} ${t('из')} ${order.length}`} aria-describedby={`${id}-keys`} disabled={Boolean(planning.busy)} onKeyDown={(event) => onHandleKey(event, index)}>
                      <GripVertical size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="planning-icon-button" aria-label={`${t('Выше')}: ${task.title}`} disabled={index === 0 || Boolean(planning.busy)} onClick={() => move(index, index - 1)}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" className="planning-icon-button" aria-label={`${t('Ниже')}: ${task.title}`} disabled={index === order.length - 1 || Boolean(planning.busy)} onClick={() => move(index, index + 1)}><ArrowDown size={16} aria-hidden="true" /></button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {order.length > shown && (
        <button type="button" className="action-secondary planning-button" onClick={() => setShown((value) => value + PAGE)}>
          {t('Показать ещё')} ({order.length - shown})
        </button>
      )}

      {targets.length > 0 && !planning.caps.readOnly && order.length > 0 && (
        <div className="planning-add-bar">
          <label className="planning-field">
            <span className="planning-label">{t('Добавить выбранные задачи в спринт')}</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('Выберите спринт')}</option>
              {targets.map((sprint) => <option key={sprint.id} value={sprint.id}>{`${sprintTitle(sprint, t)}${sprint.state === 'active' ? ` (${t('идёт')})` : ''}`}</option>)}
            </select>
          </label>
          <button type="button" className="action-primary planning-button" disabled={!target || selectedHere.length === 0 || Boolean(planning.busy)} onClick={() => void addSelected()}>
            {t('Добавить')} ({selectedHere.length})
          </button>
        </div>
      )}
    </div>
  )
}
