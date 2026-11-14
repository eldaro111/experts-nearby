'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { boardStatusLabel } from '@/lib/taskLabels'
import { TaskPlanningEditor } from './planning/TaskPlanningEditor'
import type { PlanningController } from './planning/usePlanning'
import type { ProjectMember, Task } from './types'

const formatMoment = (value: string | null) =>
  value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

/**
 * One view of a task for every entry point (calendar, Gantt, direct link `?task=<id>`).
 * Status, dates and assignee are changed on the board card, so there is a single place for those edits
 * and their conflict checks. Planning estimates (ER-012) are edited here, with their own version check.
 */
export function TaskDetails({
  open,
  task,
  members,
  planning,
  onClose,
  onShowOnBoard,
}: {
  open: boolean
  /** null — the link points to a task that is not in this project (deleted or no access). */
  task: Task | null
  members: ProjectMember[]
  /** Planning state of the page; omitted where planning is not shown. */
  planning?: PlanningController
  onClose: () => void
  onShowOnBoard: (taskId: string) => void
}) {
  const [now] = useState(() => Date.now())
  const assignee = task?.assignee_id
    ? members.find((member) => member.user_id === task.assignee_id)?.display_name || 'Неизвестный участник'
    : null
  const due = task?.due_at ? new Date(task.due_at).getTime() : null
  const overdue = Boolean(task && due !== null && (
    task.status === 'done'
      ? task.completed_at && new Date(task.completed_at).getTime() > due
      : now > due
  ))

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="task-details"
      title={task ? task.title : 'Задача не найдена'}
      description={task ? 'Задача проекта' : undefined}
    >
      {!task ? (
        <p className="text-sm text-gray-600">
          Возможно, задача удалена или у Вас нет к ней доступа. Откройте план работ, чтобы увидеть актуальный список задач.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={`task-details-status is-${['todo', 'doing', 'done'].includes(task.status) ? task.status : 'other'}`}>{boardStatusLabel(task.status)}</span>
            {overdue && <span className="task-details-status is-overdue">Просрочено</span>}
          </div>

          <dl className="task-details-list">
            <div><dt>Исполнитель</dt><dd>{assignee || 'Не назначен'}</dd></div>
            <div><dt>Начало</dt><dd>{formatMoment(task.start_at) || 'Не задано'}</dd></div>
            <div><dt>Дедлайн</dt><dd>{formatMoment(task.due_at) || 'Не задан'}</dd></div>
            {task.completed_at && <div><dt>Завершено</dt><dd>{formatMoment(task.completed_at)}</dd></div>}
          </dl>

          {task.description
            ? <p className="task-details-description">{task.description}</p>
            : <p className="text-sm text-gray-500 mt-4">Описание не добавлено.</p>}

          {planning && <TaskPlanningEditor key={task.id} task={task} planning={planning} />}

          <p className="text-xs text-gray-500 mt-4">Время — в часовом поясе устройства. Статус, сроки и исполнитель меняются в карточке на доске.</p>
        </>
      )}

      <div className="flex flex-wrap gap-2 mt-5">
        {task && <button type="button" className="action-primary min-h-11 px-4" onClick={() => onShowOnBoard(task.id)}>Показать на доске</button>}
        <button type="button" className="action-secondary min-h-11 px-4" onClick={onClose}>Закрыть</button>
      </div>
    </Modal>
  )
}
