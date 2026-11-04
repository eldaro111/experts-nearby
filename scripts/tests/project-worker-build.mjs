// Smoke test of the emitted browser Worker bundle in a Node VM.
// Browser globals are emulated; this does NOT replace browser UI or real Storage testing.
// Run after npm run build. Never executes remote JavaScript or connects to Supabase.
import { readFileSync, readdirSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
const root = resolve('.')
const chunks = readdirSync(join(root, '.next/static/chunks')).filter(p => p.endsWith('.js'))
const client = chunks.map(p => readFileSync(join(root, '.next/static/chunks', p), 'utf8')).find(s => s.includes('Обработка отменена.'))
const config = client.match(/default\("(static\/chunks\/turbopack-worker-[^"]+)",(\[[^\]]+\])\)/)
assert.ok(config)
const scriptUrls = JSON.parse(config[2]).map(p => '/_next/' + p)
class WorkerGlobalScope {}
// vm contextifies the global object and does not retain its original prototype.
Object.defineProperty(WorkerGlobalScope, Symbol.hasInstance, { value: value => typeof value?.importScripts === 'function' })
const scope = new WorkerGlobalScope()
const url = new URL('https://worker.test/_next/' + config[1])
url.hash = 'params=' + encodeURIComponent(JSON.stringify([scriptUrls, '', '/_next/', '', '']))
Object.assign(scope, { WorkerGlobalScope, location: url, URL, console, Blob, ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, DataView, TextEncoder, TextDecoder, WebAssembly, Response, atob, btoa, setTimeout, clearTimeout })
scope.self = scope
let wasmLoads = 0
scope.fetch = async u => {
  const path = new URL(u, url.origin).pathname
  assert.equal(path, '/vendor/zstd-0.0.27.wasm')
  wasmLoads++
  return new Response(readFileSync(join(root, 'public', path)), { headers: { 'Content-Type': 'application/wasm' } })
}
const context = createContext(scope)
scope.importScripts = (...urls) => {
  for (const u of urls) {
    const path = new URL(u).pathname.replace('/_next/', '')
    runInContext(readFileSync(join(root, '.next', path), 'utf8'), context, {filename: path})
  }
}
runInContext(readFileSync(join(root, '.next', config[1]), 'utf8'), context)
await new Promise(r => setTimeout(r, 50))
assert.equal(typeof scope.onmessage, 'function')
const request = data => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Built worker timeout')), 10000)
  scope.postMessage = m => {
    if (m.type === 'progress') return
    clearTimeout(timeout)
    if (m.type === 'error') reject(new Error(m.message)); else resolve(m.value)
  }
  Promise.resolve(scope.onmessage({data})).catch(reject)
})
const original = 'Чертёж\nPOINT 1 2 3\n'.repeat(10000)
const packed = await request({ action: 'pack', kind: 'folder', inputs: [{path: 'Сборка/чертёж.dxf', blob: new Blob([original])}] })
assert.equal(packed.storageFormat, 'nearby-pack-v1')
const restored = await request({action:'restore',blob:packed.blob,expected:{sha256:packed.sha256,originalSize:packed.originalSize,fileCount:packed.fileCount,kind:packed.kind}})
const files = unzipSync(new Uint8Array(await restored.arrayBuffer()))
assert.equal(new TextDecoder().decode(files['Сборка/чертёж.dxf']), original)
assert.equal(wasmLoads, 1)
console.log('PASS: production browser Worker bundle + same-origin WASM + Cyrillic folder round trip in Node VM (not a browser UI test).')
