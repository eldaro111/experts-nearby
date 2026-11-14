'use client'

import { useId, useState } from 'react'
import { useLocale, useT } from '@/components/LocaleProvider'
import * as P from '@/lib/planning'
import { readPendingCreate, readPendingClose, storePending, clearPending } from '@/lib/planningPending'
import { boardStatusLabel } from '@/lib/taskLabels'
import type { Task } from '../types'
import { SprintCloseDialog } from './SprintCloseDialog'
import { SprintResults } from './SprintResults'
import { STATE_TEXT, formatHours, formatMoment, formatPoints, sprintTitle } from './text'
import { NoticeBox, errorNotice, useMemberName, type Notice, type PanelProps } from './shared'

type FormState = { sprint: P.Sprint | null; base: number; name: string; goal: string; start: string; end: string }

// An unchanged minute-precision input must not truncate existing seconds.
const toDraft = (form: FormState): P.SprintDraft => ({ name: form.name.trim(), goal: form.goal,
  start_at: form.sprint && form.start === P.toLocalInput(form.sprint.start_at) ? form.sprint.start_at : P.fromLocalInput(form.start),
  end_at: form.sprint && form.end === P.toLocalInput(form.sprint.end_at) ? form.sprint.end_at : P.fromLocalInput(form.end) })

export function SprintsPanel(props: PanelProps) {
  const { planning, data, projectId } = props
  const t = useT()
  const id = useId()
  const { caps } = planning
  const scrum = data.settings.mode === 'scrum'
  const [form, setForm] = useState<FormState | null>(null)
  const [formConflict, setFormConflict] = useState(false)
  const [pending, setPending] = useState<P.CreateSprintRequest | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [closing, setClosing] = useState<{ sprintId: string; cancel: boolean; request: P.CloseSprintRequest | null } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const active = data.sprints.find((sprint) => sprint.state === 'active') ?? null
  const planned = data.sprints.filter((sprint) => sprint.state === 'planned').sort((a, b) => a.number - b.number)
  const closed = data.sprints.filter((sprint) => sprint.state === 'completed' || sprint.state === 'cancelled')
  const nextNumber = data.sprints.reduce((max, sprint) => Math.max(max, sprint.number), 0) + 1
  const closingSprint = closing ? data.sprints.find((sprint) => sprint.id === closing.sprintId) ?? null : null

  const openForm = (sprint: P.Sprint | null) => {
    setNotice(null)
    setFormConflict(false)
    const saved = !sprint && planning.userId ? readPendingCreate(planning.userId, projectId) : null
    setPending(saved)
    if (saved) setNotice({ tone: 'warning', text: 'Сохранён незавершённый запрос создания. Проверьте его результат или повторите тот же запрос.' })
    setForm(saved
      ? { sprint: null, base: saved.expectedVersion, name: saved.draft.name, goal: saved.draft.goal, start: P.toLocalInput(saved.draft.start_at), end: P.toLocalInput(saved.draft.end_at) }
      : sprint
      ? { sprint, base: sprint.version, name: sprint.name, goal: sprint.goal, start: P.toLocalInput(sprint.start_at), end: P.toLocalInput(sprint.end_at) }
      : { sprint: null, base: data.settings.version, name: `${t('Спринт')} ${nextNumber}`, goal: '', start: '', end: '' })
  }

  const submit = async (base: number) => {
    if (!form) return
    const draft = toDraft(form)
    const problem = P.checkSprintDraft(draft)
    if (problem) { setNotice({ tone: 'error', text: problem }); return }
    const editing = form.sprint
    const request = editing ? null : pending ?? { requestId: crypto.randomUUID(), projectId, expectedVersion: base, draft }
    if (request) { setPending(request); storePending(planning.userId!, projectId, request) }
    const result = await planning.perform('sprint-form', (db) => (editing ? P.updateSprint(db, editing.id, base, draft) : P.createSprintOnce(db, request!)))
    if (!result) return
    if (result.ok) {
      if (request) clearPending(planning.userId!, projectId, request)
      setPending(null)
      setForm(null)
      setFormConflict(false)
      setNotice({ tone: 'success', text: editing ? 'Спринт сохранён.' : 'Спринт создан.' })
      return
    }
    if (request && P.uncertainWrite(result.error)) {
      await checkCreation(request)
      return
    }
    if (request) clearPending(planning.userId!, projectId, request)
    setPending(null)
    setFormConflict(result.error.kind === 'conflict')
    setNotice(errorNotice(result.error))
  }

  const checkCreation = async (request: P.CreateSprintRequest) => {
    const check = await planning.inspect((db) => P.loadRequest(db, projectId, request.requestId))
    if (!check) return
    if (check.ok && check.data?.kind === 'create_sprint' && check.data.actor_id === planning.userId) {
      clearPending(planning.userId!, projectId, request)
      setPending(null); setForm(null); setFormConflict(false)
      setNotice({ tone: 'info', text: 'Создание подтверждено по идентификатору операции. Повторный спринт не создавался.' })
      await planning.refresh()
    } else {
      setNotice({ tone: 'warning', text: 'Результат создания пока неизвестен. Можно проверить снова или явно повторить тот же запрос без дубля.' })
    }
  }

  const latest = form?.sprint ? data.sprints.find((sprint) => sprint.id === form.sprint?.id) ?? null : null

  return (
    <div className="planning-block" aria-labelledby={`${id}-title`}>
      <div className="planning-block-head">
        <h3 id={`${id}-title`} className="planning-block-title">{t('Спринты')}</h3>
        {caps.canManage && scrum && !form && (
          <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => openForm(null)}>{t('Новый спринт')}</button>
        )}
      </div>
      {!scrum && <p className="planning-hint">{t('Режим Scrum выключен: новые спринты не создаются. Планируемый спринт можно отменить, чтобы вернуть его задачи; итоги закрытых спринтов сохраняются.')}</p>}
      {!caps.canManage && !caps.readOnly && <p className="planning-hint">{t('Создавать, начинать и закрывать спринты может автор проекта, а при делегировании — Product Owner или Scrum Master. Состав планируемого спринта меняет любой участник.')}</p>}

      {form && !form.sprint && <SprintForm form={form} setForm={setForm} busy={Boolean(planning.busy)} pending={Boolean(pending)} onSubmit={() => void submit(form.base)} onCancel={() => setForm(null)} />}
      <NoticeBox notice={notice}>
        {pending && !planning.busy && <button type="button" className="action-secondary planning-button" onClick={() => void checkCreation(pending)}>{t('Проверить результат создания')}</button>}
        {formConflict && form && (
          <>
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => { const base = form.sprint ? latest?.version ?? form.base : data.settings.version; setForm({ ...form, base }); void submit(base) }}>{t('Сохранить мои значения поверх новых')}</button>
            <button type="button" className="action-secondary planning-button" onClick={() => { setForm(null); setFormConflict(false); setNotice(null) }}>{t('Взять актуальные значения')}</button>
          </>
        )}
      </NoticeBox>

      {!active && planned.length === 0 && closed.length === 0 && <p className="planning-empty">{t('Спринтов пока нет.')}</p>}

      {[...(active ? [active] : []), ...planned].map((sprint) => (
        <OpenSprint
          key={sprint.id}
          {...props}
          sprint={sprint}
          hasActive={Boolean(active)}
          editing={form?.sprint?.id === sprint.id ? form : null}
          setForm={setForm}
          onEdit={() => openForm(sprint)}
          onSubmitForm={() => form && void submit(form.base)}
          onClose={(cancel) => {
            setNotice(null)
            void planning.refresh().then((current) => {
              if (!current) return
              const request = planning.userId ? readPendingClose(planning.userId, projectId, sprint.id) : null
              setClosing({ sprintId: sprint.id, cancel: request?.close.cancel ?? cancel, request })
            })
          }}
          setNotice={setNotice}
        />
      ))}

      {closed.length > 0 && (
        <div className="planning-subblock">
          <h4 className="planning-subtitle">{t('Закрытые спринты')}</h4>
          <ul className="planning-closed">
            {closed.map((sprint) => (
              <li key={sprint.id} className="planning-sprint is-closed" data-sprint={sprint.id}>
                <div className="planning-sprint-head">
                  <strong>{sprintTitle(sprint, t)}</strong>
                  <span className={`planning-state is-${sprint.state}`}>{t(STATE_TEXT[sprint.state])}</span>
                  <button type="button" className="planning-link" aria-expanded={expanded === sprint.id} onClick={() => setExpanded(expanded === sprint.id ? null : sprint.id)}>
                    {t(expanded === sprint.id ? 'Скрыть итоги' : 'Итоги и состав')}
                  </button>
                </div>
                {expanded === sprint.id && <SprintResults sprint={sprint} sprints={data.sprints} planning={planning} members={props.members} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {closing && closingSprint && (
        <SprintCloseDialog
          sprint={closingSprint}
          cancel={closing.cancel}
          initialRequest={closing.request}
          planning={planning}
          data={data}
          projectId={projectId}
          tasks={props.tasks}
          onClose={() => setClosing(null)}
          onClosed={(result, message) => { setClosing(null); setExpanded(result.id); setNotice(message) }}
        />
      )}
    </div>
  )
}

function OpenSprint({ planning, data, members, tasks, onOpenTask, sprint, hasActive, editing, setForm, onEdit, onSubmitForm, onClose, setNotice }: PanelProps & {
  sprint: P.Sprint
  hasActive: boolean
  editing: FormState | null
  setForm: (form: FormState | null) => void
  onEdit: () => void
  onSubmitForm: () => void
  onClose: (cancel: boolean) => void
  setNotice: (notice: Notice) => void
}) {
  const t = useT()
  const locale = useLocale()
  const name = useMemberName(members)
  const { caps } = planning
  const scrum = data.settings.mode === 'scrum'
  const notEstimated = t('Не оценено')
  const [adding, setAdding] = useState<string[] | null>(null)
  const [confirmStart, setConfirmStart] = useState(false)
  const isActive = sprint.state === 'active'
  const scope = data.openItems.filter((item) => item.sprint_id === sprint.id)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const scopeTasks = scope.map((item) => ({ item, task: item.live_task_id ? byId.get(item.live_task_id) : undefined }))
  const canChangeScope = scrum && (isActive ? caps.canManage : caps.canEditTasks)
  const totals = P.sumEstimates(scopeTasks.map(({ item, task }) => ({ story_points: task ? task.story_points ?? null : item.entry_snapshot.story_points, planned_hours: task ? task.planned_hours ?? null : item.entry_snapshot.planned_hours })))
  const blocker = P.startBlocker(sprint, scope.length, hasActive && !isActive)
  const backlog = data.backlog?.tasks ?? []

  const remove = async (task: Task) => {
    if (task.planning_version === undefined) return
    const result = await planning.perform(`remove-${task.id}`, (db) => P.removeTaskFromSprint(db, sprint.id, sprint.version, task.id, task.planning_version as number))
    if (!result) return
    setNotice(result.ok ? { tone: 'success', text: `${t('Задача исключена из спринта и вернулась в бэклог')}: «${task.title}».` } : errorNotice(result.error))
  }

  const add = async () => {
    if (!adding?.length) return
    const chosen = backlog.filter((task) => adding.includes(task.id)).map((task) => ({ task_id: task.id, expected_version: task.planning_version }))
    const result = await planning.perform('scope-add', (db) => P.addTasksToSprint(db, sprint.id, sprint.version, chosen))
    if (!result) return
    if (result.ok) setAdding(null)
    setNotice(result.ok ? { tone: 'success', text: 'Задачи добавлены в спринт.' } : errorNotice(result.error))
  }

  const start = async () => {
    const result = await planning.perform('start', (db) => P.startSprint(db, sprint.id, sprint.version))
    if (!result) return
    setConfirmStart(false)
    setNotice(result.ok ? { tone: 'success', text: 'Спринт начат: состав и оценки зафиксированы в стартовом снимке.' } : errorNotice(result.error))
  }

  return (
    <section className={`planning-sprint is-${sprint.state}`} data-sprint={sprint.id} aria-label={sprintTitle(sprint, t)}>
      <div className="planning-sprint-head">
        <strong>{sprintTitle(sprint, t)}</strong>
        <span className={`planning-state is-${sprint.state}`}>{t(STATE_TEXT[sprint.state])}</span>
      </div>
      <p className="planning-item-meta">
        {formatMoment(sprint.start_at, locale, t('начало не задано'))} — {formatMoment(sprint.end_at, locale, t('окончание не задано'))}
        {isActive && sprint.started_at ? ` · ${t('начат')} ${formatMoment(sprint.started_at, locale, '')}` : ''}
      </p>
      {sprint.goal && <p className="planning-goal">{sprint.goal}</p>}
      {editing && <SprintForm form={editing} setForm={setForm} busy={Boolean(planning.busy)} onSubmit={onSubmitForm} onCancel={() => setForm(null)} />}

      <p className="planning-hint">
        {t('Состав')}: {scope.length} · {formatPoints(totals.story_points, locale, notEstimated)}{totals.unestimated_points ? ` (${t('без оценки')}: ${totals.unestimated_points})` : ''} · {formatHours(totals.planned_hours, locale, notEstimated)}
        {isActive && sprint.start_snapshot ? ` · ${t('на старте')} — ${t('задач')}: ${sprint.start_snapshot.totals.tasks}, ${formatPoints(sprint.start_snapshot.totals.story_points, locale, notEstimated)}` : ''}
      </p>
      {scope.length === 0 ? (
        <p className="planning-empty">{t('В спринте пока нет задач. Добавьте существующие задачи из бэклога.')}</p>
      ) : (
        <ul className="planning-list">
          {scopeTasks.map(({ item, task }) => (
            <li key={item.id} className="planning-item">
              <div className="planning-item-main">
                {task ? <button type="button" className="planning-task-link" onClick={() => onOpenTask(task.id)}>{task.title}</button> : <span>{item.entry_snapshot.title}</span>}
                <span className="planning-item-meta">
                  {task ? boardStatusLabel(task.status) : t('нет данных')} · {formatPoints(task ? task.story_points ?? null : item.entry_snapshot.story_points, locale, notEstimated)} · {formatHours(task ? task.planned_hours ?? null : item.entry_snapshot.planned_hours, locale, notEstimated)} · {name(task?.assignee_id)}
                </span>
              </div>
              {canChangeScope && task && (
                <button type="button" className="planning-link is-danger" disabled={Boolean(planning.busy)} aria-label={`${t('Исключить из спринта')}: ${task.title}`} onClick={() => void remove(task)}>{t('Исключить')}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <fieldset className="planning-inline-form">
          <legend className="planning-label">{t('Задачи из бэклога')}</legend>
          {backlog.length === 0 ? <p className="planning-hint">{t('Бэклог пуст.')}</p> : backlog.map((task) => (
            <label key={task.id} className="planning-check">
              <input type="checkbox" checked={adding.includes(task.id)} onChange={(e) => setAdding(e.target.checked ? [...adding, task.id] : adding.filter((item) => item !== task.id))} />
              <span>{task.title} <span className="planning-item-meta">· {formatPoints(task.story_points, locale, notEstimated)}</span></span>
            </label>
          ))}
          <div className="planning-actions">
            <button type="button" className="action-primary planning-button" disabled={!adding.length || Boolean(planning.busy)} onClick={() => void add()}>{t('Добавить')} ({adding.length})</button>
            <button type="button" className="action-secondary planning-button" onClick={() => setAdding(null)}>{t('Отмена')}</button>
          </div>
        </fieldset>
      )}

      {confirmStart && (
        <div className="planning-inline-form" role="group" aria-label={t('Начало спринта')}>
          <p>{t('Начать спринт? Состав и оценки будут зафиксированы в стартовом снимке. Плановые даты не запускают спринт автоматически — только эта кнопка.')}</p>
          <div className="planning-actions">
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => void start()}>{t(planning.busy === 'start' ? 'Начинаем…' : 'Да, начать спринт')}</button>
            <button type="button" className="action-secondary planning-button" onClick={() => setConfirmStart(false)}>{t('Отмена')}</button>
          </div>
        </div>
      )}

      <div className="planning-actions">
        {canChangeScope && !adding && <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => setAdding([])}>{t('Добавить задачи')}</button>}
        {caps.canManage && scrum && !editing && <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={onEdit}>{t('Изменить')}</button>}
        {caps.canManage && scrum && sprint.state === 'planned' && !confirmStart && (
          <button type="button" className="action-primary planning-button" disabled={Boolean(blocker) || Boolean(planning.busy)} aria-describedby={blocker ? `blocker-${sprint.id}` : undefined} onClick={() => setConfirmStart(true)}>{t('Начать спринт')}</button>
        )}
        {caps.canManage && isActive && <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => onClose(false)}>{t('Завершить спринт')}</button>}
        {caps.canManage && <button type="button" className="action-secondary planning-button is-danger" disabled={Boolean(planning.busy)} onClick={() => onClose(true)}>{t('Отменить спринт')}</button>}
      </div>
      {caps.canManage && scrum && sprint.state === 'planned' && blocker && <p id={`blocker-${sprint.id}`} className="planning-hint">{t(blocker)}</p>}
    </section>
  )
}

function SprintForm({ form, setForm, busy, pending = false, onSubmit, onCancel }: { form: FormState; setForm: (form: FormState) => void; busy: boolean; pending?: boolean; onSubmit: () => void; onCancel: () => void }) {
  const t = useT()
  return (
    <form className="planning-inline-form" aria-label={t(form.sprint ? 'Изменение спринта' : 'Новый спринт')} onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <fieldset disabled={busy || pending} className="planning-block">
      <div className="planning-grid">
        <label className="planning-field">
          <span className="planning-label">{t('Название')}</span>
          <input value={form.name} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="planning-field">
          <span className="planning-label">{t('Начало')}</span>
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </label>
        <label className="planning-field">
          <span className="planning-label">{t('Окончание')}</span>
          <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </label>
      </div>
      <label className="planning-field">
        <span className="planning-label">{t('Цель спринта')}</span>
        <textarea rows={2} maxLength={P.SPRINT_GOAL_MAX} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
      </label>
      </fieldset>
      <p className="planning-hint">{t('Даты можно оставить пустыми до старта. Время — в часовом поясе устройства.')}</p>
      <div className="planning-actions">
        <button type="submit" className="action-primary planning-button" disabled={busy}>{t(busy ? 'Сохраняем…' : pending ? 'Повторить тот же запрос' : form.sprint ? 'Сохранить спринт' : 'Создать спринт')}</button>
        <button type="button" className="action-secondary planning-button" disabled={busy} onClick={onCancel}>{t('Закрыть форму')}</button>
      </div>
    </form>
  )
}
