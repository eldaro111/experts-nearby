// Shared browser-test harness (no real backend).
// - Builds/starts Next.js with fake public Supabase settings.
// - Answers https://pilot-test.supabase.co with an in-memory PostgREST-like mock.
// - Aborts every other non-local request and closes every WebSocket without connecting, so
//   neither real Supabase (Auth/DB/Storage/Realtime) nor any third party is contacted.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const FAKE_SUPABASE = 'https://pilot-test.supabase.co'
const next = 'node_modules/next/dist/bin/next'

export function appEnv(port, extra = {}) {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: FAKE_SUPABASE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-public-key',
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
    ...extra,
  }
}

export async function buildApp(env) {
  // Turbopack's build cache was observed to keep a stale globals.css after edits; start clean.
  rmSync(`${root}.next/cache/turbopack`, { recursive: true, force: true })
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [next, 'build'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
    build.once('error', reject)
    build.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`))))
  })
}

export async function startApp(port, env) {
  const server = spawn(process.execPath, [next, 'start', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.kill(); reject(new Error('Server startup timeout')) }, 20000)
    server.stdout.on('data', (chunk) => { if (String(chunk).includes('Ready')) { clearTimeout(timer); resolve() } })
    server.once('error', reject)
  })
  return { base: `http://127.0.0.1:${port}`, stop: () => server.kill() }
}

export function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  })
}

/** In-memory backend. `tables` is mutated by PATCH/POST/DELETE so reloads see saved data. */
export function createBackend(tables, { userId, email = 'test@example.ru', rpc = {} } = {}) {
  const backend = {
    userId,
    tables,
    log: [],
    externalBlocked: [],
    failures: [],
    delays: [],
    async handle(route) {
      const req = route.request()
      const u = new URL(req.url())
      const method = req.method()
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
      backend.log.push({ method, path: u.pathname, query: u.search, body: req.postData() })
      if (u.pathname === '/auth/v1/user') {
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ id: userId, email, app_metadata: { provider: 'email' }, user_metadata: {} }) })
      }
      if (u.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers, body: '' })
      if (u.pathname.startsWith('/auth/') || u.pathname.startsWith('/storage/')) {
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{}' })
      }
      const table = u.pathname.split('/').at(-1)
      const delay = backend.delays.find((item) => item.method === method && item.table === table)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay.ms))
      const failureIndex = backend.failures.findIndex((item) => item.method === method && item.table === table)
      if (failureIndex >= 0) {
        const [failure] = backend.failures.splice(failureIndex, 1)
        return route.fulfill({ status: failure.status || 400, headers, contentType: 'application/json', body: JSON.stringify({ message: failure.message, code: failure.code || 'P0001' }) })
      }
      if (u.pathname.includes('/rest/v1/rpc/')) {
        const handler = rpc[table]
        const data = typeof handler === 'function' ? handler(req.postDataJSON() || {}) : handler ?? null
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) })
      }
      const rows = tables[table] || (tables[table] = [])
      const matches = (row) => {
        for (const [key, raw] of u.searchParams) {
          if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
          const value = String(raw)
          if (value === 'is.null') { if (row[key] !== null && row[key] !== undefined) return false; continue }
          if (value.startsWith('eq.')) {
            const expected = value.slice(3)
            const actual = row[key]
            if (actual === null || actual === undefined) return false
            const asDate = (v) => (/^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? new Date(v).getTime() : NaN)
            if (!Number.isNaN(asDate(actual)) && !Number.isNaN(asDate(expected))) { if (asDate(actual) !== asDate(expected)) return false; continue }
            if (String(actual) !== expected) return false
            continue
          }
          if (value.startsWith('in.(')) {
            const list = value.slice(4, -1).split(',').map((item) => item.replace(/^"|"$/g, ''))
            if (!list.includes(String(row[key]))) return false
          }
        }
        return true
      }
      let data
      if (method === 'GET' || method === 'HEAD') {
        data = structuredClone(rows.filter(matches))
      } else if (method === 'PATCH') {
        const patch = req.postDataJSON() || {}
        data = []
        for (const row of rows) if (matches(row)) { Object.assign(row, patch); data.push(structuredClone(row)) }
      } else if (method === 'POST') {
        const body = req.postDataJSON()
        const items = (Array.isArray(body) ? body : [body]).map((item) => ({ id: `${table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...item }))
        rows.push(...items)
        data = structuredClone(items)
      } else if (method === 'DELETE') {
        data = rows.filter(matches)
        tables[table] = rows.filter((row) => !matches(row))
      } else data = []
      if (req.headers().accept?.includes('vnd.pgrst.object+json')) data = data[0] ?? null
      return route.fulfill({
        status: 200,
        headers: { ...headers, 'content-range': `0-${Math.max(0, (Array.isArray(data) ? data.length : 1) - 1)}/${Array.isArray(data) ? data.length : 1}` },
        contentType: 'application/json',
        body: JSON.stringify(data),
      })
    },
  }
  return backend
}

export async function newContext(browser, backend, { signed = false, width = 1440, height = 900, touch = false, reducedMotion = 'no-preference', timezoneId = 'Asia/Tomsk' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion, timezoneId, locale: 'ru-RU' })
  if (signed) {
    const claims = Buffer.from(JSON.stringify({ sub: backend.userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    await context.addInitScript(({ id, claims }) => localStorage.setItem('sb-pilot-test-auth-token', JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.test`, refresh_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600, token_type: 'bearer', user: { id, email: 'test@example.ru' },
    })), { id: backend.userId, claims })
  }
  await context.routeWebSocket(/.*/, (ws) => { backend.externalBlocked.push(`ws:${ws.url()}`); ws.close() })
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname
    if (host === '127.0.0.1') return route.continue()
    if (host === 'pilot-test.supabase.co') return backend.handle(route)
    backend.externalBlocked.push(route.request().url())
    return route.abort()
  })
  return context
}

export const noHorizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)

export function checker(results) {
  return async (name, fn) => {
    await fn()
    results.push(name)
    console.log('PASS', name)
  }
}
