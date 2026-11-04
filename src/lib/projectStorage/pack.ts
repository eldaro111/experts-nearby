import { compress, decompress, init } from '@bokuweb/zstd-wasm'
import { createSHA256 } from 'hash-wasm'
import { Zip, ZipDeflate } from 'fflate'
import {
  HEADER_BYTES, MAGIC, MAX_BYTES, MAX_CHUNKS, MAX_CHUNK_BYTES, MAX_MANIFEST_BYTES,
  MIN_CHUNK_BYTES, PACK_FORMAT, PACK_MIME, validateInputs, validateManifest, validateZstdFrame,
  type Manifest, type PackInput, type PackKind, type PreparedFile, type Progress,
} from './format'

let ready: Promise<void> | undefined
// The package exposes separate Node (no argument) and browser (optional URL) signatures.
export const initializeCodec = (wasmPath?: string) => ready ??= (init as (path?: string) => Promise<void>)(wasmPath)
const READ_BYTES = 1024 * 1024
const owned = (bytes: Uint8Array) => bytes.slice() as Uint8Array<ArrayBuffer>

export async function hashBlob(blob: Blob) {
  const hash = await createSHA256()
  for (let offset = 0; offset < blob.size; offset += READ_BYTES) {
    hash.update(new Uint8Array(await blob.slice(offset, offset + READ_BYTES).arrayBuffer()))
  }
  return hash.digest()
}

let gearTable: Uint32Array | undefined
async function gear() {
  if (gearTable) return gearTable
  const hash = await createSHA256()
  const seed = new TextEncoder().encode('nearby-cad-gear-v1')
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    hash.init().update(seed).update(new Uint8Array([i]))
    const bytes = hash.digest('binary')
    table[i] = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)
  }
  // Only the low 16 bits decide cuts, so uint32 gives the same boundaries as the uint64 prototype.
  gearTable = table
  return table
}

export async function* chunks(blob: Blob): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const table = await gear()
  let buffer = new Uint8Array(MAX_CHUNK_BYTES)
  let size = 0
  let rolling = 0
  for (let offset = 0; offset < blob.size; offset += READ_BYTES) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + READ_BYTES).arrayBuffer())
    for (const byte of bytes) {
      buffer[size++] = byte
      rolling = ((rolling << 1) + table[byte]) >>> 0
      if (size === MAX_CHUNK_BYTES || (size >= MIN_CHUNK_BYTES && (rolling & 0xffff) === 0)) {
        yield buffer.slice(0, size)
        buffer = new Uint8Array(MAX_CHUNK_BYTES)
        size = 0
        rolling = 0
      }
    }
  }
  if (size) yield buffer.slice(0, size)
}

export async function createPack(inputs: PackInput[], kind: PackKind, progress?: (p: Progress) => void): Promise<PreparedFile> {
  const totalSize = validateInputs(inputs, kind)
  await initializeCodec()
  const fileHash = await createSHA256()
  const chunkHash = await createSHA256()
  const manifest: Manifest = { version: 1, kind, totalSize, files: [], objects: [] }
  const payloads: Blob[] = []
  const objectIds = new Map<string, number>()
  let payloadSize = 0
  let done = 0
  let references = 0
  for (const input of inputs) {
    fileHash.init()
    const refs: number[] = []
    for await (const block of chunks(input.blob)) {
      fileHash.update(block)
      const sha256 = chunkHash.init().update(block).digest()
      let id = objectIds.get(sha256)
      if (id === undefined) {
        const compressed = compress(block, 3)
        const useCompressed = compressed.length <= block.length * 0.95
        const stored = useCompressed ? owned(compressed) : block
        id = manifest.objects.length
        objectIds.set(sha256, id)
        manifest.objects.push({ sha256, offset: payloadSize, size: block.length, stored: stored.length, codec: useCompressed ? 'zstd' : 'raw' })
        payloads.push(new Blob([stored]))
        payloadSize += stored.length
      }
      if (++references > MAX_CHUNKS) throw new Error('Слишком много фрагментов. Разделите сборку на несколько папок.')
      refs.push(id)
      done += block.length
      progress?.({ stage: 'packing', done, total: totalSize })
    }
    manifest.files.push({ path: input.path, size: input.blob.size, sha256: fileHash.digest(), chunks: refs,
      lastModified: Math.max(0, Math.min(8640000000000000, Math.trunc(input.lastModified || 0))) })
  }
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  if (json.length > MAX_MANIFEST_BYTES) throw new Error('Слишком много данных об именах файлов. Разделите сборку.')
  const header = new Uint8Array(HEADER_BYTES)
  header.set(MAGIC)
  new DataView(header.buffer).setUint32(8, json.length, true)
  const blob = new Blob([header, json, ...payloads], { type: PACK_MIME })
  // The original single file is retained if the entire container saves less than 5%.
  if (kind === 'single' && blob.size > totalSize * 0.95) {
    return { blob: inputs[0].blob, storageFormat: 'raw', kind: null, originalSize: totalSize, fileCount: 1, sha256: manifest.files[0].sha256 }
  }
  if (blob.size > MAX_BYTES) throw new Error('Размер подготовленной сборки превышает 500 МиБ. Разделите её на части.')
  return { blob, storageFormat: PACK_FORMAT, kind, originalSize: totalSize, fileCount: inputs.length, sha256: await hashBlob(blob) }
}

export async function readManifest(blob: Blob) {
  if (blob.size < HEADER_BYTES || blob.size > MAX_BYTES) throw new Error('Недопустимый размер сохранённого файла.')
  const header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer())
  if (MAGIC.some((byte, i) => byte !== header[i])) throw new Error('Неизвестный формат сохранённого файла.')
  const length = new DataView(header.buffer).getUint32(8, true)
  if (!length || length > MAX_MANIFEST_BYTES || HEADER_BYTES + length > blob.size) throw new Error('Повреждён заголовок сборки.')
  const value: unknown = JSON.parse(await blob.slice(HEADER_BYTES, HEADER_BYTES + length).text())
  return { manifest: validateManifest(value, blob.size - HEADER_BYTES - length), payloadOffset: HEADER_BYTES + length }
}

export type RestoreExpectation = { sha256: string; originalSize: number; fileCount: number; kind: PackKind }

export async function restorePack(blob: Blob, expected: RestoreExpectation, progress?: (p: Progress) => void): Promise<Blob> {
  if (blob.size > MAX_BYTES || !/^[a-f0-9]{64}$/.test(expected.sha256) || await hashBlob(blob) !== expected.sha256) {
    throw new Error('Проверка целостности не пройдена. Файл не будет скачан; попробуйте ещё раз.')
  }
  const { manifest, payloadOffset } = await readManifest(blob)
  if (manifest.totalSize !== expected.originalSize || manifest.files.length !== expected.fileCount || manifest.kind !== expected.kind) {
    throw new Error('Сведения о сборке не совпадают с записью в проекте.')
  }
  await initializeCodec()
  const fileHash = await createSHA256()
  const chunkHash = await createSHA256()
  const output: Blob[] = []
  let zipError: Error | null = null
  let zipComplete = false
  const zip = manifest.kind === 'folder' ? new Zip((error, data, final) => {
    if (error) zipError = error
    else output.push(new Blob([owned(data)]))
    if (final) zipComplete = true
  }) : null
  let done = 0
  // Only one decoded chunk is kept in memory; repeated chunks are read and verified again.
  for (const file of manifest.files) {
    const zipFile = zip ? new ZipDeflate(file.path, { level: 6 }) : null
    if (zipFile) {
      const date = new Date(file.lastModified)
      zipFile.mtime = date.getFullYear() >= 1980 && date.getFullYear() <= 2099 ? date : new Date(1980, 0, 1)
      zip!.add(zipFile)
    }
    fileHash.init()
    for (const index of file.chunks) {
      const obj = manifest.objects[index]
      const start = payloadOffset + obj.offset
      const stored = new Uint8Array(await blob.slice(start, start + obj.stored).arrayBuffer())
      if (obj.codec === 'zstd') validateZstdFrame(stored, obj.size)
      const block = obj.codec === 'zstd' ? owned(decompress(stored, { defaultHeapSize: MAX_CHUNK_BYTES })) : stored
      if (block.length !== obj.size || chunkHash.init().update(block).digest() !== obj.sha256) {
        throw new Error('Повреждён фрагмент сборки. Скачивание остановлено.')
      }
      fileHash.update(block)
      if (zipFile) zipFile.push(block, false)
      else output.push(new Blob([block]))
      if (zipError) throw zipError
      done += block.length
      progress?.({ stage: 'restoring', done, total: manifest.totalSize })
    }
    if (fileHash.digest() !== file.sha256) throw new Error('Контрольная сумма восстановленного файла не совпала.')
    zipFile?.push(new Uint8Array(0), true)
  }
  zip?.end()
  if (zipError) throw zipError
  if (zip && !zipComplete) throw new Error('Не удалось завершить ZIP сборки.')
  return new Blob(output, { type: zip ? 'application/zip' : 'application/octet-stream' })
}
