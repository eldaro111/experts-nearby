import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(dirname(require.resolve('@bokuweb/zstd-wasm')), 'zstd.wasm')
mkdirSync(resolve(root, 'public/vendor'), { recursive: true })
copyFileSync(source, resolve(root, 'public/vendor/zstd-0.0.27.wasm'))
