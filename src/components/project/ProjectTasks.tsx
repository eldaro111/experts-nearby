'use client'

import { UiText } from '@/components/LocaleProvider'

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { createNotification } from '@/lib/notifications'
import { createProjectActivity } from '@/lib/projectActivity'
import { logAppError, showAppMessage } from '@/lib/appFeedback'
import { BOARD_COLUMNS, boardStatusLabel, isBoardStatus, saveTaskStatus, validateTaskRange } from '@/lib/taskSchedule'

import type { ProjectMember, Task, TaskStatus } from './types'

const initialNow = Date.now()
const CLOCK_REFRESH_INTERVAL_MS = 60_000

interface ProjectTasksProps {
  projectId: string
  currentUserId: string | null | undefined
  isAuthor: boolean
  members: ProjectMember[]
  tasks: Task[]
  tasksLoading: boolean
  onTasksChanged: () => Promise<void>
}

export function ProjectTasks({
  projectId,
  currentUserId,
  isAuthor,
  members,
  tasks,
  tasksLoading,
  onTasksChanged,
}: ProjectTasksProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState('')
  const [newTaskStartAt, setNewTaskStartAt] = useState('')
  const [newTaskDueAt, setNewTaskDueAt] = useState('')
  const [newTaskPenaltyPercent, setNewTaskPenaltyPercent] = useState('10')
  const [creatingTask, setCreatingTask] = useState(false)

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskDescription, setEditTaskDescription] = useState('')
  const [editTaskStartAt, setEditTaskStartAt] = useState('')
  const [editTaskDueAt, setEditTaskDueAt] = useState('')
  const [editTaskPenaltyPercent, setEditTaskPenaltyPercent] = useState('10')
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [now, setNow] = useState(initialNow)

  // Board drag & drop (ER: доска задач). Overrides show the target column while saving and are
  // removed on error, so the card returns to its previous column.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({})
  const [movingTaskIds, setMovingTaskIds] = useState<string[]>([])
  // A keyboard move re-renders the card in another column; this keeps focus on its handle.
  const refocusGripRef = useRef<string | null>(null)
  const [boardAnnouncement, setBoardAnnouncement] = useState('')
  const [drag, setDrag] = useState<{ taskId: string; title: string; from: string; over: TaskStatus | null; x: number; y: number } | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, CLOCK_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  const effectiveStatus = (task: Task): string => statusOverrides[task.id] ?? task.status
  // Unknown statuses are shown in a separate section instead of being hidden.
  const otherStatusTasks = tasks.filter((t) => !isBoardStatus(effectiveStatus(t)))

  useEffect(() => {
    if (!drag) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrag(null) }
    document.addEventListener('keydown', cancel)
    return () => document.removeEventListener('keydown', cancel)
  }, [drag])

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'

    return (
      members.find((m) => m.user_id === userId)?.display_name ||
      'Неизвестный участник'
    )
  }

  const toDateTimeLocalValue = (value: string | null) => {
    if (!value) return ''

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''

    const offsetMs = date.getTimezoneOffset() * 60 * 1000
    const local = new Date(date.getTime() - offsetMs)

    return local.toISOString().slice(0, 16)
  }

  const fromDateTimeLocalValue = (value: string) => {
    if (!value) return null

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null

    return date.toISOString()
  }

  const formatDateTime = (value: string | null) => {
    if (!value) return '—'
    return new Date(value).toLocaleString()
  }

  const isTaskOverdue = (task: Task) => {
    if (!task.due_at) return false

    const due = new Date(task.due_at).getTime()

    if (task.status !== 'done') {
      return now > due
    }

    if (task.completed_at) {
      return new Date(task.completed_at).getTime() > due
    }

    return false
  }

  const isPenaltyActive = (task: Task) => {
    return isTaskOverdue(task) && task.excuse_status !== 'approved'
  }

  const getTaskPenaltyText = (task: Task) => {
    if (!isTaskOverdue(task)) return null

    if (task.excuse_status === 'approved') {
      return 'Просрочка закрыта уважительной причиной · штраф не применяется'
    }

    if (task.excuse_status === 'pending') {
      return `Просрочено · причина на рассмотрении · номинальный штраф ${task.penalty_percent}%`
    }

    if (task.excuse_status === 'rejected') {
      return `Просрочено · причина отклонена · номинальный штраф ${task.penalty_percent}%`
    }

    return `Просрочено · номинальный штраф ${task.penalty_percent}%`
  }

  const hasDateChanged = (oldValue: string | null, newValue: string | null) => {
    if (!oldValue && !newValue) return false
    if (!oldValue || !newValue) return true

    const oldTime = new Date(oldValue).getTime()
    const newTime = new Date(newValue).getTime()

    if (Number.isNaN(oldTime) && Number.isNaN(newTime)) return false
    if (Number.isNaN(oldTime) || Number.isNaN(newTime)) return true

    return Math.abs(oldTime - newTime) > 1000
  }

  const getProjectOwnerId = async () => {
    const { data, error } = await supabase
      .from('listings')
      .select('created_by')
      .eq('id', projectId)
      .maybeSingle()

    if (error) {
      logAppError('Ошибка получения автора проекта для уведомления:', error)
      return null
    }

    return data?.created_by || null
  }

  const notifyUser = async ({
    recipientId,
    type,
    title,
    body,
    payload = {},
  }: {
    recipientId: string | null | undefined
    type: string
    title: string
    body: string
    payload?: Record<string, any>
  }) => {
    if (!currentUserId || !recipientId || recipientId === currentUserId) return

    await createNotification({
      recipientId,
      actorId: currentUserId,
      projectId,
      type,
      title,
      body,
      href: `/projects/${projectId}`,
      payload,
    })
  }

  const notifyProjectOwner = async ({
    type,
    title,
    body,
    payload = {},
  }: {
    type: string
    title: string
    body: string
    payload?: Record<string, any>
  }) => {
    const projectOwnerId = await getProjectOwnerId()

    await notifyUser({
      recipientId: projectOwnerId,
      type,
      title,
      body,
      payload,
    })
  }

  const handleCreateTask = async () => {
    const title = newTaskTitle.trim()
    const description = newTaskDescription.trim()
    const assigneeId = newTaskAssigneeId || null
    const startAt = fromDateTimeLocalValue(newTaskStartAt)
    const dueAt = fromDateTimeLocalValue(newTaskDueAt)
    const penaltyPercent = Number(newTaskPenaltyPercent) || 10

    if (!title) {
      showAppMessage('Введите название задачи.')
      return
    }

    setCreatingTask(true)

    const { data: createdTask, error } = await supabase
      .from('tasks')
      .insert([
        {
          project_id: projectId,
          title,
          description: description || null,
          status: 'todo',
          assignee_id: assigneeId,
          start_at: startAt,
          due_at: dueAt,
          penalty_percent: penaltyPercent,
        },
      ])
      .select('id')
      .single()

    setCreatingTask(false)

    if (error) {
      logAppError('Ошибка создания задачи:', error)
      showAppMessage('Ошибка создания задачи: ' + error.message)
      return
    }

    await createProjectActivity({
      projectId,
      actorId: currentUserId,
      type: 'task_created',
      title: `Создана задача «${title}»`,
      body: assigneeId
        ? `Исполнитель: ${getMemberName(assigneeId)}.`
        : 'Исполнитель пока не назначен.',
      entityType: 'task',
      entityId: createdTask?.id || null,
      metadata: {
        task_title: title,
        assignee_id: assigneeId,
        start_at: startAt,
        due_at: dueAt,
      },
    })

    if (assigneeId) {
      await notifyUser({
        recipientId: assigneeId,
        type: 'task_assigned',
        title: 'Вам назначили задачу',
        body: dueAt
          ? `Вам назначили задачу «${title}». Дедлайн: ${formatDateTime(dueAt)}.`
          : `Вам назначили задачу «${title}».`,
        payload: {
          task_title: title,
          due_at: dueAt,
        },
      })
    }

    setNewTaskTitle('')
    setNewTaskDescription('')
    setNewTaskAssigneeId('')
    setNewTaskStartAt('')
    setNewTaskDueAt('')
    setNewTaskPenaltyPercent('10')
    await onTasksChanged()
  }

  const handleChangeTaskStatus = async (taskId: string, status: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    // One request per task at a time: repeated drops/clicks are ignored while saving.
    if (movingTaskIds.includes(taskId)) return
    const from = effectiveStatus(task)
    if (from === status) return

    setMovingTaskIds((ids) => [...ids, taskId])
    setStatusOverrides((current) => ({ ...current, [taskId]: status }))
    const clearOverride = () => setStatusOverrides((current) => {
      const next = { ...current }
      delete next[taskId]
      return next
    })

    const result = await saveTaskStatus(task, status)

    if (!result.ok) {
      clearOverride()
      setMovingTaskIds((ids) => ids.filter((id) => id !== taskId))
      logAppError('Ошибка обновления статуса задачи:', result.message)
      showAppMessage(result.message, 'error', 7000)
      setBoardAnnouncement(`Задача «${task.title}» осталась в колонке «${boardStatusLabel(from)}». ${result.message}`)
      return
    }

    // History is recorded by the server trigger; the shim below is kept for compatibility.
    await createProjectActivity({
      projectId,
      actorId: currentUserId,
      type: status === 'done' ? 'task_completed' : 'task_status_changed',
      title:
        status === 'done'
          ? `Задача «${task.title}» завершена`
          : `Статус задачи «${task.title}» изменён`,
      body: `Новый статус: ${boardStatusLabel(status)}.`,
      entityType: 'task',
      entityId: task.id,
      metadata: {
        task_title: task.title,
        old_status: task.status,
        new_status: status,
      },
    })

    if (status === 'done') {
      await notifyProjectOwner({
        type: 'task_completed',
        title: 'Задача завершена',
        body: `Задача «${task.title}» переведена в «Готово».`,
        payload: {
          task_id: task.id,
          task_title: task.title,
        },
      })
    }

    setBoardAnnouncement(`Задача «${task.title}» перемещена в колонку «${boardStatusLabel(status)}».`)
    await onTasksChanged()
    clearOverride()
    setMovingTaskIds((ids) => ids.filter((id) => id !== taskId))
  }

  const dropTargetAt = (x: number, y: number): TaskStatus | null => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-status]')
    const status = target?.dataset.dropStatus || ''
    return isBoardStatus(status) ? status : null
  }

  const handleGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, task: Task) => {
    if (event.button !== 0 || movingTaskIds.includes(task.id)) return
    // Stop text selection / native drag, which would otherwise cancel the pointer stream.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ taskId: task.id, title: task.title, from: effectiveStatus(task), over: null, x: event.clientX, y: event.clientY })
  }

  const handleGripPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    // Keep scrolling possible on narrow screens where columns are stacked.
    if (event.clientY < 72) window.scrollBy(0, -14)
    else if (event.clientY > window.innerHeight - 72) window.scrollBy(0, 14)
    setDrag({ ...drag, x: event.clientX, y: event.clientY, over: dropTargetAt(event.clientX, event.clientY) })
  }

  const handleGripPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const target = dropTargetAt(event.clientX, event.clientY)
    const { taskId, from } = drag
    setDrag(null)
    if (target && target !== from) void handleChangeTaskStatus(taskId, target)
  }

  useEffect(() => {
    const taskId = refocusGripRef.current
    if (!taskId) return
    // Restore focus only if it was lost with the old card; never take it from another element.
    const active = document.activeElement
    if (!active || active === document.body) {
      document.querySelector<HTMLButtonElement>(`[data-task-grip="${CSS.escape(taskId)}"]`)?.focus()
    }
    if (!movingTaskIds.includes(taskId)) refocusGripRef.current = null
  })

  const handleGripKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, task: Task) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (movingTaskIds.includes(task.id)) return
    refocusGripRef.current = task.id
    const from = effectiveStatus(task)
    const index = BOARD_COLUMNS.findIndex((column) => column.status === from)
    const nextIndex = index < 0 ? 0 : index + (event.key === 'ArrowRight' ? 1 : -1)
    const target = BOARD_COLUMNS[nextIndex]
    if (target) void handleChangeTaskStatus(task.id, target.status)
  }

  const handleChangeTaskAssignee = async (taskId: string, assigneeId: string) => {
    const task = tasks.find((t) => t.id === taskId)
    const nextAssigneeId = assigneeId || null

    const { error } = await supabase
      .from('tasks')
      .update({ assignee_id: nextAssigneeId })
      .eq('id', taskId)

    if (error) {
      logAppError('Ошибка назначения исполнителя:', error)
      showAppMessage('Ошибка назначения исполнителя: ' + error.message)
      return
    }

    if (task && nextAssigneeId !== task.assignee_id) {
      await createProjectActivity({
        projectId,
        actorId: currentUserId,
        type: 'task_assignee_changed',
        title: `Изменён исполнитель задачи «${task.title}»`,
        body: nextAssigneeId
          ? `Новый исполнитель: ${getMemberName(nextAssigneeId)}.`
          : 'Исполнитель снят.',
        entityType: 'task',
        entityId: task.id,
        metadata: {
          task_title: task.title,
          old_assignee_id: task.assignee_id,
          new_assignee_id: nextAssigneeId,
        },
      })
    }

    if (task && nextAssigneeId && nextAssigneeId !== task.assignee_id) {
      await notifyUser({
        recipientId: nextAssigneeId,
        type: 'task_assigned',
        title: 'Вам назначили задачу',
        body: task.due_at
          ? `Вам назначили задачу «${task.title}». Дедлайн: ${formatDateTime(task.due_at)}.`
          : `Вам назначили задачу «${task.title}».`,
        payload: {
          task_id: task.id,
          task_title: task.title,
          due_at: task.due_at,
        },
      })
    }

    await onTasksChanged()
  }

  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id)
    setEditTaskTitle(task.title)
    setEditTaskDescription(task.description || '')
    setEditTaskStartAt(toDateTimeLocalValue(task.start_at))
    setEditTaskDueAt(toDateTimeLocalValue(task.due_at))
    setEditTaskPenaltyPercent(String(task.penalty_percent ?? 10))
  }

  const cancelEditTask = () => {
    setEditingTaskId(null)
    setEditTaskTitle('')
    setEditTaskDescription('')
    setEditTaskStartAt('')
    setEditTaskDueAt('')
    setEditTaskPenaltyPercent('10')
  }

  const handleSaveTaskEdit = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId)
    const title = editTaskTitle.trim()
    const description = editTaskDescription.trim()
    const startAt = fromDateTimeLocalValue(editTaskStartAt)
    const dueAt = fromDateTimeLocalValue(editTaskDueAt)
    const penaltyPercent = Number(editTaskPenaltyPercent) || 10

    if (!title) {
      showAppMessage('Название задачи не может быть пустым.')
      return
    }

    const rangeError = validateTaskRange(startAt, dueAt)
    if (rangeError) {
      showAppMessage(rangeError, 'warning')
      return
    }

    setSavingTaskId(taskId)

    const { error } = await supabase
      .from('tasks')
      .update({
        title,
        description: description || null,
        start_at: startAt,
        due_at: dueAt,
        penalty_percent: penaltyPercent,
      })
      .eq('id', taskId)

    setSavingTaskId(null)

    if (error) {
      logAppError('Ошибка редактирования задачи:', error)
      showAppMessage('Ошибка редактирования задачи: ' + error.message)
      return
    }

    if (task?.assignee_id && hasDateChanged(task.due_at, dueAt)) {
      await notifyUser({
        recipientId: task.assignee_id,
        type: 'task_deadline_changed',
        title: 'Дедлайн задачи изменён',
        body: dueAt
          ? `У задачи «${title}» новый дедлайн: ${formatDateTime(dueAt)}.`
          : `У задачи «${title}» дедлайн снят.`,
        payload: {
          task_id: task.id,
          task_title: title,
          old_due_at: task.due_at,
          new_due_at: dueAt,
        },
      })
    }

    cancelEditTask()
    await onTasksChanged()
  }

  const handleDeleteTask = async (taskId: string) => {
    const ok = window.confirm('Удалить задачу? Это действие нельзя отменить.')
    if (!ok) return

    setDeletingTaskId(taskId)

    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)

    setDeletingTaskId(null)

    if (error) {
      logAppError('Ошибка удаления задачи:', error)
      showAppMessage('Ошибка удаления задачи: ' + error.message)
      return
    }

    const deletedTask = tasks.find((task) => task.id === taskId)

    await createProjectActivity({
      projectId,
      actorId: currentUserId,
      type: 'task_deleted',
      title: deletedTask
        ? `Удалена задача «${deletedTask.title}»`
        : 'Удалена задача',
      body: null,
      entityType: 'task',
      entityId: taskId,
      metadata: {
        task_title: deletedTask?.title || null,
      },
    })

    if (editingTaskId === taskId) {
      cancelEditTask()
    }

    await onTasksChanged()
  }

  const handleSubmitExcuse = async (task: Task) => {
    if (!currentUserId) return

    const reason = window.prompt('Укажите уважительную причину просрочки:')

    if (!reason || !reason.trim()) return

    const normalizedReason = reason.trim()

    const { error } = await supabase
      .from('tasks')
      .update({
        excuse_reason: normalizedReason,
        excuse_status: 'pending',
      })
      .eq('id', task.id)

    if (error) {
      logAppError('Ошибка отправки причины:', error)
      showAppMessage('Ошибка отправки причины: ' + error.message)
      return
    }

    await notifyProjectOwner({
      type: 'task_excuse_submitted',
      title: 'Указана причина просрочки',
      body: `По задаче «${task.title}» отправлена уважительная причина просрочки.`,
      payload: {
        task_id: task.id,
        task_title: task.title,
        excuse_reason: normalizedReason,
      },
    })

    await onTasksChanged()
  }

  const handleDecideExcuse = async (
    task: Task,
    decision: 'approved' | 'rejected'
  ) => {
    if (!currentUserId) return

    const { error } = await supabase
      .from('tasks')
      .update({
        excuse_status: decision,
        excuse_decided_by: currentUserId,
        excuse_decided_at: new Date().toISOString(),
      })
      .eq('id', task.id)

    if (error) {
      logAppError('Ошибка решения по причине:', error)
      showAppMessage('Ошибка решения по причине: ' + error.message)
      return
    }

    if (task.assignee_id) {
      await notifyUser({
        recipientId: task.assignee_id,
        type: 'task_excuse_decided',
        title:
          decision === 'approved'
            ? 'Причина просрочки принята'
            : 'Причина просрочки отклонена',
        body:
          decision === 'approved'
            ? `Причина просрочки по задаче «${task.title}» принята. Штраф не применяется.`
            : `Причина просрочки по задаче «${task.title}» отклонена.`,
        payload: {
          task_id: task.id,
          task_title: task.title,
          decision,
        },
      })
    }

    await onTasksChanged()
  }

  const renderTaskColumn = (
    title: string,
    columnTasks: Task[],
    status: string,
    droppable = true
  ) => (
    <section
      className={`task-column border rounded-xl bg-white p-5 shadow-sm ${drag && droppable && drag.over === status && drag.from !== status ? 'is-drop-target' : ''}`}
      data-drop-status={droppable ? status : undefined}
      aria-label={`${title}: ${columnTasks.length}`}
    >
      <h2 className="text-xl font-semibold mb-4 flex items-baseline justify-between gap-2"><span>{title}</span><span className="text-sm font-normal text-gray-500">{columnTasks.length}</span></h2>

      {columnTasks.length === 0 ? (
        <p className="text-sm text-gray-500">{droppable ? 'Пока пусто. Перетащите сюда задачу.' : 'Пока пусто.'}</p>
      ) : (
        <div className="space-y-3">
          {columnTasks.map((task) => {
            const isEditing = editingTaskId === task.id
            const isMoving = movingTaskIds.includes(task.id)
            const currentStatus = effectiveStatus(task)

            return (
              <div key={task.id} className={`task-card border rounded-lg p-3 bg-gray-50 ${isMoving ? 'is-saving' : ''} ${drag?.taskId === task.id ? 'is-dragging' : ''}`} aria-busy={isMoving || undefined}>
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editTaskTitle}
                      onChange={(e) => setEditTaskTitle(e.target.value)}
                      className="border rounded p-2 w-full text-sm bg-white"
                      placeholder="Название задачи"
                    />

                    <textarea
                      value={editTaskDescription}
                      onChange={(e) => setEditTaskDescription(e.target.value)}
                      className="border rounded p-2 w-full text-sm bg-white min-h-[90px]"
                      placeholder="Описание задачи"
                    />

                    <div className="grid md:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Начало
                        </label>
                        <input
                          type="datetime-local"
                          value={editTaskStartAt}
                          onChange={(e) => setEditTaskStartAt(e.target.value)}
                          className="border rounded p-2 w-full text-sm bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Дедлайн
                        </label>
                        <input
                          type="datetime-local"
                          value={editTaskDueAt}
                          onChange={(e) => setEditTaskDueAt(e.target.value)}
                          className="border rounded p-2 w-full text-sm bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Штраф, %
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={editTaskPenaltyPercent}
                          onChange={(e) => setEditTaskPenaltyPercent(e.target.value)}
                          className="border rounded p-2 w-full text-sm bg-white"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => handleSaveTaskEdit(task.id)}
                        disabled={savingTaskId === task.id}
                        className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition disabled:opacity-60"
                      >
                        <UiText text={savingTaskId === task.id
                          ? 'Сохраняем...'
                          : 'Сохранить'}/>
                      </button>

                      <button
                        onClick={cancelEditTask}
                        disabled={savingTaskId === task.id}
                        className="bg-gray-200 text-gray-800 text-xs px-3 py-1 rounded hover:bg-gray-300 transition disabled:opacity-60"
                      ><UiText text={"Отмена"}/></button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className="task-drag-handle"
                        aria-label={`Переместить задачу «${task.title}»`}
                        aria-describedby="task-board-drag-hint"
                        aria-disabled={isMoving || undefined}
                        data-task-grip={task.id}
                        onPointerDown={(event) => handleGripPointerDown(event, task)}
                        onPointerMove={handleGripPointerMove}
                        onPointerUp={handleGripPointerUp}
                        onPointerCancel={() => setDrag(null)}
                        onKeyDown={(event) => handleGripKeyDown(event, task)}
                      >
                        <GripVertical size={16} aria-hidden="true" />
                      </button>
                      <div className="font-medium min-w-0 flex-1">{task.title}</div>
                      {isMoving && <span className="text-xs text-blue-700 shrink-0">Сохраняем…</span>}
                      {!isBoardStatus(currentStatus) && <span className="text-xs rounded bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 shrink-0">Статус: {currentStatus}</span>}
                    </div>

                    {task.description && (
                      <div className="text-sm text-gray-600 mt-1">
                        {task.description}
                      </div>
                    )}
                  </>
                )}

                {!isEditing && (
                  <>
                    <div className="text-xs text-gray-500 mt-2">
                      Исполнитель: <b>{getMemberName(task.assignee_id)}</b>
                    </div>

                    <div className="text-xs text-gray-500 mt-1">
                      Начало: <b>{formatDateTime(task.start_at)}</b>
                    </div>

                    <div className="text-xs text-gray-500 mt-1">
                      Дедлайн: <b>{formatDateTime(task.due_at)}</b>
                    </div>

                    {task.completed_at && (
                      <div className="text-xs text-gray-500 mt-1">
                        Завершено: <b>{formatDateTime(task.completed_at)}</b>
                      </div>
                    )}

                    {getTaskPenaltyText(task) && (
                      <div
                        className={`text-xs mt-2 rounded p-2 ${
                          isPenaltyActive(task)
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-green-50 text-green-700 border border-green-200'
                        }`}
                      >
                        {getTaskPenaltyText(task)}
                      </div>
                    )}

                    {task.excuse_reason && (
                      <div className="text-xs mt-2 rounded p-2 bg-white border text-gray-700">
                        <b>Причина:</b> {task.excuse_reason}
                      </div>
                    )}

                    <div className="mt-2">
                      <select
                        value={task.assignee_id || ''}
                        onChange={(e) =>
                          handleChangeTaskAssignee(task.id, e.target.value)
                        }
                        className="border rounded p-1 text-xs w-full bg-white"
                      >
                        <option value="">Не назначен</option>

                        {members.map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.display_name || 'Без имени'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="text-xs text-gray-400 mt-2">
                      Создано: {new Date(task.created_at).toLocaleString()}
                    </div>

                    <div className="flex gap-2 mt-3 flex-wrap">
                      {currentStatus !== 'todo' && (
                        <button
                          onClick={() =>
                            handleChangeTaskStatus(task.id, 'todo')
                          }
                          disabled={isMoving}
                          className="bg-gray-200 text-gray-800 text-xs px-3 py-1 rounded hover:bg-gray-300 transition disabled:opacity-60"
                        >
                          В «Нужно сделать»
                        </button>
                      )}

                      {currentStatus !== 'doing' && (
                        <button
                          onClick={() =>
                            handleChangeTaskStatus(task.id, 'doing')
                          }
                          disabled={isMoving}
                          className="bg-yellow-500 text-white text-xs px-3 py-1 rounded hover:bg-yellow-600 transition disabled:opacity-60"
                        >
                          В работу
                        </button>
                      )}

                      {currentStatus !== 'done' && (
                        <button
                          onClick={() =>
                            handleChangeTaskStatus(task.id, 'done')
                          }
                          disabled={isMoving}
                          className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition disabled:opacity-60"
                        >
                          Готово
                        </button>
                      )}

                      {isTaskOverdue(task) &&
                        task.assignee_id === currentUserId &&
                        task.excuse_status !== 'approved' && (
                          <button
                            onClick={() => handleSubmitExcuse(task)}
                            className="bg-purple-600 text-white text-xs px-3 py-1 rounded hover:bg-purple-700 transition"
                          >
                            Указать причину
                          </button>
                        )}

                      {isAuthor && task.excuse_status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleDecideExcuse(task, 'approved')}
                            className="bg-green-700 text-white text-xs px-3 py-1 rounded hover:bg-green-800 transition"
                          >
                            Принять причину
                          </button>

                          <button
                            onClick={() => handleDecideExcuse(task, 'rejected')}
                            className="bg-red-700 text-white text-xs px-3 py-1 rounded hover:bg-red-800 transition"
                          >
                            Отклонить причину
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => startEditTask(task)}
                        className="bg-blue-600 text-white text-xs px-3 py-1 rounded hover:bg-blue-700 transition"
                      >
                        Редактировать
                      </button>

                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        disabled={deletingTaskId === task.id}
                        className="bg-red-600 text-white text-xs px-3 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                      >
                        {deletingTaskId === task.id ? 'Удаляем...' : 'Удалить'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )

  return (
    <>
      <div className="border rounded-xl bg-white p-5 shadow-sm mb-8">
        <h2 className="text-xl font-semibold mb-4">Новая задача</h2>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Название задачи"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            className="border rounded p-2 w-full"
          />

          <textarea
            placeholder="Описание задачи"
            value={newTaskDescription}
            onChange={(e) => setNewTaskDescription(e.target.value)}
            className="border rounded p-2 w-full min-h-[110px]"
          />

          <select
            value={newTaskAssigneeId}
            onChange={(e) => setNewTaskAssigneeId(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          >
            <option value="">Исполнитель не назначен</option>

            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name || 'Без имени'}
              </option>
            ))}
          </select>

          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Начало
              </label>
              <input
                type="datetime-local"
                value={newTaskStartAt}
                onChange={(e) => setNewTaskStartAt(e.target.value)}
                className="border rounded p-2 w-full bg-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Дедлайн
              </label>
              <input
                type="datetime-local"
                value={newTaskDueAt}
                onChange={(e) => setNewTaskDueAt(e.target.value)}
                className="border rounded p-2 w-full bg-white"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Штраф за просрочку, %
              </label>
              <input
                type="number"
                min="0"
                value={newTaskPenaltyPercent}
                onChange={(e) => setNewTaskPenaltyPercent(e.target.value)}
                className="border rounded p-2 w-full bg-white"
              />
            </div>
          </div>

          <button
            onClick={handleCreateTask}
            disabled={creatingTask}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {creatingTask ? 'Создаём...' : 'Создать задачу'}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <h2 className="text-2xl font-semibold">Задачи проекта</h2>
      </div>

      {tasksLoading ? (
        <div className="text-center py-10 text-gray-500">
          Загрузка задач...
        </div>
      ) : (
        <>
          <p id="task-board-drag-hint" className="text-sm text-gray-500 mb-3">
            Перетащите задачу за значок слева от названия в другую колонку. С клавиатуры: фокус на значке и стрелки влево/вправо. Кнопки статуса в карточке тоже работают.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {BOARD_COLUMNS.map((column) => (
              <div key={column.status}>{renderTaskColumn(column.label, tasks.filter((t) => effectiveStatus(t) === column.status), column.status)}</div>
            ))}
          </div>
          {otherStatusTasks.length > 0 && (
            <div className="mt-6">
              {renderTaskColumn('Другие статусы', otherStatusTasks, 'other', false)}
              <p className="text-xs text-gray-500 mt-2">У этих задач статус, которого нет на доске. Он сохранён без изменений; перенесите задачу в колонку, если нужно.</p>
            </div>
          )}
          {drag && (
            <div className="task-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
              {drag.title}
            </div>
          )}
        </>
      )}
      <div className="sr-only" aria-live="polite">{boardAnnouncement}</div>
    </>
  )
}
