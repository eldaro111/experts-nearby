'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { logAppError, showAppMessage } from '@/lib/appFeedback'

import type { ProjectMember } from './types'

interface ProjectDocument {
  id: string
  project_id: string
  author_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

interface ProjectDocumentsProps {
  projectId: string
  currentUserId: string | null | undefined
  isAuthor: boolean
  members: ProjectMember[]
}

export function ProjectDocuments({
  projectId,
  currentUserId,
  isAuthor,
  members,
}: ProjectDocumentsProps) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)

  const [newDocumentTitle, setNewDocumentTitle] = useState('')
  const [newDocumentContent, setNewDocumentContent] = useState('')
  const [creatingDocument, setCreatingDocument] = useState(false)

  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [editDocumentTitle, setEditDocumentTitle] = useState('')
  const [editDocumentContent, setEditDocumentContent] = useState('')
  const [savingDocumentId, setSavingDocumentId] = useState<string | null>(null)
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'

    return (
      members.find((m) => m.user_id === userId)?.display_name ||
      'Неизвестный участник'
    )
  }

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) || null

  const refreshDocuments = async () => {
    const { data, error } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })

    if (error) {
      logAppError('Ошибка обновления документов проекта:', error)
      return
    }

    const loadedDocuments = (data || []) as ProjectDocument[]
    setDocuments(loadedDocuments)

    setSelectedDocumentId((currentId) => {
      if (currentId && loadedDocuments.some((doc) => doc.id === currentId)) {
        return currentId
      }

      return loadedDocuments[0]?.id || null
    })
  }

  useEffect(() => {
    const fetchDocuments = async () => {
      setDocumentsLoading(true)

      const { data, error } = await supabase
        .from('project_documents')
        .select('*')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })

      if (error) {
        logAppError('Ошибка загрузки документов проекта:', error)
        setDocuments([])
        setSelectedDocumentId(null)
      } else {
        const loadedDocuments = (data || []) as ProjectDocument[]
        setDocuments(loadedDocuments)
        setSelectedDocumentId((currentId) => currentId || loadedDocuments[0]?.id || null)
      }

      setDocumentsLoading(false)
    }

    fetchDocuments()
  }, [projectId])

  const handleCreateDocument = async () => {
    if (!currentUserId) {
      showAppMessage('Пользователь не найден.')
      return
    }

    const title = newDocumentTitle.trim()
    const content = newDocumentContent.trim()

    if (!title) {
      showAppMessage('Введите название документа.')
      return
    }

    setCreatingDocument(true)

    const { data, error } = await supabase
      .from('project_documents')
      .insert([
        {
          project_id: projectId,
          author_id: currentUserId,
          title,
          content,
        },
      ])
      .select('*')
      .single()

    setCreatingDocument(false)

    if (error) {
      logAppError('Ошибка создания документа:', error)
      showAppMessage('Ошибка создания документа: ' + error.message)
      return
    }

    setNewDocumentTitle('')
    setNewDocumentContent('')
    setSelectedDocumentId((data as ProjectDocument).id)
    await refreshDocuments()
  }

  const startEditDocument = (document: ProjectDocument) => {
    const canEdit = document.author_id === currentUserId || isAuthor

    if (!canEdit) {
      showAppMessage('Редактировать документ может автор документа или автор проекта.')
      return
    }

    setEditingDocumentId(document.id)
    setEditDocumentTitle(document.title)
    setEditDocumentContent(document.content || '')
  }

  const cancelEditDocument = () => {
    setEditingDocumentId(null)
    setEditDocumentTitle('')
    setEditDocumentContent('')
  }

  const handleSaveDocumentEdit = async (documentId: string) => {
    const title = editDocumentTitle.trim()

    if (!title) {
      showAppMessage('Название документа не может быть пустым.')
      return
    }

    setSavingDocumentId(documentId)

    const { data, error } = await supabase
      .from('project_documents')
      .update({
        title,
        content: editDocumentContent,
      })
      .eq('id', documentId)
      .select('id')

    setSavingDocumentId(null)

    if (error) {
      logAppError('Ошибка редактирования документа:', error)
      showAppMessage('Ошибка редактирования документа: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось сохранить документ.')
      return
    }

    cancelEditDocument()
    await refreshDocuments()
  }

  const handleDeleteDocument = async (document: ProjectDocument) => {
    const canDelete = document.author_id === currentUserId || isAuthor

    if (!canDelete) {
      showAppMessage('Удалить документ может автор документа или автор проекта.')
      return
    }

    const ok = window.confirm(`Удалить документ "${document.title}"?`)
    if (!ok) return

    setDeletingDocumentId(document.id)

    const { data, error } = await supabase
      .from('project_documents')
      .delete()
      .eq('id', document.id)
      .select('id')

    setDeletingDocumentId(null)

    if (error) {
      logAppError('Ошибка удаления документа:', error)
      showAppMessage('Ошибка удаления документа: ' + error.message)
      return
    }

    if (!data || data.length === 0) {
      showAppMessage('Не удалось удалить документ.')
      return
    }

    if (editingDocumentId === document.id) {
      cancelEditDocument()
    }

    setSelectedDocumentId((currentId) =>
      currentId === document.id ? null : currentId
    )

    await refreshDocuments()
  }

  return (
    <div className="border rounded-xl bg-white p-5 shadow-sm mt-10">
      <h2 className="text-xl font-semibold mb-4">Документы проекта</h2>

      <div className="border rounded-lg p-4 bg-gray-50 mb-6">
        <h3 className="font-semibold mb-3">Создать документ</h3>

        <div className="space-y-3">
          <input
            type="text"
            placeholder="Название документа"
            value={newDocumentTitle}
            onChange={(e) => setNewDocumentTitle(e.target.value)}
            className="border rounded p-2 w-full bg-white"
          />

          <textarea
            placeholder="Содержимое документа"
            value={newDocumentContent}
            onChange={(e) => setNewDocumentContent(e.target.value)}
            className="border rounded p-2 w-full bg-white min-h-[140px]"
          />

          <button
            onClick={handleCreateDocument}
            disabled={creatingDocument}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {creatingDocument ? 'Создаём...' : 'Создать документ'}
          </button>
        </div>
      </div>

      {documentsLoading ? (
        <div className="text-sm text-gray-500">Загружаем документы...</div>
      ) : documents.length === 0 ? (
        <div className="text-sm text-gray-500">Пока документов нет.</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="border rounded-lg bg-gray-50 p-3">
            <h3 className="font-semibold mb-3">Список документов</h3>

            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {documents.map((document) => {
                const isSelected = document.id === selectedDocumentId

                return (
                  <button
                    key={document.id}
                    onClick={() => {
                      setSelectedDocumentId(document.id)
                      cancelEditDocument()
                    }}
                    className={`w-full text-left border rounded-lg p-3 transition ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-900 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-medium line-clamp-2">
                      {document.title}
                    </div>

                    <div
                      className={`text-xs mt-1 ${
                        isSelected ? 'text-blue-100' : 'text-gray-500'
                      }`}
                    >
                      Автор: {getMemberName(document.author_id)}
                    </div>

                    <div
                      className={`text-xs mt-1 ${
                        isSelected ? 'text-blue-100' : 'text-gray-400'
                      }`}
                    >
                      Обновлено: {new Date(document.updated_at).toLocaleString()}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="border rounded-lg bg-gray-50 p-4 min-h-[420px]">
            {!selectedDocument ? (
              <div className="text-sm text-gray-500">
                Выберите документ слева.
              </div>
            ) : editingDocumentId === selectedDocument.id ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={editDocumentTitle}
                  onChange={(e) => setEditDocumentTitle(e.target.value)}
                  className="border rounded p-2 w-full bg-white"
                  placeholder="Название документа"
                />

                <textarea
                  value={editDocumentContent}
                  onChange={(e) => setEditDocumentContent(e.target.value)}
                  className="border rounded p-3 w-full bg-white min-h-[420px] font-mono text-sm"
                  placeholder="Содержимое документа"
                />

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleSaveDocumentEdit(selectedDocument.id)}
                    disabled={savingDocumentId === selectedDocument.id}
                    className="bg-green-600 text-white text-sm px-3 py-1 rounded hover:bg-green-700 transition disabled:opacity-60"
                  >
                    {savingDocumentId === selectedDocument.id
                      ? 'Сохраняем...'
                      : 'Сохранить'}
                  </button>

                  <button
                    onClick={cancelEditDocument}
                    disabled={savingDocumentId === selectedDocument.id}
                    className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded hover:bg-gray-300 transition disabled:opacity-60"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-2xl font-semibold">
                      {selectedDocument.title}
                    </h3>

                    <div className="text-sm text-gray-600 mt-2">
                      Автор: <b>{getMemberName(selectedDocument.author_id)}</b>
                    </div>

                    <div className="text-xs text-gray-400 mt-1">
                      Создано: {new Date(selectedDocument.created_at).toLocaleString()}
                    </div>

                    <div className="text-xs text-gray-400 mt-1">
                      Обновлено: {new Date(selectedDocument.updated_at).toLocaleString()}
                    </div>
                  </div>

                  {(selectedDocument.author_id === currentUserId || isAuthor) && (
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => startEditDocument(selectedDocument)}
                        className="bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition"
                      >
                        Редактировать
                      </button>

                      <button
                        onClick={() => handleDeleteDocument(selectedDocument)}
                        disabled={deletingDocumentId === selectedDocument.id}
                        className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                      >
                        {deletingDocumentId === selectedDocument.id
                          ? 'Удаляем...'
                          : 'Удалить'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="border rounded-lg bg-white p-4 min-h-[280px] whitespace-pre-wrap text-sm text-gray-800">
                  {selectedDocument.content || 'Пустой документ.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
