'use client'

import { supabase } from '@/lib/supabaseClient'
import { MAX_BYTES, PACK_FORMAT, validateInputs, type PackInput, type PackKind, type PreparedFile, type Progress, type StoredFile } from './format'
import type { RestoreExpectation } from './pack'

function processInWorker<T>(request: object, progress?: (value: Progress) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Обработка отменена.', 'AbortError'))
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    let timeout: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal?.removeEventListener('abort', cancel) }
    const renewTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => { cleanup(); reject(new Error('Обработка остановилась. Повторите попытку или выберите файл меньшего размера.')) }, 120000)
    }
    const cancel = () => { cleanup(); reject(new DOMException('Обработка отменена.', 'AbortError')) }
    signal?.addEventListener('abort', cancel, { once: true })
    renewTimeout()
    worker.onerror = () => { cleanup(); reject(new Error('Не удалось запустить обработку файлов. Перезагрузите страницу или загрузите обычный файл без сжатия.')) }
    worker.onmessageerror = () => { cleanup(); reject(new Error('Не удалось передать результат обработки файла.')) }
    worker.onmessage = event => {
      renewTimeout()
      if (event.data.type === 'progress') progress?.(event.data.value)
      else if (event.data.type === 'result') { cleanup(); resolve(event.data.value as T) }
      else { cleanup(); reject(new Error(event.data.message)) }
    }
    try { worker.postMessage(request) }
    catch (error) { cleanup(); reject(error) }
  })
}

export function prepareProjectFiles(inputs: PackInput[], kind: PackKind, progress?: (p: Progress) => void, signal?: AbortSignal) {
  validateInputs(inputs, kind)
  return processInWorker<PreparedFile>({ action: 'pack', inputs, kind }, progress, signal)
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.replace(/[\\/\x00-\x1f]/g, '_')
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export async function openProjectFile(file: StoredFile, progress?: (p: Progress) => void, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (file.storage_format && !['raw', PACK_FORMAT].includes(file.storage_format)) throw new Error('Неизвестный формат файла. Обновите страницу.')
  const { data, error } = await supabase.storage.from('project-files').createSignedUrl(file.file_path, 60 * 5)
  if (error || !data?.signedUrl) throw new Error('Не удалось получить доступ к файлу. Проверьте подключение и права доступа.')
  signal?.throwIfAborted()
  if (file.storage_format !== PACK_FORMAT) {
    const anchor = document.createElement('a')
    anchor.href = data.signedUrl
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    return
  }
  if (!file.file_size || file.file_size > MAX_BYTES || file.original_size == null || !file.file_count ||
    !file.storage_sha256 || !['single', 'folder'].includes(file.pack_kind || '')) throw new Error('Не хватает сведений для восстановления файла.')
  progress?.({ stage: 'downloading', done: 0, total: file.file_size })
  const response = await fetch(data.signedUrl, { signal })
  if (!response.ok || !response.body) throw new Error('Не удалось скачать файл. Попробуйте ещё раз.')
  const reader = response.body.getReader()
  const parts: Blob[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > file.file_size) throw new Error('Размер файла не совпадает с записью в проекте.')
      parts.push(new Blob([chunk.value.slice()]))
      progress?.({ stage: 'downloading', done: size, total: file.file_size })
    }
  } finally { await reader.cancel().catch(() => {}) }
  if (size !== file.file_size) throw new Error('Файл скачан не полностью. Попробуйте ещё раз.')
  const expected: RestoreExpectation = { sha256: file.storage_sha256, originalSize: file.original_size, fileCount: file.file_count, kind: file.pack_kind! }
  const restored = await processInWorker<Blob>({ action: 'restore', blob: new Blob(parts), expected }, progress, signal)
  signal?.throwIfAborted()
  downloadBlob(restored, file.file_name)
}

export function progressLabel(progress: Progress) {
  const names = { packing: 'Подготавливаем файлы', uploading: 'Загружаем в проект', downloading: 'Скачиваем', restoring: 'Восстанавливаем и проверяем файлы' }
  return `${names[progress.stage]}${progress.total > 0 ? `: ${Math.min(100, Math.round(progress.done / progress.total * 100))}%` : '…'}`
}
