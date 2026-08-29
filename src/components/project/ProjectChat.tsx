'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

import type { ProjectMember, ProjectMessage } from './types'

const MESSAGE_LIMIT = 50

interface ProjectChatProps {
  projectId: string
  currentUserId: string | null | undefined
  members: ProjectMember[]
}

export function ProjectChat({
  projectId,
  currentUserId,
  members,
}: ProjectChatProps) {
  const [messages, setMessages] = useState<ProjectMessage[]>([])
  const [hiddenMessageIds, setHiddenMessageIds] = useState<string[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [newMessageBody, setNewMessageBody] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null)

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editMessageBody, setEditMessageBody] = useState('')
  const [savingMessageEditId, setSavingMessageEditId] = useState<string | null>(null)
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)

  useEffect(() => {
    const fetchMessages = async () => {
      setMessagesLoading(true)

      const { data, error } = await supabase
        .from('project_messages')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_LIMIT)

      if (error) {
        logAppError('Ошибка загрузки обсуждения:', error)
        setMessages([])
        setHiddenMessageIds([])
        setMessagesLoading(false)
        return
      }

      const loadedMessages = ((data || []) as ProjectMessage[]).reverse()
      setMessages(loadedMessages)

      if (currentUserId && loadedMessages.length > 0) {
        const messageIds = loadedMessages.map((m) => m.id)

        const { data: hiddenData, error: hiddenError } = await supabase
          .from('project_message_hidden')
          .select('message_id')
          .eq('user_id', currentUserId)
          .in('message_id', messageIds)

        if (hiddenError) {
          logAppError('Ошибка загрузки скрытых сообщений:', hiddenError)
          setHiddenMessageIds([])
        } else {
          setHiddenMessageIds((hiddenData || []).map((h: any) => h.message_id))
        }
      } else {
        setHiddenMessageIds([])
      }

      setMessagesLoading(false)
    }

    fetchMessages()
  }, [projectId, currentUserId])

  const refreshMessages = async () => {
    const { data, error } = await supabase
      .from('project_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_LIMIT)

    if (error) {
      logAppError('Ошибка обновления обсуждения:', error)
      return
    }

    const loadedMessages = ((data || []) as ProjectMessage[]).reverse()
    setMessages(loadedMessages)

    if (currentUserId && loadedMessages.length > 0) {
      const messageIds = loadedMessages.map((m) => m.id)

      const { data: hiddenData, error: hiddenError } = await supabase
        .from('project_message_hidden')
        .select('message_id')
        .eq('user_id', currentUserId)
        .in('message_id', messageIds)

      if (hiddenError) {
        logAppError('Ошибка загрузки скрытых сообщений:', hiddenError)
        setHiddenMessageIds([])
      } else {
        setHiddenMessageIds((hiddenData || []).map((h: any) => h.message_id))
      }
    } else {
      setHiddenMessageIds([])
    }
  }

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'

    return (
      members.find((m) => m.user_id === userId)?.display_name ||
      'Неизвестный участник'
    )
  }

  const getMessageById = (messageId: string | null) => {
    if (!messageId) return null
    return messages.find((m) => m.id === messageId) || null
  }

  const startReplyToMessage = (messageId: string) => {
    setReplyToMessageId(messageId)
  }

  const cancelReply = () => {
    setReplyToMessageId(null)
  }

  const handleSendMessage = async () => {
    const body = newMessageBody.trim()

    if (!body) {
      showAppMessage('Введите сообщение.')
      return
    }

    if (!currentUserId) {
      showAppMessage('Пользователь не найден.')
      return
    }

    setSendingMessage(true)

    const { error } = await supabase.from('project_messages').insert([
      {
        project_id: projectId,
        author_id: currentUserId,
        body,
        parent_message_id: replyToMessageId,
      },
    ])

    setSendingMessage(false)

    if (error) {
      logAppError('Ошибка отправки сообщения:', error)
      showAppMessage('Ошибка отправки сообщения: ' + error.message)
      return
    }

    setNewMessageBody('')
    setReplyToMessageId(null)
    await refreshMessages()
  }

  const startEditMessage = (message: ProjectMessage) => {
    if (message.author_id !== currentUserId) {
      showAppMessage('Редактировать можно только свои сообщения.')
      return
    }

    if (message.is_deleted_for_all) {
      showAppMessage('Удалённое сообщение нельзя редактировать.')
      return
    }

    setEditingMessageId(message.id)
    setEditMessageBody(message.body)
  }

  const cancelEditMessage = () => {
    setEditingMessageId(null)
    setEditMessageBody('')
  }

  const handleSaveMessageEdit = async (messageId: string) => {
    const body = editMessageBody.trim()

    if (!body) {
      showAppMessage('Сообщение не может быть пустым.')
      return
    }

    setSavingMessageEditId(messageId)

    const { data, error } = await supabase
      .from('project_messages')
      .update({
        body,
        edited_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .eq('author_id', currentUserId)
      .eq('is_deleted_for_all', false)
      .select('id')

    setSavingMessageEditId(null)

    if (error) {
      logAppError('Ошибка редактирования сообщения:', error)
      showAppMessage('Ошибка редактирования сообщения: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось отредактировать сообщение.')
      return
    }

    cancelEditMessage()
    await refreshMessages()
  }

  const handleDeleteMessageForEveryone = async (messageId: string) => {
    const ok = window.confirm('Удалить сообщение для всех?')
    if (!ok) return

    setDeletingMessageId(messageId)

    const { data, error } = await supabase
      .from('project_messages')
      .update({
        body: '',
        is_deleted_for_all: true,
        edited_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .eq('author_id', currentUserId)
      .select('id')

    setDeletingMessageId(null)

    if (error) {
      logAppError('Ошибка удаления сообщения для всех:', error)
      showAppMessage('Ошибка удаления сообщения для всех: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось удалить сообщение для всех.')
      return
    }

    if (replyToMessageId === messageId) {
      setReplyToMessageId(null)
    }

    if (editingMessageId === messageId) {
      cancelEditMessage()
    }

    await refreshMessages()
  }

  const handleDeleteMessageForMe = async (messageId: string) => {
    if (!currentUserId) return

    const ok = window.confirm('Скрыть сообщение только для себя?')
    if (!ok) return

    setDeletingMessageId(messageId)

    const { error } = await supabase.from('project_message_hidden').insert([
      {
        message_id: messageId,
        user_id: currentUserId,
      },
    ])

    setDeletingMessageId(null)

    if (error) {
      if (error.code === '23505') {
        await refreshMessages()
        return
      }

      logAppError('Ошибка скрытия сообщения:', error)
      showAppMessage('Ошибка скрытия сообщения: ' + error.message)
      return
    }

    if (replyToMessageId === messageId) {
      setReplyToMessageId(null)
    }

    await refreshMessages()
  }

  const visibleMessages = messages.filter(
    (message) => !hiddenMessageIds.includes(message.id)
  )

  return (
    <div className="border rounded-xl bg-white shadow-sm mb-8 overflow-hidden">
      <div className="border-b px-5 py-4 bg-gray-50">
        <h2 className="text-xl font-semibold">Обсуждение проекта</h2>
        <p className="text-sm text-gray-500 mt-1">
          Внутренний чат команды проекта.
        </p>
      </div>

      <div className="h-[480px] overflow-y-auto px-5 py-4 bg-white">
        {messagesLoading ? (
          <div className="text-sm text-gray-500">
            Загружаем сообщения...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="text-sm text-gray-500">
            Пока сообщений нет.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleMessages.map((message) => {
              const isMine = message.author_id === currentUserId
              const parentMessage = getMessageById(message.parent_message_id)

              return (
                <div
                  key={message.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm border ${
                      isMine
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-gray-50 text-gray-900 border-gray-200'
                    }`}
                  >
                    <div
                      className={`text-xs mb-1 ${
                        isMine ? 'text-blue-100' : 'text-gray-500'
                      }`}
                    >
                      {getMemberName(message.author_id)}
                    </div>

                    {parentMessage && (
                      <div
                        className={`mb-2 rounded-lg px-3 py-2 text-xs border-l-4 ${
                          isMine
                            ? 'bg-blue-500 border-blue-200 text-blue-50'
                            : 'bg-white border-gray-300 text-gray-600'
                        }`}
                      >
                        <div className="font-medium mb-1">
                          Ответ на: {getMemberName(parentMessage.author_id)}
                        </div>
                        <div className="max-h-10 overflow-hidden whitespace-pre-wrap">
                          {parentMessage.is_deleted_for_all
                            ? 'Сообщение удалено'
                            : parentMessage.body}
                        </div>
                      </div>
                    )}

                    {editingMessageId === message.id ? (
                      <div className="space-y-2 mt-2">
                        <textarea
                          value={editMessageBody}
                          onChange={(e) => setEditMessageBody(e.target.value)}
                          className={`border rounded-lg p-2 w-full min-h-[80px] text-sm ${
                            isMine
                              ? 'bg-blue-500 text-white border-blue-300'
                              : 'bg-white text-gray-900'
                          }`}
                        />

                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => handleSaveMessageEdit(message.id)}
                            disabled={savingMessageEditId === message.id}
                            className={`text-xs px-3 py-1 rounded ${
                              isMine
                                ? 'bg-white text-blue-700 hover:bg-blue-50'
                                : 'bg-green-600 text-white hover:bg-green-700'
                            } disabled:opacity-60`}
                          >
                            {savingMessageEditId === message.id
                              ? 'Сохраняем...'
                              : 'Сохранить'}
                          </button>

                          <button
                            onClick={cancelEditMessage}
                            disabled={savingMessageEditId === message.id}
                            className={`text-xs px-3 py-1 rounded ${
                              isMine
                                ? 'bg-blue-500 text-white border border-blue-200 hover:bg-blue-400'
                                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                            } disabled:opacity-60`}
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : message.is_deleted_for_all ? (
                      <div
                        className={`text-sm italic ${
                          isMine ? 'text-blue-100' : 'text-gray-500'
                        }`}
                      >
                        Сообщение удалено
                      </div>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap">
                        {message.body}
                      </div>
                    )}

                    <div
                      className={`text-[11px] mt-2 ${
                        isMine ? 'text-blue-100' : 'text-gray-400'
                      }`}
                    >
                      {new Date(message.created_at).toLocaleString()}
                      {message.edited_at && !message.is_deleted_for_all
                        ? ' · изменено'
                        : ''}
                    </div>

                    <div className="flex gap-3 mt-2 flex-wrap">
                      {!message.is_deleted_for_all && (
                        <button
                          onClick={() => startReplyToMessage(message.id)}
                          className={`text-xs underline ${
                            isMine ? 'text-blue-100' : 'text-blue-600'
                          }`}
                        >
                          Ответить
                        </button>
                      )}

                      {isMine && !message.is_deleted_for_all && (
                        <button
                          onClick={() => startEditMessage(message)}
                          className={`text-xs underline ${
                            isMine ? 'text-blue-100' : 'text-blue-600'
                          }`}
                        >
                          Редактировать
                        </button>
                      )}

                      {isMine && !message.is_deleted_for_all && (
                        <button
                          onClick={() => handleDeleteMessageForEveryone(message.id)}
                          disabled={deletingMessageId === message.id}
                          className={`text-xs underline ${
                            isMine ? 'text-blue-100' : 'text-red-600'
                          } disabled:opacity-60`}
                        >
                          {deletingMessageId === message.id
                            ? 'Удаляем...'
                            : 'Удалить для всех'}
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteMessageForMe(message.id)}
                        disabled={deletingMessageId === message.id}
                        className={`text-xs underline ${
                          isMine ? 'text-blue-100' : 'text-red-600'
                        } disabled:opacity-60`}
                      >
                        Удалить для себя
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t bg-gray-50 px-5 py-4">
        {replyToMessageId && (
          <div className="mb-3 border rounded-lg bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-gray-700 mb-1">
                  Ответ на сообщение
                </div>

                {(() => {
                  const replyMessage = getMessageById(replyToMessageId)

                  if (!replyMessage) {
                    return (
                      <div className="text-gray-500">
                        Сообщение не найдено.
                      </div>
                    )
                  }

                  return (
                    <div className="text-gray-600 max-h-10 overflow-hidden whitespace-pre-wrap">
                      <b>{getMemberName(replyMessage.author_id)}:</b>{' '}
                      {replyMessage.is_deleted_for_all
                        ? 'Сообщение удалено'
                        : replyMessage.body}
                    </div>
                  )
                })()}
              </div>

              <button
                onClick={cancelReply}
                className="text-xs text-red-600 hover:underline"
              >
                Отменить
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3 items-end">
          <textarea
            placeholder="Напишите сообщение для команды..."
            value={newMessageBody}
            onChange={(e) => setNewMessageBody(e.target.value)}
            className="border rounded-lg p-3 w-full min-h-[70px] max-h-[160px] resize-y bg-white"
          />

          <button
            onClick={handleSendMessage}
            disabled={sendingMessage}
            className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-60 whitespace-nowrap"
          >
            {sendingMessage ? '...' : 'Отправить'}
          </button>
        </div>
      </div>
    </div>
  )
}