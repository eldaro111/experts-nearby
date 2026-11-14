// Session isolation against the actual React panel, with held mock HTTP responses.
// No real Auth/email/backend: external HTTP/WS blocked; dev permits only local HMR.
// SESSION_DEV=1: compile only visited routes (for reproducing the old bug).
// SESSION_SKIP_BUILD=1: reuse a production build with the same fake settings.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, buildApp, checker, createBackend, launchBrowser, newContext, root, startApp } from './ui-harness.mjs'

const PORT = 3011
const out = `${root}/test-results/workspace-session`
mkdirSync(out, { recursive: true })
const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const key = 'sb-pilot-test-auth-token'
const results = [], errors = []
const check = checker(results)
const listing = (id, owner) => ({ id, title: `${owner === A ? 'Alpha' : 'Beta'} ${id}`, created_by: owner, created_at: `2026-11-01T00:00:00Z`, completed_at: null })
const seed = () => ({
  listings: [...Array.from({ length: 25 }, (_, i) => listing(`A${String(i).padStart(2, '0')}`, A)), listing('B1', B), listing('B2', B)],
  applications: [], profiles: [{ user_id: A, display_name: 'User A' }, { user_id: B, display_name: 'User B' }],
})
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const ownedA = (u) => u.pathname === '/rest/v1/listings' && u.searchParams.get('created_by') === `eq.${A}`
const session = (id) => id ? {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`,
  refresh_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id, email: 'test@example.ru' },
} : null

// Simulate another tab's SDK auth notification, using the installed SDK's channel.
// This exercises onAuthStateChange without navigating/unmounting the home page.
async function switchUser(page, id, event = id ? 'SIGNED_IN' : 'SIGNED_OUT') {
  await page.evaluate(({ key, value, event }) => {
    if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key)
    const channel = new BroadcastChannel(key)
    channel.postMessage({ event, session: value })
    channel.close()
  }, { key, value: session(id), event })
}
const settled = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function showB(page) {
  await page.locator('.workspace-current').filter({ hasText: 'Beta B1' }).waitFor()
  await page.getByRole('button', { name: 'Сменить', exact: true }).click()
  await page.getByRole('dialog').locator('.project-picker-title').filter({ hasText: 'Beta B2' }).waitFor()
}
async function assertB(page) {
  await settled(page)
  assert.match(await page.locator('.workspace-current').textContent(), /Beta B1/)
  const dialog = page.getByRole('dialog')
  assert.deepEqual(await dialog.locator('.project-picker-title').allTextContents(), ['Beta B1', 'Beta B2'])
  assert.equal(await dialog.locator('[aria-busy="true"], [role="alert"]').count(), 0)
  assert.equal(await dialog.locator('input[type="search"]').inputValue(), '')
  assert.equal(new URL(page.url()).pathname, '/')
}

let browser, server
async function fixture(rememberB = 'B1') {
  const backend = createBackend(seed(), { userId: A, strictQueries: true, rpc: { is_site_editor: false } })
  const context = await newContext(browser, backend, { signed: true, reducedMotion: 'reduce' })
  // Next dev waits for its local HMR connection before hydration. Supabase WS
  // remain blocked by the harness; production needs no WebSocket exception.
  if (process.env.SESSION_DEV === '1') await context.routeWebSocket(new RegExp(`^ws://127\\.0\\.0\\.1:${PORT}/`), (ws) => ws.connectToServer())
  await context.addInitScript(({ A, B, rememberB }) => {
    localStorage.setItem(`experts-current-project:${A}`, 'A00')
    if (rememberB) localStorage.setItem(`experts-current-project:${B}`, rememberB)
  }, { A, B, rememberB })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  // Capture a response before the switch, then choose exactly when it is delivered.
  async function hold(predicate, fail = false) {
    const entered = deferred(), release = deferred(), delivered = deferred()
    let used = false
    await context.route('https://pilot-test.supabase.co/rest/v1/**', async (route) => {
      if (used || route.request().method() !== 'GET' || !predicate(new URL(route.request().url()))) return route.fallback()
      used = true
      let response
      await backend.handle({ request: () => route.request(), fulfill: (value) => { response = value } })
      if (fail) response = { ...response, status: 400, body: JSON.stringify({ code: 'P0001', message: 'Old account request failed' }) }
      entered.resolve()
      await release.promise
      try { await route.fulfill(response) } finally { delivered.resolve() }
    })
    return {
      entered: async () => {
        let timer
        try {
          await Promise.race([entered.promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Expected held request missing: ${JSON.stringify({ log: backend.log, errors })}`)), 15000)
          })])
        } finally { clearTimeout(timer) }
      },
      release: async () => { release.resolve(); await delivered.promise; await page.waitForLoadState('networkidle'); await settled(page) },
    }
  }
  return { context, page, backend, hold }
}

async function startDev(env) {
  const process = spawn(globalThis.process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(PORT)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  writeFileSync(`${out}/dev-server.log`, '')
  process.stderr.on('data', (s) => { log += s; appendFileSync(`${out}/dev-server.log`, s) })
  const stop = async () => {
    if (process.exitCode === null) {
      if (globalThis.process.platform === 'win32') await new Promise((resolve) => spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore' }).once('exit', resolve))
      else process.kill()
    }
    writeFileSync(`${out}/dev-server.log`, log)
  }
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Dev startup timeout')), 30000)
      process.stdout.on('data', (s) => { log += s; appendFileSync(`${out}/dev-server.log`, s); if (String(s).includes('Ready')) { clearTimeout(timeout); resolve() } })
      process.once('error', (e) => { clearTimeout(timeout); reject(e) })
      process.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Dev exited: ${code}`)) })
    })
    return { base: `http://127.0.0.1:${PORT}`, stop }
  } catch (error) { await stop(); throw error }
}

try {
  const env = appEnv(PORT, { NEXT_PUBLIC_AD_SLOTS: '', NEXT_TELEMETRY_DISABLED: '1' })
  if (process.env.SESSION_DEV === '1') server = await startDev(env)
  else {
    if (process.env.SESSION_SKIP_BUILD !== '1') await buildApp(env)
    server = await startApp(PORT, env)
  }
  browser = await launchBrowser()
  await check('A overview and pending shortcut cannot overwrite B after sign-out/sign-in', async () => {
    const { context, page, hold } = await fixture()
    try {
      const gate = await hold(ownedA)
      await page.goto(server.base)
      await gate.entered()
      await page.locator('[data-workspace-shortcut="plan"]').click()
      await switchUser(page, null)
      await page.locator('.workspace-current').filter({ hasText: 'После входа' }).waitFor()
      await switchUser(page, B)
      await showB(page)
      await gate.release()
      await assertB(page)
    } finally { await context.close() }
  })
  await check('open picker and current selection are discarded on a direct A to B switch', async () => {
    const { context, page } = await fixture()
    try {
      await page.goto(server.base)
      await page.getByRole('button', { name: 'Сменить', exact: true }).click()
      await page.getByRole('dialog').locator('.project-picker-title').filter({ hasText: 'Alpha A00' }).waitFor()
      await switchUser(page, B)
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await showB(page)
      await assertB(page)
      await switchUser(page, B, 'TOKEN_REFRESHED')
      await assertB(page) // Refreshing this same account does not discard its dialog.
    } finally { await context.close() }
  })
  await check('B cannot reuse a remembered project belonging only to A', async () => {
    const { context, page, backend } = await fixture('A00')
    try {
      await page.goto(server.base)
      await page.locator('.workspace-current').filter({ hasText: 'Alpha A00' }).waitFor()
      await switchUser(page, B)
      await page.locator('.workspace-current').filter({ hasText: 'Проект не выбран' }).waitFor()
      await page.getByRole('button', { name: 'Выбрать', exact: true }).click()
      await page.getByRole('dialog').locator('.project-picker-title').filter({ hasText: 'Beta B2' }).waitFor()
      assert.deepEqual(await page.getByRole('dialog').locator('.project-picker-title').allTextContents(), ['Beta B1', 'Beta B2'])
      assert.equal(await page.evaluate((B) => localStorage.getItem(`experts-current-project:${B}`), B), null)
      assert.ok(backend.log.some((r) => r.path.endsWith('/applications') && new URLSearchParams(r.query).get('user_id') === `eq.${B}` && new URLSearchParams(r.query).get('listing_id') === 'eq.A00'))
    } finally { await context.close() }
  })
  for (const fail of [false, true]) await check(`late A search ${fail ? 'error' : 'success'} cannot change B lists, errors or loading`, async () => {
    const { context, page, hold } = await fixture()
    try {
      await page.goto(server.base)
      await page.getByRole('button', { name: 'Сменить', exact: true }).click()
      const gate = await hold((u) => ownedA(u) && u.searchParams.has('title'), fail)
      await page.getByRole('dialog').getByLabel('Поиск по названию').fill('Alpha')
      await gate.entered()
      await switchUser(page, B)
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await showB(page)
      await gate.release()
      await assertB(page)
    } finally { await context.close() }
  })
  await check('late A next page cannot append to B or clear its loading state', async () => {
    const { context, page, hold } = await fixture()
    try {
      await page.goto(server.base)
      await page.getByRole('button', { name: 'Сменить', exact: true }).click()
      const gate = await hold((u) => ownedA(u) && u.searchParams.get('offset') === '20')
      await page.getByRole('dialog').getByRole('button', { name: 'Показать ещё', exact: true }).click()
      await gate.entered()
      await switchUser(page, B)
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await showB(page)
      await gate.release()
      await assertB(page)
    } finally { await context.close() }
  })
  await check('sign-out then sign-in as A also discards the previous A session response', async () => {
    const { context, page, hold } = await fixture()
    try {
      const gate = await hold(ownedA)
      await page.goto(server.base)
      await gate.entered()
      await switchUser(page, null)
      await page.locator('.workspace-current').filter({ hasText: 'После входа' }).waitFor()
      await page.evaluate((A) => localStorage.setItem(`experts-current-project:${A}`, 'A01'), A)
      await switchUser(page, A)
      await page.locator('.workspace-current').filter({ hasText: 'Alpha A01' }).waitFor()
      await gate.release()
      assert.match(await page.locator('.workspace-current').textContent(), /Alpha A01/)
      assert.equal(await page.evaluate((A) => localStorage.getItem(`experts-current-project:${A}`), A), 'A01')
    } finally { await context.close() }
  })
  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks: results.length, results, errors }, null, 2))
} catch (error) {
  writeFileSync(`${out}/failure.json`, JSON.stringify({ results, errors, failure: error.message, stack: error.stack }, null, 2))
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  await server?.stop()
}
