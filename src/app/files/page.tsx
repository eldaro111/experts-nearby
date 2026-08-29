'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { getAppErrorMessage, logAppError, showAppError } from '@/lib/appFeedback'

type ProjectFile = {
  id: string
  project_id: string
  uploaded_by: string | null
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  category: string | null
  description: string | null
  version_label: string | null
  task_id: string | null
  created_at: string | null
}

type Listing = {
  id: string
  title: string
  description: string | null
  created_by: string | null
  deadline_at: string | null
}

type Profile = {
  user_id: string
  display_name: string | null
}

const fileCategoryLabel = (category?: string | null) => {
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

  return map[category || 'other'] || category || 'Другое'
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

const formatDate = (value?: string | null) => {
  if (!value) return '—'

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

export default function FilesPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [projectsById, setProjectsById] = useState<Record<string, Listing>>({})
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({})

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openingFileId, setOpeningFileId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [uploadedByMeOnly, setUploadedByMeOnly] = useState(false)

  useEffect(() => {
    const loadFiles = async () => {
      setLoading(true)
      setError('')

      const { data: userData, error: userError } = await supabase.auth.getUser()

      if (userError || !userData.user) {
        setUserId(null)
        setFiles([])
        setProjectsById({})
        setProfilesById({})
        setLoading(false)
        return
      }

      const currentUserId = userData.user.id
      setUserId(currentUserId)

      const { data: filesData, error: filesError } = await supabase
        .from('project_files')
        .select('*')
        .order('created_at', { ascending: false })

      if (filesError) {
        logAppError('Ошибка загрузки файлов', filesError)
        setError(getAppErrorMessage(filesError, 'Не удалось загрузить файлы.'))
        setFiles([])
        setProjectsById({})
        setProfilesById({})
        setLoading(false)
        return
      }

      const nextFiles = (filesData || []) as ProjectFile[]
      setFiles(nextFiles)

      const projectIds = unique(nextFiles.map((file) => file.project_id))
      const uploaderIds = unique(
        nextFiles
          .map((file) => file.uploaded_by || '')
          .filter(Boolean)
      )

      if (projectIds.length > 0) {
        const { data: projectsData, error: projectsError } = await supabase
          .from('listings')
          .select('id,title,description,created_by,deadline_at')
          .in('id', projectIds)

        if (projectsError) {
          logAppError('Ошибка загрузки проектов для файлов', projectsError)
          setProjectsById({})
        } else {
          const nextProjects: Record<string, Listing> = {}
          ;((projectsData || []) as Listing[]).forEach((project) => {
            nextProjects[project.id] = project
          })
          setProjectsById(nextProjects)
        }
      } else {
        setProjectsById({})
      }

      if (uploaderIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles_collaboration')
          .select('user_id,display_name')
          .in('user_id', uploaderIds)

        if (profilesError) {
          logAppError('Ошибка загрузки авторов файлов', profilesError)
          setProfilesById({})
        } else {
          const nextProfiles: Record<string, Profile> = {}
          ;((profilesData || []) as Profile[]).forEach((profile) => {
            nextProfiles[profile.user_id] = profile
          })
          setProfilesById(nextProfiles)
        }
      } else {
        setProfilesById({})
      }

      setLoading(false)
    }

    loadFiles()
  }, [])

  const projectOptions = useMemo(() => {
    const ids = unique(files.map((file) => file.project_id))

    return ids
      .map((id) => ({
        id,
        title: projectsById[id]?.title || 'Проект без названия',
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  }, [files, projectsById])

  const categoryOptions = useMemo(() => {
    return unique(files.map((file) => file.category || 'other'))
      .map((category) => ({
        value: category,
        label: fileCategoryLabel(category),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  }, [files])

  const filteredFiles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return files.filter((file) => {
      const project = projectsById[file.project_id]
      const uploader = file.uploaded_by ? profilesById[file.uploaded_by] : null

      const haystack = [
        file.file_name,
        file.description,
        file.version_label,
        file.category,
        file.mime_type,
        project?.title,
        project?.description,
        uploader?.display_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch)
      const matchesProject = projectFilter === 'all' || file.project_id === projectFilter
      const matchesCategory = categoryFilter === 'all' || (file.category || 'other') === categoryFilter
      const matchesUploader = !uploadedByMeOnly || file.uploaded_by === userId

      return matchesSearch && matchesProject && matchesCategory && matchesUploader
    })
  }, [files, projectsById, profilesById, search, projectFilter, categoryFilter, uploadedByMeOnly, userId])

  const handleOpenFile = async (file: ProjectFile) => {
    if (openingFileId) return

    setOpeningFileId(file.id)

    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from('project-files')
        .createSignedUrl(file.file_path, 60 * 5)

      if (signedUrlError || !data?.signedUrl) {
        showAppError(
          signedUrlError,
          'Не удалось создать безопасную ссылку на файл.',
          'Ошибка открытия файла'
        )
        return
      }

      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      showAppError(error, 'Не удалось открыть файл.', 'Ошибка открытия файла')
    } finally {
      setOpeningFileId(null)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-xl border bg-white p-8 text-center text-gray-600 shadow-sm">
          Загружаю файлы...
        </div>
      </main>
    )
  }

  if (!userId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Файлы проектов</h1>
          <p className="mb-4 text-gray-600">Чтобы видеть материалы проектов, нужно войти.</p>
          <Link
            href="/auth"
            className="inline-flex rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
          >
            Войти
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-blue-700">Материалы</p>
          <h1 className="text-3xl font-bold text-gray-900">Файлы проектов</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Все файлы из проектов, где ты автор или участник. Можно быстро найти документ, чертёж, CAD, код, отчёт или архив.
          </p>
        </div>

        <Link
          href="/dashboard"
          className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          В дашборд
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ошибка загрузки файлов: {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{files.length}</div>
          <div className="text-sm text-gray-500">всего файлов</div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{projectOptions.length}</div>
          <div className="text-sm text-gray-500">проектов с файлами</div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">
            {files.filter((file) => file.uploaded_by === userId).length}
          </div>
          <div className="text-sm text-gray-500">загружено мной</div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">{filteredFiles.length}</div>
          <div className="text-sm text-gray-500">найдено по фильтрам</div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <input
            type="text"
            placeholder="Поиск по названию, описанию, проекту..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
          />

          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">Все проекты</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">Все категории</option>
            {categoryOptions.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={uploadedByMeOnly}
            onChange={(event) => setUploadedByMeOnly(event.target.checked)}
          />
          Только загруженные мной
        </label>
      </div>

      {filteredFiles.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-500 shadow-sm">
          Файлы не найдены.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFiles.map((file) => {
            const project = projectsById[file.project_id]
            const uploader = file.uploaded_by ? profilesById[file.uploaded_by] : null

            return (
              <div
                key={file.id}
                className="rounded-xl border bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-lg font-semibold text-gray-900">
                        {file.file_name}
                      </h2>
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                        {fileCategoryLabel(file.category)}
                      </span>
                      {file.version_label && (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {file.version_label}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-sm text-gray-600">
                      Проект:{' '}
                      <Link
                        href={`/projects/${file.project_id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {project?.title || 'Проект'}
                      </Link>
                    </div>

                    <div className="mt-1 text-sm text-gray-600">
                      Загрузил:{' '}
                      <span className="font-medium">
                        {uploader?.display_name || (file.uploaded_by === userId ? 'Вы' : 'Неизвестный пользователь')}
                      </span>
                    </div>

                    {file.description && (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
                        {file.description}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span>Размер: {formatFileSize(file.file_size)}</span>
                      <span>Дата: {formatDate(file.created_at)}</span>
                      {file.mime_type && <span>Тип: {file.mime_type}</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() => handleOpenFile(file)}
                      disabled={openingFileId === file.id}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition hover:bg-blue-700 disabled:opacity-60"
                    >
                      {openingFileId === file.id ? 'Открываем...' : 'Открыть файл'}
                    </button>

                    <Link
                      href={`/projects/${file.project_id}`}
                      className="rounded-lg border px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
                    >
                      Открыть проект
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}