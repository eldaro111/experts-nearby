import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'
import { chunks, createPack, hashBlob, readManifest, restorePack } from '../../src/lib/projectStorage/pack'
import { HEADER_BYTES, MAX_BYTES, MAX_CHUNK_BYTES, MAX_FILES, PACK_FORMAT, validateInputs, validateManifest, validatePaths, validateZstdFrame, type PreparedFile } from '../../src/lib/projectStorage/format'

const expectation = (pack: PreparedFile) => ({ sha256: pack.sha256, originalSize: pack.originalSize, fileCount: pack.fileCount, kind: pack.kind! })
const buffer = async (blob: Blob) => Buffer.from(await blob.arrayBuffer())
const entry = (path: string, data: Uint8Array | string) => ({ path, blob: new Blob([typeof data === 'string' ? data : new Uint8Array(data)]), lastModified: 1700000000000 })

test('single file is compressed and restored byte for byte', async () => {
  const original = entry('Чертёж.dxf', 'POINT 10 20 30\r\n'.repeat(12000))
  const pack = await createPack([original], 'single')
  assert.equal(pack.storageFormat, PACK_FORMAT)
  assert.ok(pack.blob.size < original.blob.size * .95)
  assert.deepEqual(await buffer(await restorePack(pack.blob, expectation(pack))), await buffer(original.blob))
})

test('incompressible file is kept in its original representation', async () => {
  const original = entry('model.sldprt', randomBytes(100000))
  const pack = await createPack([original], 'single')
  assert.equal(pack.storageFormat, 'raw')
  assert.equal(pack.blob, original.blob)
  assert.equal(pack.sha256, createHash('sha256').update(await buffer(original.blob)).digest('hex'))
})

test('ordinary ZIP attachment retains the exact ZIP bytes', async () => {
  const zip = zipSync({ 'CAD/деталь.sldprt': randomBytes(60000), 'CAD/data.txt': new TextEncoder().encode('a'.repeat(300000)) })
  const input = entry('assembly.zip', zip)
  const pack = await createPack([input], 'single')
  const restored = pack.kind ? await restorePack(pack.blob, expectation(pack)) : pack.blob
  assert.deepEqual(await buffer(restored), Buffer.from(zip))
})

test('folder uses shared chunks; nested Unicode names, empty files and contents survive ZIP download', async () => {
  const repeated = randomBytes(600000)
  const inputs = [entry('Сборка/Детали/ось.sldprt', repeated), entry('Сборка/Копия/ось.sldprt', repeated),
    entry('Сборка/описание.txt', 'текст\n'.repeat(5000)), entry('Сборка/пустой.txt', '')]
  const pack = await createPack(inputs, 'folder')
  const { manifest } = await readManifest(pack.blob)
  assert.deepEqual(manifest.files[0].chunks, manifest.files[1].chunks)
  assert.ok(pack.blob.size < pack.originalSize * .6)
  const restored = unzipSync(new Uint8Array(await (await restorePack(pack.blob, expectation(pack))).arrayBuffer()))
  assert.deepEqual(Object.keys(restored).sort(), inputs.map(f => f.path).sort())
  for (const f of inputs) assert.deepEqual(Buffer.from(restored[f.path]), await buffer(f.blob))
})

test('CDC chunk bounds are stable after inserted data', async () => {
  const input = randomBytes(4 * 1024 * 1024)
  const hashes = async (blob: Blob) => {
    const values = []
    for await (const chunk of chunks(blob)) {
      assert.ok(chunk.length <= MAX_CHUNK_BYTES)
      values.push(createHash('sha256').update(chunk).digest('hex'))
    }
    return values
  }
  const original = await hashes(new Blob([input]))
  const changed = await hashes(new Blob([new Uint8Array([1, 2, 3]), input]))
  assert.ok(changed.filter(h => original.includes(h)).length >= original.length - 2)
})

test('unsafe and conflicting paths are rejected; valid names stay unchanged', () => {
  for (const path of ['../escape', '/absolute', 'a/../../b', 'C:/tmp', 'a\\b', 'a//b', 'a/CON.txt', 'a/NUL', 'a/end.', 'a/end ', 'a/\u0000b']) {
    assert.throws(() => validatePaths([path]))
  }
  for (const paths of [['a', 'a/b'], ['a/b', 'a'], ['A/file', 'a/FILE'], ['é', 'e\u0301']]) assert.throws(() => validatePaths(paths))
  validatePaths(['Сборка/деталь 1.sldprt', 'Сборка/деталь 2.sldprt'])
})

test('input limits checked before reading files', () => {
  assert.throws(() => validateInputs([], 'folder'))
  assert.throws(() => validateInputs(Array.from({ length: MAX_FILES + 1 }, (_, i) => entry(String(i), '')), 'folder'))
  assert.throws(() => validateInputs([{ path: 'large', blob: { size: MAX_BYTES + 1 } as Blob }], 'single'))
  assert.throws(() => validateInputs([entry('empty', '')], 'single'))
})

test('corruption, truncated storage, wrong DB metadata and unsupported formats fail closed', async () => {
  const pack = await createPack([entry('folder/f.txt', 'abc'.repeat(70000))], 'folder')
  await assert.rejects(restorePack(pack.blob.slice(0, -1), expectation(pack)), /целостности/)
  await assert.rejects(restorePack(pack.blob, { ...expectation(pack), fileCount: 2 }), /не совпадают/)
  const bytes = new Uint8Array(await pack.blob.arrayBuffer())
  bytes[0] ^= 1
  await assert.rejects(readManifest(new Blob([bytes])), /формат/)
  bytes[0] ^= 1
  bytes[bytes.length - 1] ^= 1
  const corrupt = new Blob([bytes])
  await assert.rejects(restorePack(corrupt, { ...expectation(pack), sha256: await hashBlob(corrupt) }))
  new DataView(bytes.buffer).setUint32(8, 0xffffffff, true)
  await assert.rejects(readManifest(new Blob([bytes])), /заголовок/)
})

test('manifest enforces offsets, lengths, references, aggregate limits and path uniqueness', async () => {
  const pack = await createPack([entry('folder/x', 'abcdef'.repeat(15000))], 'folder')
  const { manifest, payloadOffset } = await readManifest(pack.blob)
  for (const mutate of [
    (m: typeof manifest) => { m.objects[0].offset = 1 },
    (m: typeof manifest) => { m.objects[0].size = MAX_CHUNK_BYTES + 1 },
    (m: typeof manifest) => { m.files[0].chunks = [999999] },
    (m: typeof manifest) => { m.files[0].path = '../bad' },
    (m: typeof manifest) => { m.totalSize = MAX_BYTES + 1 },
    (m: typeof manifest) => { m.version = 2 as 1 },
  ]) {
    const copy = structuredClone(manifest)
    mutate(copy)
    assert.throws(() => validateManifest(copy, pack.blob.size - payloadOffset))
  }
  assert.ok(payloadOffset > HEADER_BYTES)
})

test('Zstd oversized, dictionary, unknown-size and invalid frames rejected before WASM allocation', () => {
  for (const data of [new Uint8Array(12), new Uint8Array([0x28,0xb5,0x2f,0xfd,0,0]),
    new Uint8Array([0x28,0xb5,0x2f,0xfd,0x21,1,1]), new Uint8Array([0x28,0xb5,0x2f,0xfd,0xe0,255,255,255,255,255,255,255,255])]) {
    assert.throws(() => validateZstdFrame(data, 100))
  }
})

test('real CAD fixture: round trip every file without publishing its contents', { skip: !process.env.CAD_TEST_ZIP }, async () => {
  const source = unzipSync(new Uint8Array(readFileSync(process.env.CAD_TEST_ZIP!)))
  const inputs = Object.entries(source).filter(([path]) => !path.endsWith('/')).map(([path, bytes]) => entry(path, bytes))
  const pack = await createPack(inputs, 'folder')
  const restored = unzipSync(new Uint8Array(await (await restorePack(pack.blob, expectation(pack))).arrayBuffer()))
  assert.deepEqual(Object.keys(restored).sort(), inputs.map(f => f.path).sort())
  for (const input of inputs) assert.deepEqual(Buffer.from(restored[input.path]), await buffer(input.blob))
  console.log(JSON.stringify({ cadFiles: inputs.length, originalBytes: pack.originalSize, storedBytes: pack.blob.size, verified: true }))
})
