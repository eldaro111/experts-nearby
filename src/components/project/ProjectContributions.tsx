'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { createNotification } from '@/lib/notifications'
import { createProjectActivity } from '@/lib/projectActivity'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

import type { Contribution, ProjectMember, Task } from './types'

interface ProjectContributionsProps {
  projectId: string
  currentUserId: string | null | undefined
  isAuthor: boolean
  members: ProjectMember[]
  tasks: Task[]
}

export function ProjectContributions({
  projectId,
  currentUserId,
  isAuthor,
  members,
  tasks,
}: ProjectContributionsProps) {
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [contributionsLoading, setContributionsLoading] = useState(false)

  const [newContributionKind, setNewContributionKind] = useState('other')
  const [newContributionTitle, setNewContributionTitle] = useState('')
  const [newContributionDescription, setNewContributionDescription] = useState('')
  const [newContributionLink, setNewContributionLink] = useState('')
  const [newContributionHours, setNewContributionHours] = useState('')
  const [newContributionTaskId, setNewContributionTaskId] = useState('')
  const [creatingContribution, setCreatingContribution] = useState(false)

  const [editingContributionId, setEditingContributionId] = useState<string | null>(null)
  const [editContributionKind, setEditContributionKind] = useState('other')
  const [editContributionTitle, setEditContributionTitle] = useState('')
  const [editContributionDescription, setEditContributionDescription] = useState('')
  const [editContributionLink, setEditContributionLink] = useState('')
  const [editContributionHours, setEditContributionHours] = useState('')
  const [editContributionTaskId, setEditContributionTaskId] = useState('')
  const [savingContributionId, setSavingContributionId] = useState<string | null>(null)
  const [deletingContributionId, setDeletingContributionId] = useState<string | null>(null)
  const [verifyingContributionId, setVerifyingContributionId] = useState<string | null>(null)

  useEffect(() => {
    const fetchContributions = async () => {
      setContributionsLoading(true)

      const { data, error } = await supabase
        .from('contributions')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (error) {
        logAppError('Ошибка загрузки журнала вклада:', error)
        setContributions([])
      } else {
        setContributions((data || []) as Contribution[])
      }

      setContributionsLoading(false)
    }

    fetchContributions()
  }, [projectId, tasks.length])

  const refreshContributions = async () => {
    const { data, error } = await supabase
      .from('contributions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      logAppError('Ошибка обновления журнала вклада:', error)
      return
    }

    setContributions((data || []) as Contribution[])
  }

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'

    return (
      members.find((m) => m.user_id === userId)?.display_name ||
      'Неизвестный участник'
    )
  }

  const getTaskTitle = (taskId: string | null) => {
    if (!taskId) return 'Без привязки к задаче'
    return tasks.find((t) => t.id === taskId)?.title || 'Задача не найдена'
  }

  const contributionKindLabel = (kind: string) => {
    const map: Record<string, string> = {
      code: 'Код',
      doc: 'Документ',
      design: 'Проектирование',
      research: 'Исследование',
      fig: 'Иллюстрация/схема',
      meeting: 'Встреча',
      test: 'Тестирование',
      other: 'Другое',
    }

    return map[kind] || kind
  }

  const handleCreateContribution = async () => {
    if (!currentUserId) {
      showAppMessage('Пользователь не найден.')
      return
    }

    const title = newContributionTitle.trim()
    const description = newContributionDescription.trim()
    const link = newContributionLink.trim()
    const hoursText = newContributionHours.trim().replace(',', '.')
    const hours = hoursText ? Number(hoursText) : null

    if (!title) {
      showAppMessage('Введите название вклада.')
      return
    }

    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) {
      showAppMessage('Часы должны быть положительным числом.')
      return
    }

    setCreatingContribution(true)

    const { data: createdContribution, error } = await supabase
      .from('contributions')
      .insert([
        {
          project_id: projectId,
          user_id: currentUserId,
          task_id: newContributionTaskId || null,
          kind: newContributionKind,
          title,
          description: description || null,
          link: link || null,
          hours,
        },
      ])
      .select('id')
      .single()

    setCreatingContribution(false)

    if (error) {
      logAppError('Ошибка добавления вклада:', error)
      showAppMessage('Ошибка добавления вклада: ' + error.message)
      return
    }

    await createProjectActivity({
      projectId,
      actorId: currentUserId,
      type: 'contribution_added',
      title: `Добавлен вклад «${title}»`,
      body: `Тип: ${contributionKindLabel(newContributionKind)}${hours ? ` · ${hours} ч.` : ''}`,
      entityType: 'contribution',
      entityId: createdContribution?.id || null,
      metadata: {
        contribution_title: title,
        kind: newContributionKind,
        task_id: newContributionTaskId || null,
        hours,
      },
    })

    setNewContributionKind('other')
    setNewContributionTitle('')
    setNewContributionDescription('')
    setNewContributionLink('')
    setNewContributionHours('')
    setNewContributionTaskId('')

    await refreshContributions()
  }

  const startEditContribution = (contribution: Contribution) => {
    if (contribution.user_id !== currentUserId) {
      showAppMessage('Редактировать можно только свой вклад.')
      return
    }

    if (contribution.verified_by) {
      showAppMessage('Подтверждённый вклад нельзя редактировать.')
      return
    }

    setEditingContributionId(contribution.id)
    setEditContributionKind(contribution.kind || 'other')
    setEditContributionTitle(contribution.title || '')
    setEditContributionDescription(contribution.description || '')
    setEditContributionLink(contribution.link || '')
    setEditContributionHours(
      contribution.hours !== null && contribution.hours !== undefined
        ? String(contribution.hours)
        : ''
    )
    setEditContributionTaskId(contribution.task_id || '')
  }

  const cancelEditContribution = () => {
    setEditingContributionId(null)
    setEditContributionKind('other')
    setEditContributionTitle('')
    setEditContributionDescription('')
    setEditContributionLink('')
    setEditContributionHours('')
    setEditContributionTaskId('')
  }

  const handleSaveContributionEdit = async (contributionId: string) => {
    const title = editContributionTitle.trim()
    const description = editContributionDescription.trim()
    const link = editContributionLink.trim()
    const hoursText = editContributionHours.trim().replace(',', '.')
    const hours = hoursText ? Number(hoursText) : null

    if (!title) {
      showAppMessage('Название вклада не может быть пустым.')
      return
    }

    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) {
      showAppMessage('Часы должны быть положительным числом.')
      return
    }

    setSavingContributionId(contributionId)

    const { data, error } = await supabase
      .from('contributions')
      .update({
        kind: editContributionKind,
        title,
        description: description || null,
        link: link || null,
        hours,
        task_id: editContributionTaskId || null,
      })
      .eq('id', contributionId)
      .eq('user_id', currentUserId)
      .is('verified_by', null)
      .select('id')

    setSavingContributionId(null)

    if (error) {
      logAppError('Ошибка редактирования вклада:', error)
      showAppMessage('Ошибка редактирования вклада: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось отредактировать вклад.')
      return
    }

    cancelEditContribution()
    await refreshContributions()
  }

  const handleDeleteContribution = async (contributionId: string) => {
    const ok = window.confirm('Удалить запись вклада?')
    if (!ok) return

    setDeletingContributionId(contributionId)

    const { data, error } = await supabase
      .from('contributions')
      .delete()
      .eq('id', contributionId)
      .eq('user_id', currentUserId)
      .is('verified_by', null)
      .select('id')

    setDeletingContributionId(null)

    if (error) {
      logAppError('Ошибка удаления вклада:', error)
      showAppMessage('Ошибка удаления вклада: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось удалить вклад.')
      return
    }

    if (editingContributionId === contributionId) {
      cancelEditContribution()
    }

    await refreshContributions()
  }

  const handleVerifyContribution = async (contributionId: string) => {
    if (!currentUserId) return

    const contribution = contributions.find((item) => item.id === contributionId)

    setVerifyingContributionId(contributionId)

    const { data, error } = await supabase
      .from('contributions')
      .update({
        verified_by: currentUserId,
        verified_at: new Date().toISOString(),
      })
      .eq('id', contributionId)
      .is('verified_by', null)
      .select('id')

    setVerifyingContributionId(null)

    if (error) {
      logAppError('Ошибка подтверждения вклада:', error)
      showAppMessage('Ошибка подтверждения вклада: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось подтвердить вклад.')
      return
    }

    if (contribution) {
      await createProjectActivity({
        projectId,
        actorId: currentUserId,
        type: 'contribution_verified',
        title: `Подтверждён вклад «${contribution.title}»`,
        body: contribution.user_id !== currentUserId
          ? `Автор вклада: ${getMemberName(contribution.user_id)}.`
          : 'Автор подтвердил собственный вклад.',
        entityType: 'contribution',
        entityId: contribution.id,
        metadata: {
          contribution_title: contribution.title,
          contribution_user_id: contribution.user_id,
          task_id: contribution.task_id,
        },
      })
    }

    if (contribution && contribution.user_id !== currentUserId) {
      await createNotification({
        recipientId: contribution.user_id,
        actorId: currentUserId,
        projectId,
        type: 'contribution_verified',
        title: 'Ваш вклад подтверждён',
        body: `Вклад «${contribution.title}» подтверждён автором проекта.`,
        href: `/projects/${projectId}#contributions`,
        payload: {
          project_id: projectId,
          contribution_id: contribution.id,
          contribution_title: contribution.title,
          task_id: contribution.task_id,
        },
      })
    }

    await refreshContributions()
  }

  return (
    <div className="border rounded-xl bg-white p-5 shadow-sm mt-10">
      <h2 className="text-xl font-semibold mb-4">Журнал вклада</h2>

      <div className="border rounded-lg p-4 bg-gray-50 mb-6">
        <h3 className="font-semibold mb-3">Добавить вклад</h3>

        <div className="space-y-3">
          <select
            value={newContributionKind}
            onChange={(e) => setNewContributionKind(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          >
            <option value="other">Другое</option>
            <option value="code">Код</option>
            <option value="doc">Документ</option>
            <option value="design">Проектирование</option>
            <option value="research">Исследование</option>
            <option value="fig">Иллюстрация/схема</option>
            <option value="meeting">Встреча</option>
            <option value="test">Тестирование</option>
          </select>

          <input
            type="text"
            placeholder="Название вклада"
            value={newContributionTitle}
            onChange={(e) => setNewContributionTitle(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          />

          <textarea
            placeholder="Описание: что именно сделано"
            value={newContributionDescription}
            onChange={(e) => setNewContributionDescription(e.target.value)}
            className="border rounded p-2 w-full bg-white min-h-[90px]"
          />

          <select
            value={newContributionTaskId}
            onChange={(e) => setNewContributionTaskId(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          >
            <option value="">Без привязки к задаче</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Ссылка на результат / файл / коммит"
            value={newContributionLink}
            onChange={(e) => setNewContributionLink(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          />

          <input
            type="text"
            placeholder="Часы, например 2.5"
            value={newContributionHours}
            onChange={(e) => setNewContributionHours(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          />

          <button
            onClick={handleCreateContribution}
            disabled={creatingContribution}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {creatingContribution ? 'Добавляем...' : 'Добавить вклад'}
          </button>
        </div>
      </div>

      {contributionsLoading ? (
        <div className="text-sm text-gray-500">Загружаем журнал...</div>
      ) : contributions.length === 0 ? (
        <div className="text-sm text-gray-500">
          Пока записей вклада нет.
        </div>
      ) : (
        <div className="space-y-4">
          {contributions.map((contribution) => {
            const isOwn = contribution.user_id === currentUserId
            const isVerified = !!contribution.verified_by
            const isEditing = editingContributionId === contribution.id

            return (
              <div
                key={contribution.id}
                className="border rounded-lg p-4 bg-gray-50"
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <select
                      value={editContributionKind}
                      onChange={(e) => setEditContributionKind(e.target.value)}
                      className="border rounded p-2 w-full bg-white"
                    >
                      <option value="other">Другое</option>
                      <option value="code">Код</option>
                      <option value="doc">Документ</option>
                      <option value="design">Проектирование</option>
                      <option value="research">Исследование</option>
                      <option value="fig">Иллюстрация/схема</option>
                      <option value="meeting">Встреча</option>
                      <option value="test">Тестирование</option>
                    </select>

                    <input
                      type="text"
                      value={editContributionTitle}
                      onChange={(e) => setEditContributionTitle(e.target.value)}
                      className="border rounded p-2 w-full bg-white"
                      placeholder="Название вклада"
                    />

                    <textarea
                      value={editContributionDescription}
                      onChange={(e) =>
                        setEditContributionDescription(e.target.value)
                      }
                      className="border rounded p-2 w-full bg-white min-h-[90px]"
                      placeholder="Описание"
                    />

                    <select
                      value={editContributionTaskId}
                      onChange={(e) => setEditContributionTaskId(e.target.value)}
                      className="border rounded p-2 w-full bg-white"
                    >
                      <option value="">Без привязки к задаче</option>
                      {tasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      value={editContributionLink}
                      onChange={(e) => setEditContributionLink(e.target.value)}
                      className="border rounded p-2 w-full bg-white"
                      placeholder="Ссылка"
                    />

                    <input
                      type="text"
                      value={editContributionHours}
                      onChange={(e) => setEditContributionHours(e.target.value)}
                      className="border rounded p-2 w-full bg-white"
                      placeholder="Часы"
                    />

                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => handleSaveContributionEdit(contribution.id)}
                        disabled={savingContributionId === contribution.id}
                        className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 transition disabled:opacity-60"
                      >
                        {savingContributionId === contribution.id
                          ? 'Сохраняем...'
                          : 'Сохранить'}
                      </button>

                      <button
                        onClick={cancelEditContribution}
                        disabled={savingContributionId === contribution.id}
                        className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded hover:bg-gray-300 transition disabled:opacity-60"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div>
                        <div className="text-sm text-gray-500 mb-1">
                          {contributionKindLabel(contribution.kind)}
                        </div>

                        <div className="font-semibold text-lg">
                          {contribution.title}
                        </div>

                        <div className="text-sm text-gray-600 mt-1">
                          Автор: <b>{getMemberName(contribution.user_id)}</b>
                        </div>

                        <div className="text-sm text-gray-600 mt-1">
                          Задача: <b>{getTaskTitle(contribution.task_id)}</b>
                        </div>

                        {contribution.description && (
                          <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
                            {contribution.description}
                          </div>
                        )}

                        {contribution.link && (
                          <div className="text-sm mt-2">
                            <a
                              href={
                                contribution.link.startsWith('http')
                                  ? contribution.link
                                  : `https://${contribution.link}`
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              Открыть ссылку
                            </a>
                          </div>
                        )}

                        <div className="text-xs text-gray-400 mt-2">
                          Создано:{' '}
                          {new Date(contribution.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="text-sm md:text-right">
                        <div>
                          Часы:{' '}
                          <b>
                            {contribution.hours !== null &&
                            contribution.hours !== undefined
                              ? contribution.hours
                              : '—'}
                          </b>
                        </div>

                        <div className="mt-1">
                          {isVerified ? (
                            <span className="text-green-700 font-medium">
                              Подтверждено
                            </span>
                          ) : (
                            <span className="text-yellow-700 font-medium">
                              Не подтверждено
                            </span>
                          )}
                        </div>

                        {contribution.verified_by && (
                          <div className="text-xs text-gray-500 mt-1">
                            Подтвердил:{' '}
                            {getMemberName(contribution.verified_by)}
                          </div>
                        )}

                        {contribution.verified_at && (
                          <div className="text-xs text-gray-400 mt-1">
                            {new Date(contribution.verified_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 flex-wrap mt-4">
                      {isAuthor && !isVerified && (
                        <button
                          onClick={() => handleVerifyContribution(contribution.id)}
                          disabled={verifyingContributionId === contribution.id}
                          className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 transition disabled:opacity-60"
                        >
                          {verifyingContributionId === contribution.id
                            ? 'Подтверждаем...'
                            : 'Подтвердить'}
                        </button>
                      )}

                      {isOwn && !isVerified && (
                        <button
                          onClick={() => startEditContribution(contribution)}
                          className="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition"
                        >
                          Редактировать
                        </button>
                      )}

                      {isOwn && !isVerified && (
                        <button
                          onClick={() => handleDeleteContribution(contribution.id)}
                          disabled={deletingContributionId === contribution.id}
                          className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                        >
                          {deletingContributionId === contribution.id
                            ? 'Удаляем...'
                            : 'Удалить'}
                        </button>
                      )}
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
}