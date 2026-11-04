import { createPack, initializeCodec, restorePack, type RestoreExpectation } from './pack'
import type { PackInput, PackKind, Progress } from './format'

type Request = { action: 'pack'; inputs: PackInput[]; kind: PackKind } |
  { action: 'restore'; blob: Blob; expected: RestoreExpectation }

self.onmessage = async (event: MessageEvent<Request>) => {
  let lastProgress = 0
  const progress = (value: Progress) => {
    if (Date.now() - lastProgress < 100 && value.done !== value.total) return
    lastProgress = Date.now()
    self.postMessage({ type: 'progress', value })
  }
  try {
    await initializeCodec('/vendor/zstd-0.0.27.wasm')
    const request = event.data
    const result = request.action === 'pack'
      ? await createPack(request.inputs, request.kind, progress)
      : await restorePack(request.blob, request.expected, progress)
    self.postMessage({ type: 'result', value: result })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Не удалось обработать файл.' })
  }
}
