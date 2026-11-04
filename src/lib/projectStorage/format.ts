// Limits apply to both creation and decoding, before any decompression.
export const MAX_BYTES = 500 * 1024 * 1024
export const MAX_FILES = 2000
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
export const MAX_CHUNKS = 40000
export const MIN_CHUNK_BYTES = 16 * 1024
export const MAX_CHUNK_BYTES = 256 * 1024
export const PACK_FORMAT = 'nearby-pack-v1' as const
export const PACK_MIME = 'application/vnd.nearby.project-pack'
export const MAGIC = new TextEncoder().encode('NRPK0001')
export const HEADER_BYTES = 12

export type PackKind = 'single' | 'folder'
export type PackInput = { path: string; blob: Blob; lastModified?: number }
export type Progress = { stage: 'packing' | 'uploading' | 'downloading' | 'restoring'; done: number; total: number }
export type PackObject = { sha256: string; offset: number; size: number; stored: number; codec: 'raw' | 'zstd' }
export type PackEntry = { path: string; size: number; sha256: string; chunks: number[]; lastModified: number }
export type Manifest = { version: 1; kind: PackKind; totalSize: number; files: PackEntry[]; objects: PackObject[] }
export type PreparedFile = {
  blob: Blob
  storageFormat: 'raw' | typeof PACK_FORMAT
  kind: PackKind | null
  originalSize: number
  fileCount: number
  sha256: string
}
export type StoredFile = {
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  storage_format?: string | null
  pack_kind?: PackKind | null
  original_size?: number | null
  file_count?: number | null
  storage_sha256?: string | null
}

export function assertSafePath(path: string) {
  if (!path || path.length > 1024 || /[\\\x00-\x1f\x7f:<>"|?*]/.test(path)) {
    throw new Error('Недопустимое имя или путь файла в сборке.')
  }
  const parts = path.split('/')
  if (parts.length > 32 || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error('Недопустимое имя или путь файла в сборке.')
  }
}

export function validatePaths(paths: string[]) {
  const names = new Set<string>()
  const parents = new Set<string>()
  for (const path of paths) {
    assertSafePath(path)
    const key = path.normalize('NFC').toLowerCase()
    if (names.has(key) || parents.has(key)) throw new Error('В сборке есть совпадающие имена файлов или папок.')
    const parts = key.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      if (names.has(parent)) throw new Error('Путь файла совпадает с именем папки.')
      parents.add(parent)
    }
    names.add(key)
  }
}

export function validateInputs(files: PackInput[], kind: PackKind) {
  if (!files.length || files.length > MAX_FILES || (kind === 'single' && files.length !== 1)) {
    throw new Error(`Выберите от 1 до ${MAX_FILES} файлов.`)
  }
  validatePaths(files.map(f => f.path))
  const size = files.reduce((total, file) => total + file.blob.size, 0)
  if (size > MAX_BYTES) throw new Error('Общий размер исходных файлов не должен превышать 500 МиБ.')
  if (kind === 'single' && size === 0) throw new Error('Пустой файл нельзя загрузить отдельно.')
  return size
}

const integer = (n: unknown, max: number): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function validateManifest(value: unknown, payloadSize: number): Manifest {
  const fail = () => { throw new Error('Повреждена структура сохранённой сборки.') }
  if (!record(value) || value.version !== 1 || !['single', 'folder'].includes(String(value.kind)) ||
    !integer(value.totalSize, MAX_BYTES) || !Array.isArray(value.files) || !value.files.length ||
    value.files.length > MAX_FILES || !Array.isArray(value.objects) || value.objects.length > MAX_CHUNKS ||
    (value.kind === 'single' && value.files.length !== 1)) return fail()
  let offset = 0
  for (const obj of value.objects) {
    if (!record(obj) || !hash(obj.sha256) || !integer(obj.size, MAX_CHUNK_BYTES) || obj.size === 0 ||
      !integer(obj.stored, MAX_CHUNK_BYTES) || obj.stored === 0 || obj.offset !== offset ||
      !['raw', 'zstd'].includes(String(obj.codec)) || (obj.codec === 'raw' && obj.size !== obj.stored)) return fail()
    offset += obj.stored
    if (offset > payloadSize) return fail()
  }
  if (offset !== payloadSize) return fail()
  let total = 0
  let references = 0
  const used = new Set<number>()
  const paths: string[] = []
  for (const file of value.files) {
    if (!record(file) || typeof file.path !== 'string' || !integer(file.size, MAX_BYTES) ||
      !hash(file.sha256) || !integer(file.lastModified, 8640000000000000) || !Array.isArray(file.chunks)) return fail()
    paths.push(file.path)
    let size = 0
    for (const idx of file.chunks) {
      if (++references > MAX_CHUNKS || !integer(idx, value.objects.length - 1)) return fail()
      used.add(idx)
      size += (value.objects[idx] as PackObject).size
      if (size > MAX_BYTES) return fail()
    }
    if (size !== file.size) return fail()
    total += size
    if (total > MAX_BYTES) return fail()
  }
  if (total !== value.totalSize || used.size !== value.objects.length) return fail()
  validatePaths(paths)
  return value as unknown as Manifest
}

// Reject oversized/unknown-size Zstd frames BEFORE the WASM decoder allocates memory.
// Frame header: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
export function validateZstdFrame(bytes: Uint8Array, expected: number) {
  const invalid = () => { throw new Error('Повреждён сжатый фрагмент файла.') }
  if (bytes.length < 6 || bytes[0] !== 0x28 || bytes[1] !== 0xb5 || bytes[2] !== 0x2f || bytes[3] !== 0xfd) return invalid()
  const descriptor = bytes[4]
  const single = !!(descriptor & 32)
  const flag = descriptor >>> 6
  // Our encoder never uses dictionaries, reserved bits, or unknown-size frames.
  if ((descriptor & 0x1b) || (!single && flag === 0)) return invalid()
  let pos = 5
  if (!single) {
    const window = bytes[pos++]
    const base = 2 ** (10 + (window >>> 3))
    if (base + (base / 8) * (window & 7) > MAX_CHUNK_BYTES) return invalid()
  }
  const count = flag === 0 ? 1 : 2 ** flag
  if (pos + count > bytes.length) return invalid()
  let size = 0n
  for (let i = 0; i < count; i++) size |= BigInt(bytes[pos + i]) << BigInt(i * 8)
  if (flag === 1) size += 256n
  if (size !== BigInt(expected) || size > BigInt(MAX_CHUNK_BYTES)) return invalid()
}
