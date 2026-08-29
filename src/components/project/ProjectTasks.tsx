'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { createNotification } from '@/lib/notifications'
import { createProjectActivity } from '@/lib/projectActivity'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

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

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, CLOCK_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  const todoTasks = tasks.filter((t) => t.status === 'todo')
  const doingTasks = tasks.filter((t) => t.status === 'doing')
  const doneTasks = tasks.filter((t) => t.status === 'done')

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

    const patch: Record<string, string | null> = {
      status,
    }

    if (status === 'done') {
      patch.completed_at = new Date().toISOString()
    } else {
      patch.completed_at = null
    }

    const { error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', taskId)

    if (error) {
      logAppError('Ошибка обновления статуса задачи:', error)
      showAppMessage('Ошибка обновления статуса: ' + error.message)
      return
    }

    if (task) {
      await createProjectActivity({
        projectId,
        actorId: currentUserId,
        type: status === 'done' ? 'task_completed' : 'task_status_changed',
        title:
          status === 'done'
            ? `Задача «${task.title}» завершена`
            : `Статус задачи «${task.title}» изменён`,
        body: `Новый статус: ${status}.`,
        entityType: 'task',
        entityId: task.id,
        metadata: {
          task_title: task.title,
          old_status: task.status,
          new_status: status,
        },
      })
    }

    if (status === 'done' && task) {
      await notifyProjectOwner({
        type: 'task_completed',
        title: 'Задача завершена',
        body: `Задача «${task.title}» переведена в Done.`,
        payload: {
          task_id: task.id,
          task_title: task.title,
        },
      })
    }

    await onTasksChanged()
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
    status: TaskStatus
  ) => (
    <div className="border rounded-xl bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>

      {columnTasks.length === 0 ? (
        <p className="text-sm text-gray-500">Пока пусто.</p>
      ) : (
        <div className="space-y-3">
          {columnTasks.map((task) => {
            const isEditing = editingTaskId === task.id

            return (
              <div key={task.id} className="border rounded-lg p-3 bg-gray-50">
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
                        {savingTaskId === task.id
                          ? 'Сохраняем...'
                          : 'Сохранить'}
                      </button>

                      <button
                        onClick={cancelEditTask}
                        disabled={savingTaskId === task.id}
                        className="bg-gray-200 text-gray-800 text-xs px-3 py-1 rounded hover:bg-gray-300 transition disabled:opacity-60"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="font-medium">{task.title}</div>

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
                      {status !== 'todo' && (
                        <button
                          onClick={() =>
                            handleChangeTaskStatus(task.id, 'todo')
                          }
                          className="bg-gray-200 text-gray-800 text-xs px-3 py-1 rounded hover:bg-gray-300 transition"
                        >
                          В To Do
                        </button>
                      )}

                      {status !== 'doing' && (
                        <button
                          onClick={() =>
                            handleChangeTaskStatus(task.id, 'doing')
                          }
                          className="bg-yellow-500 text-white text-xs px-3 py-1 rounded hover:bg-yellow-600 transition"
                        >
                          В Doing
                        </button>
                      )}

                      {status !== 'done' && (
                        <button
                          onClick={() =>
                            handleChangeTaskStatus(task.id, 'done')
                          }
                          className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition"
                        >
                          В Done
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
    </div>
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
        <div className="grid gap-6 md:grid-cols-3">
          {renderTaskColumn('To Do', todoTasks, 'todo')}
          {renderTaskColumn('Doing', doingTasks, 'doing')}
          {renderTaskColumn('Done', doneTasks, 'done')}
        </div>
      )}
    </>
  )
}
