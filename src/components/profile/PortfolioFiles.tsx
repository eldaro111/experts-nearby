'use client'

import { UiText } from '@/components/LocaleProvider'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { PORTFOLIO_LIMIT } from '@/lib/profileOptions'
type PortfolioFile = {
  id: string
  name: string
  storage_path: string
  size_bytes: number
  status: 'pending' | 'ready'
}
export function PortfolioFiles({
  userId,
  editable = false,
}: {
  userId: string
  editable?: boolean
}) {
  const [files, setFiles] = useState<PortfolioFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: issue } = await supabase
      .from('portfolio_files')
      .select('id,name,storage_path,size_bytes,status')
      .eq('user_id', userId)
      .order('created_at')
    if (issue) setError('Не удалось загрузить портфолио. Повторите попытку.')
    else {
      setFiles(data || [])
      setError('')
    }
    setLoading(false)
  }, [userId])
  useEffect(() => {
    void load()
  }, [load])
  const used = files.reduce((sum, file) => sum + Number(file.size_bytes), 0)
  async function upload(selected: FileList | null) {
    if (!selected || busy) return
    const additions = Array.from(selected)
    setError('')
    if (
      used + additions.reduce((sum, file) => sum + file.size, 0) >
      PORTFOLIO_LIMIT
    ) {
      setError('Все PDF в портфолио вместе должны занимать не более 15 МБ.')
      if (input.current) input.current.value = ''
      return
    }
    setBusy(true)
    try {
      for (const file of additions) {
        if (
          !/\.pdf$/i.test(file.name) ||
          new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !==
            '%PDF-'
        )
          throw new Error('Можно загрузить только документы PDF.')
        const body = new FormData()
        body.append('file', file)
        const { data, error: issue } = await supabase.functions.invoke(
          'portfolio',
          { body },
        )
        if (issue) {
          const detail = await issue.context?.json?.().catch(() => null)
          throw new Error(
            detail?.error ||
              'Не удалось загрузить документ. Проверьте доступность сервиса и повторите попытку.',
          )
        }
        if (data?.error) throw new Error(data.error)
      }
      await load()
    } catch (issue) {
      await load()
      setError(
        issue instanceof Error ? issue.message : 'Не удалось загрузить PDF.',
      )
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  async function download(file: PortfolioFile) {
    setError('')
    const { data, error: issue } = await supabase.storage
      .from('portfolio')
      .createSignedUrl(file.storage_path, 60, { download: file.name })
    if (issue || !data) {
      setError('Документ недоступен. Обновите страницу и повторите попытку.')
      return
    }
    window.location.assign(data.signedUrl)
  }
  async function remove(file: PortfolioFile) {
    if (!window.confirm(`Удалить «${file.name}» из портфолио?`)) return
    setBusy(true)
    setError('')
    const { data, error: issue } = await supabase.functions.invoke(
      'portfolio',
      { body: { action: 'delete', id: file.id } },
    )
    if (issue || data?.error)
      setError('Не удалось удалить документ. Повторите попытку.')
    else await load()
    setBusy(false)
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          <UiText text={'Портфолио в PDF'} />
        </h3>
        {editable && (
          <span className="text-xs text-slate-500">
            {(used / 1024 / 1024).toFixed(1)} / 15 МБ
          </span>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">
          <UiText text={'Загружаем документы…'} />
        </p>
      ) : files.filter((f) => f.status === 'ready').length === 0 ? (
        <p className="text-sm text-slate-500">
          <UiText text={'Документы пока не добавлены.'} />
        </p>
      ) : (
        <ul className="space-y-2">
          {files
            .filter((f) => f.status === 'ready')
            .map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <FileText size={20} className="shrink-0 text-blue-600" />
                <button
                  type="button"
                  onClick={() => download(file)}
                  className="min-w-0 flex-1 text-left text-sm text-blue-700 break-words"
                >
                  {file.name}
                  <span className="block text-xs text-slate-500">
                    {(file.size_bytes / 1024 / 1024).toFixed(2)} МБ · Скачать
                    PDF
                  </span>
                </button>
                {editable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(file)}
                    className="icon-button"
                    aria-label={`Удалить ${file.name}`}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}{' '}
          <button type="button" onClick={load} className="underline">
            Обновить список
          </button>
        </p>
      )}
      {editable && (
        <>
          <input
            ref={input}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="sr-only"
            aria-label="Выберите PDF для портфолио"
            onChange={(e) => void upload(e.target.files)}
            disabled={busy || loading}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy || loading}
            className="action-secondary"
          >
            <Upload size={17} />
            <UiText text={busy ? 'Обрабатываем…' : 'Загрузить PDF'} />
          </button>
          <p className="text-xs text-slate-500">
            Только PDF, не более 15 МБ суммарно. Видимость документов
            определяется настройкой «Показывать портфолио» и видимостью профиля.
          </p>
        </>
      )}
    </section>
  )
}
