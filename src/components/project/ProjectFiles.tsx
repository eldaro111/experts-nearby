'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { createNotification } from '@/lib/notifications'
import { createProjectActivity } from '@/lib/projectActivity'
import { logAppError, showAppMessage } from '@/lib/appFeedback'
import { openProjectFile, prepareProjectFiles, progressLabel } from '@/lib/projectStorage/client'
import { MAX_BYTES, MAX_FILES, PACK_FORMAT, PACK_MIME, type PreparedFile, type Progress } from '@/lib/projectStorage/format'

import type {
  ProjectFile,
  ProjectMember,
  Task,
} from './types'

interface ProjectFilesProps {
  projectId: string
  currentUserId: string | null | undefined
  isAuthor: boolean
  members: ProjectMember[]
  tasks: Task[]
}

type UploadReservation = {
  reservation_id: string
  file_path: string
}

type FinalizedUpload = {
  project_file_id: string
}

type DeletedFileRecord = {
  deleted_file_id: string
  deleted_file_path: string
  deleted_file_name: string
}

function firstRpcRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null
  }

  if (value && typeof value === 'object') {
    return value as T
  }

  return null
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export function ProjectFiles({
  projectId,
  currentUserId,
  isAuthor,
  members,
  tasks,
}: ProjectFilesProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const processingRef = useRef<AbortController | null>(null)

  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<File[]>([])
  const [uploadMode, setUploadMode] = useState<'single' | 'folder'>('single')
  const [optimizeFile, setOptimizeFile] = useState(true)
  const [compressionReady, setCompressionReady] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [openingFileId, setOpeningFileId] = useState<string | null>(null)

  const [newFileCategory, setNewFileCategory] = useState('other')
  const [newFileDescription, setNewFileDescription] = useState('')
  const [newFileVersion, setNewFileVersion] = useState('')
  const [newFileTaskId, setNewFileTaskId] = useState('')

  useEffect(() => {
    let active = true
    void supabase.rpc('project_file_storage_version').then(({ data, error }) => {
      if (active) setCompressionReady(!error && data === 1)
    })
    return () => { active = false; processingRef.current?.abort() }
  }, [])

  useEffect(() => {
    const fetchProjectFiles = async () => {
      setFilesLoading(true)

      const { data, error } = await supabase
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (error) {
        logAppError('Ошибка загрузки файлов проекта:', error)
        setProjectFiles([])
      } else {
        setProjectFiles((data || []) as ProjectFile[])
      }

      setFilesLoading(false)
    }

    void fetchProjectFiles()
  }, [projectId])

  const refreshProjectFiles = async () => {
    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      logAppError('Ошибка обновления файлов проекта:', error)
      return
    }

    setProjectFiles((data || []) as ProjectFile[])
  }

  const getMemberName = (userId: string | null) => {
    if (!userId) return 'Не назначен'

    return (
      members.find((member) => member.user_id === userId)?.display_name ||
      'Неизвестный участник'
    )
  }

  const getTaskTitle = (taskId: string | null) => {
    if (!taskId) return 'Без привязки к задаче'
    return tasks.find((task) => task.id === taskId)?.title || 'Задача не найдена'
  }

  const formatFileSize = (size: number | null) => {
    if (!size || size <= 0) return '—'

    const kb = size / 1024
    if (kb < 1024) return `${kb.toFixed(1)} КБ`

    const mb = kb / 1024
    if (mb < 1024) return `${mb.toFixed(1)} МБ`

    const gb = mb / 1024
    return `${gb.toFixed(1)} ГБ`
  }

  const fileCategoryLabel = (category: string) => {
    const map: Record<string, string> = {
      document: 'Документ',
      drawing: 'Чертёж',
      cad: 'CAD',
      code: 'Код',
      image: 'Изображение',
      archive: 'Архив',
      report: 'Отчёт',
      presentation: 'Презентация',
      other: 'Другое',
    }

    return map[category] || category
  }

  const cancelReservation = async (
    reservationId: string,
    filePath: string
  ) => {
    const { error: removeError } = await supabase.storage
      .from('project-files')
      .remove([filePath])

    if (removeError) {
      console.warn(
        'Не удалось удалить объект при отмене загрузки:',
        removeError
      )
      return
    }

    const { error: cancelError } = await supabase.rpc(
      'cancel_project_file_upload_secure',
      {
        p_expected_user_id: currentUserId,
        p_reservation_id: reservationId,
      }
    )

    if (cancelError) {
      console.warn(
        'Не удалось удалить резервацию загрузки:',
        cancelError
      )
    }
  }

  const finalizeReservation = async (
    reservationId: string
  ): Promise<string | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data, error } = await supabase.rpc(
        'finalize_project_file_upload_secure',
        {
          p_expected_user_id: currentUserId,
          p_reservation_id: reservationId,
        }
      )

      if (!error) {
        return (
          firstRpcRow<FinalizedUpload>(data)?.project_file_id ?? null
        )
      }

      console.warn(
        `Не удалось финализировать файл, попытка ${attempt + 1}:`,
        error
      )

      if (attempt < 2) {
        await wait(400 * (attempt + 1))
      }
    }

    const { data: existingFile, error: lookupError } = await supabase
      .from('project_files')
      .select('id')
      .eq('upload_reservation_id', reservationId)
      .eq('uploaded_by', currentUserId)
      .maybeSingle()

    if (lookupError) {
      console.warn(
        'Не удалось проверить результат финализации:',
        lookupError
      )
    }

    return existingFile?.id || null
  }

  const handleUploadFile = async () => {
    if (uploadingFile || openingFileId) return
    if (!currentUserId) { showAppMessage('Пользователь не найден.'); return }
    const folder = uploadMode === 'folder'
    const inputs = folder ? selectedFolder : selectedFile ? [selectedFile] : []
    if (!inputs.length) { showAppMessage(folder ? 'Выберите папку сборки.' : 'Выберите файл.'); return }
    if (inputs.length > MAX_FILES || inputs.reduce((size, file) => size + file.size, 0) > MAX_BYTES) {
      showAppMessage('Лимит одной загрузки — 500 МиБ исходных данных и 2000 файлов.'); return
    }
    if (!folder && inputs[0].size === 0) { showAppMessage('Пустой файл нельзя загрузить отдельно.'); return }
    if (folder && !compressionReady) { showAppMessage('Загрузка сборок пока недоступна. Можно загрузить обычный файл.'); return }
    const name = folder ? `${inputs[0].webkitRelativePath.split('/')[0]}.zip` : inputs[0].name
    const mime = folder ? 'application/zip' : inputs[0].type
    const fileToUpload = { name, type: mime }
    let prepared: PreparedFile | null = null
    let fileSaved = false
    const controller = new AbortController()
    processingRef.current = controller
    setUploadingFile(true)
    setUploadMessage('')
    try {
      if (folder || (optimizeFile && compressionReady)) {
        setProgress({ stage: 'packing', done: 0, total: inputs.reduce((n, f) => n + f.size, 0) })
        prepared = await prepareProjectFiles(inputs.map(file => ({
          path: folder ? file.webkitRelativePath : file.name,
          blob: file,
          lastModified: file.lastModified,
        })), folder ? 'folder' : 'single', setProgress, controller.signal)
      }
      if (controller.signal.aborted) return
      // Cancellation terminates preparation/restoration only. A Storage upload has its own reservation lifecycle.
      processingRef.current = null
      const body = prepared?.blob || inputs[0]
      const packed = prepared?.storageFormat === PACK_FORMAT
      const params = {
        p_expected_user_id: currentUserId, p_project_id: projectId,
        p_file_name: name, p_file_size: body.size, p_mime_type: mime || null,
        p_category: newFileCategory, p_description: newFileDescription.trim() || null,
        p_version_label: newFileVersion.trim() || null, p_task_id: newFileTaskId || null,
      }
      const { data: reservationData, error: reservationError } = packed && prepared
        ? await supabase.rpc('reserve_project_file_pack_secure', {
            ...params, p_original_size: prepared.originalSize, p_file_count: prepared.fileCount,
            p_pack_kind: prepared.kind, p_storage_sha256: prepared.sha256,
          })
        : await supabase.rpc('reserve_project_file_upload_secure', params)
      if (reservationError) throw new Error('Не удалось подготовить загрузку: ' + reservationError.message)
      const reservation = firstRpcRow<UploadReservation>(reservationData)
      if (!reservation?.reservation_id || !reservation.file_path) throw new Error('Сервер не вернул резервацию загрузки.')
      setProgress({ stage: 'uploading', done: 0, total: 0 })
      const { error: uploadError } = await supabase.storage.from('project-files').upload(reservation.file_path, body, {
        upsert: false, contentType: packed ? PACK_MIME : mime || undefined,
      })
      if (uploadError) {
        await cancelReservation(reservation.reservation_id, reservation.file_path)
        if (/maximum allowed size|exceeded.*size|payload too large/i.test(uploadError.message)) {
          throw new Error('Файл превышает лимит хранилища. Разделите сборку на части или обратитесь к администратору сайта.')
        }
        throw new Error('Не удалось загрузить файл: ' + uploadError.message)
      }
      const projectFileId = await finalizeReservation(reservation.reservation_id)
      if (!projectFileId) {
        showAppMessage('Файл загружен, но регистрация не завершена. Не загружайте повторно. Обратитесь в поддержку и укажите номер: ' + reservation.reservation_id)
        return
      }
      fileSaved = true
      await createProjectActivity({
        projectId,
        actorId: currentUserId,
        type: 'file_uploaded',
        title: `Загружен файл «${fileToUpload.name}»`,
        body: `Категория: ${fileCategoryLabel(newFileCategory)}.`,
        entityType: 'project_file',
        entityId: projectFileId,
        metadata: {
          file_name: fileToUpload.name,
          file_path: reservation.file_path,
          category: newFileCategory,
          task_id: newFileTaskId || null,
        },
      })

      const notificationRecipients = members.filter(
        (member) => member.user_id !== currentUserId
      )

      await Promise.all(
        notificationRecipients.map((member) =>
          createNotification({
            recipientId: member.user_id,
            actorId: currentUserId,
            projectId,
            type: 'project_file_uploaded',
            title: 'В проект загружен новый файл',
            body: `Загружен файл «${fileToUpload.name}».`,
            href: `/projects/${projectId}`,
            payload: {
              project_id: projectId,
              file_name: fileToUpload.name,
              file_path: reservation.file_path,
              category: newFileCategory,
              task_id: newFileTaskId || null,
            },
          })
        )
      )

      setSelectedFile(null)
      setSelectedFolder([])
      setNewFileCategory('other')
      setNewFileDescription('')
      setNewFileVersion('')
      setNewFileTaskId('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (folderInputRef.current) folderInputRef.current.value = ''
      const saved = prepared ? prepared.originalSize - body.size : 0
      setUploadMessage(saved > 0 && packed
        ? `Загружено. Сэкономлено ${formatFileSize(saved)} (${Math.round(saved / prepared!.originalSize * 100)}%).`
        : 'Файл загружен.')
      await refreshProjectFiles()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      logAppError('Ошибка загрузки файла:', error)
      showAppMessage(fileSaved ? 'Файл сохранён, но обновить список не удалось. Обновите страницу.' : error instanceof Error ? error.message : 'Не удалось загрузить файл.')
    } finally {
      setUploadingFile(false)
      setProgress(null)
      processingRef.current = null
    }
  }

  const handleOpenFile = async (file: ProjectFile) => {
    if (openingFileId || uploadingFile) return
    setOpeningFileId(file.id)
    const controller = new AbortController()
    processingRef.current = controller
    try {
      await openProjectFile(file, setProgress, controller.signal)
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        showAppMessage(error instanceof Error ? error.message : 'Не удалось открыть файл.')
      }
    } finally {
      setOpeningFileId(null)
      setProgress(null)
      processingRef.current = null
    }
  }

  const handleDeleteFile = async (file: ProjectFile) => {
    if (!currentUserId) {
      showAppMessage('Пользователь не найден.')
      return
    }

    const ok = window.confirm(`Удалить файл "${file.file_name}"?`)
    if (!ok) return

    setDeletingFileId(file.id)

    const { error: storageError } = await supabase.storage
      .from('project-files')
      .remove([file.file_path])

    if (storageError) {
      setDeletingFileId(null)
      logAppError(
        'Ошибка удаления файла из Storage:',
        storageError
      )
      showAppMessage('Ошибка удаления файла: ' + storageError.message)
      return
    }

    const { data: deletedData, error: dbError } = await supabase.rpc(
      'delete_project_file_record_secure',
      {
        p_expected_user_id: currentUserId,
        p_file_id: file.id,
      }
    )

    setDeletingFileId(null)

    if (dbError) {
      logAppError(
        'Объект удалён, но метаданные не удалены:',
        dbError
      )
      showAppMessage(
        'Файл удалён из хранилища, но запись пока осталась. ' +
          'Нажмите «Удалить» ещё раз. Ошибка: ' +
          dbError.message
      )
      await refreshProjectFiles()
      return
    }

    const deleted =
      firstRpcRow<DeletedFileRecord>(deletedData)

    if (!deleted?.deleted_file_id) {
      console.warn(
        'RPC удаления не вернул удалённую строку:',
        deletedData
      )
    }

    await createProjectActivity({
      projectId,
      actorId: currentUserId,
      type: 'file_deleted',
      title: `Удалён файл «${file.file_name}»`,
      body: null,
      entityType: 'project_file',
      entityId: file.id,
      metadata: {
        file_name: file.file_name,
        file_path: file.file_path,
        category: file.category,
        task_id: file.task_id,
      },
    })

    await refreshProjectFiles()
  }

  return (
    <div className="border rounded-xl bg-white p-5 shadow-sm mt-10">
      <h2 className="text-xl font-semibold mb-4">Файлы проекта</h2>

      <div className="border rounded-lg p-4 bg-gray-50 mb-6">
        <h3 className="font-semibold mb-3">Загрузить файл</h3>

        <fieldset disabled={uploadingFile || !!openingFileId} className="space-y-3">
          {compressionReady && (
            <div className="flex flex-wrap gap-3 text-sm" role="group" aria-label="Способ загрузки">
              <label className="flex items-center gap-2"><input type="radio" checked={uploadMode === 'single'} onChange={() => setUploadMode('single')} />Отдельный файл</label>
              <label className="flex items-center gap-2"><input type="radio" checked={uploadMode === 'folder'} onChange={() => setUploadMode('folder')} />Папка сборки</label>
            </div>
          )}
          <div hidden={uploadMode !== 'single'}>
          <input
            ref={fileInputRef}
            aria-label="Выберите файл"
            type="file"
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] || null)
            }
            className="border rounded p-2 w-full bg-white"
          />
          {compressionReady && <label className="mt-2 flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={optimizeFile} onChange={event => setOptimizeFile(event.target.checked)} />Сжать без потери данных, если размер уменьшится</label>}
          </div>
          <div hidden={uploadMode !== 'folder'}>
            <input ref={folderInputRef} type="file" multiple {...{ webkitdirectory: '', directory: '' }} aria-label="Выберите папку сборки"
              onChange={event => setSelectedFolder(Array.from(event.target.files || []))} className="border rounded p-2 w-full bg-white" />
            <p className="mt-2 text-sm text-gray-600">Выберите папку со всеми деталями сборки. При скачивании Вы получите ZIP с исходными файлами и вложенными папками. Пустые папки браузер не передаёт.</p>
            {selectedFolder.length > 0 && <p className="mt-2 text-sm text-gray-600">Выбрано файлов: <b>{selectedFolder.length}</b> · {formatFileSize(selectedFolder.reduce((size, file) => size + file.size, 0))}</p>}
          </div>

          {uploadMode === 'single' && selectedFile && (
            <div className="text-sm text-gray-600">
              Выбран файл: <b>{selectedFile.name}</b> ·{' '}
              {formatFileSize(selectedFile.size)}
            </div>
          )}

          <select
            value={newFileCategory}
            onChange={(event) =>
              setNewFileCategory(event.target.value)
            }
            className="border rounded p-2 w-full bg-white"
          >
            <option value="other">Другое</option>
            <option value="document">Документ</option>
            <option value="drawing">Чертёж</option>
            <option value="cad">CAD</option>
            <option value="code">Код</option>
            <option value="image">Изображение</option>
            <option value="archive">Архив</option>
            <option value="report">Отчёт</option>
            <option value="presentation">Презентация</option>
          </select>

          <input
            type="text"
            placeholder="Версия: v1, draft, final, 0.2"
            value={newFileVersion}
            onChange={(event) =>
              setNewFileVersion(event.target.value)
            }
            className="border rounded p-2 w-full bg-white"
          />

          <select
            value={newFileTaskId}
            onChange={(event) =>
              setNewFileTaskId(event.target.value)
            }
            className="border rounded p-2 w-full bg-white"
          >
            <option value="">Без привязки к задаче</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>

          <textarea
            placeholder="Описание файла: что внутри, зачем нужен, к какой версии относится"
            value={newFileDescription}
            onChange={(event) =>
              setNewFileDescription(event.target.value)
            }
            className="border rounded p-2 w-full bg-white min-h-[90px]"
          />

          <button
            onClick={handleUploadFile}
            disabled={uploadingFile || !!openingFileId || (uploadMode === 'folder' ? !selectedFolder.length : !selectedFile)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
          >
            {uploadingFile ? 'Загружаем...' : uploadMode === 'folder' ? 'Загрузить сборку' : 'Загрузить файл'}
          </button>

          <p className="text-xs text-gray-500">
            До 500 МиБ исходных данных за одну загрузку. В сборке — до 2000 файлов.
            {' '}Лимит хранилища может быть ниже.
          </p>
        </fieldset>
        {progress && <div className="mt-3 text-sm text-blue-800" role="status" aria-live="polite">
          {progressLabel(progress)}
          {progress.total > 0 && <progress className="mt-2 block w-full" value={progress.done} max={progress.total} aria-label="Обработка файлов" />}
          {progress.stage !== 'uploading' && <button className="mt-2 underline" type="button" onClick={() => processingRef.current?.abort()}>Отменить обработку</button>}
        </div>}
        {uploadMessage && <p className="mt-3 text-sm text-green-700" role="status">{uploadMessage}</p>}
      </div>

      {filesLoading ? (
        <div className="text-sm text-gray-500">
          Загружаем файлы...
        </div>
      ) : projectFiles.length === 0 ? (
        <div className="text-sm text-gray-500">Пока файлов нет.</div>
      ) : (
        <div className="space-y-3">
          {projectFiles.map((file) => {
            const canDeleteFile =
              isAuthor || file.uploaded_by === currentUserId

            return (
              <div
                key={file.id}
                className="border rounded-lg p-4 bg-gray-50 flex flex-col md:flex-row md:items-start md:justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium break-words">
                    {file.file_name}
                  </div>

                  <div className="text-sm text-gray-600 mt-1">
                    Категория:{' '}
                    <b>{fileCategoryLabel(file.category)}</b>
                  </div>

                  {file.version_label && (
                    <div className="text-sm text-gray-600 mt-1">
                      Версия: <b>{file.version_label}</b>
                    </div>
                  )}

                  <div className="text-sm text-gray-600 mt-1">
                    Задача: <b>{getTaskTitle(file.task_id)}</b>
                  </div>

                  <div className="text-sm text-gray-600 mt-1">
                    Загрузил: <b>{getMemberName(file.uploaded_by)}</b>
                  </div>

                  {file.description && (
                    <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
                      {file.description}
                    </div>
                  )}

                  <div className="text-xs text-gray-400 mt-2">
                    {file.storage_format === PACK_FORMAT ? `В хранилище: ${formatFileSize(file.file_size)}` : `Размер: ${formatFileSize(file.file_size)}`} ·{' '}
                    {new Date(file.created_at).toLocaleString()}
                  </div>
                  {file.storage_format === PACK_FORMAT && <div className="text-xs text-gray-500 mt-1">
                    Исходные данные: {formatFileSize(file.original_size ?? null)}{file.pack_kind === 'folder' ? ` · ${file.file_count} файлов в сборке` : ''}
                  </div>}

                  {file.mime_type && (
                    <div className="text-xs text-gray-400 mt-1">
                      Тип: {file.mime_type}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap shrink-0">
                  <button
                    onClick={() => handleOpenFile(file)}
                    disabled={!!openingFileId || uploadingFile || deletingFileId === file.id}
                    className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded hover:bg-gray-300 transition disabled:opacity-60"
                  >
                    {openingFileId === file.id
                      ? 'Открываем...'
                      : file.storage_format === PACK_FORMAT ? 'Скачать' : 'Открыть'}
                  </button>

                  {canDeleteFile && (
                    <button
                      onClick={() => handleDeleteFile(file)}
                      disabled={deletingFileId === file.id || openingFileId === file.id}
                      className="bg-red-600 text-white text-sm px-3 py-1 rounded hover:bg-red-700 transition disabled:opacity-60"
                    >
                      {deletingFileId === file.id
                        ? 'Удаляем...'
                        : 'Удалить'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
