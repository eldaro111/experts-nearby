// Browser checks of the project chat on the MOCK API (scripts/tests/ui-harness.mjs, strict mode).
// Not real Supabase: PostgREST, RLS, Auth and Realtime are not involved. The insert contract with
// a client-chosen id is checked against the real schema in PGlite (project-chat-db.mjs).
// Usage: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium/edge> node scripts/tests/chat-ui.mjs
// CHAT_SKIP_BUILD=1 reuses an existing build made with the same fake settings; CHAT_SKIP_VIDEO=1 skips the video.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, buildApp, checker, createBackend, launchBrowser, newContext, noHorizontalOverflow, root, startApp } from './ui-harness.mjs'

const PORT = 3008
const out = `${root}/test-results/chat`
mkdirSync(out, { recursive: true })
const results = []
const errors = []
const check = checker(results)
const USER = '00000000-0000-4000-8000-0000000000e1'
const MEMBER = '00000000-0000-4000-8000-0000000000e2'
const OTHER = '00000000-0000-4000-8000-0000000000e3'
const KEY = 'sb-pilot-test-auth-token'
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const LONG_URL = 'https://example.org/очень/длинная/ссылка/без/пробелов/' + 'a'.repeat(160)

const message = (id, project, author, body, at, extra = {}) => ({ id, project_id: project, author_id: author, body, created_at: at, parent_message_id: null, edited_at: null, is_deleted_for_all: false, ...extra })
function seed() {
  const messages = Array.from({ length: 60 }, (_, i) => message(`M${String(i + 1).padStart(2, '0')}`, 'P1', i % 2 ? MEMBER : USER, `Сообщение ${i + 1}`, minutesAgo(120 - i)))
  messages[57].body = `Длинное сообщение со ссылкой ${LONG_URL} и продолжением текста, которое должно переноситься внутри пузыря.`
  messages[58].parent_message_id = 'M57'
  messages.push(message('Q1', 'P3', USER, 'Сообщение второго проекта', minutesAgo(30)))
  const listing = (id, title, extra = {}) => ({ id, title, description: 'Описание', roles_needed: [], skills: [], timezone: 'Asia/Tomsk', created_by: USER, created_at: minutesAgo(10_000), deadline_at: null, completed_at: null, project_kind: 'engineering', ...extra })
  return {
    listings: [listing('P1', 'Робот-манипулятор'), listing('P3', 'Датчик давления', { deadline_at: new Date(Date.now() + 5 * 86_400_000).toISOString() })],
    applications: [{ id: 'A1', listing_id: 'P1', user_id: MEMBER, status: 'accepted', created_at: minutesAgo(9000) }],
    profiles: [{ user_id: USER }],
    profiles_collaboration: [{ user_id: USER, display_name: 'Иван Иванов' }, { user_id: MEMBER, display_name: 'Анна Петрова' }],
    profiles_public: [], tasks: [], project_events: [], project_activity: [], notifications: [], project_files: [], project_documents: [], contributions: [], project_reviews: [],
    project_messages: messages, project_message_hidden: [],
  }
}
const rpc = { is_site_editor: false, project_file_storage_version: 1, refresh_my_recommendations: { refreshed: true, sent: 0 } }

async function open(browser, backend, options = {}) {
  const context = await newContext(browser, backend, { signed: true, ...options })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${options.width || 1440}: ${e.message}`))
  return { context, page }
}
const session = (id) => id ? {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`,
  refresh_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id, email: 'test@example.ru' },
} : null
const switchUser = (page, id) => page.evaluate(({ key, value }) => {
  if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key)
  const channel = new BroadcastChannel(key)
  channel.postMessage({ event: value ? 'SIGNED_IN' : 'SIGNED_OUT', session: value })
  channel.close()
}, { key: KEY, value: session(id) })
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))))
const shot = async (page, name, locator) => { await settle(page); await (locator ?? page).screenshot({ path: `${out}/${name}.png` }) }
/** The chat reads again when the window regains focus (no Realtime for project_messages). */
const refocus = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))
const posts = (backend) => backend.log.filter((e) => e.method === 'POST' && e.path.endsWith('/project_messages'))

async function openChat(page, base, project = 'P1') {
  await page.goto(`${base}/projects/${project}`)
  await page.getByRole('button', { name: 'Чат команды' }).click()
  const panel = page.getByRole('region', { name: 'Чат проекта' })
  const log = panel.getByRole('log', { name: 'Сообщения чата' })
  return { panel, log }
}
const scrollState = (log) => log.evaluate((el) => ({ top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight, width: el.scrollWidth - el.clientWidth }))
const pushFromMember = (tables, id, body, project = 'P1') => tables.project_messages.push(message(id, project, MEMBER, body, new Date().toISOString()))
/** Waits until the log is scrolled to the bottom (smooth scrolling is not an animation object). */
const reachesBottom = (log) => log.evaluate((el) => new Promise((resolve) => {
  const started = Date.now()
  const step = () => (el.scrollHeight - el.scrollTop - el.clientHeight <= 72 || Date.now() - started > 2500 ? resolve() : requestAnimationFrame(step))
  step()
}))
const until = async (fn, what) => {
  for (let i = 0; i < 150; i += 1) { const value = fn(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)) }
  throw new Error(`timeout: ${what}`)
}

async function recordVideo(browser, page, file, action) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => null)
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 })
  await page.waitForTimeout(400)
  await action()
  await page.waitForTimeout(900)
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  assert.ok(frames.length >= 10, `only ${frames.length} frames captured`)
  const encoder = await browser.newPage()
  try {
    const base64 = await encoder.evaluate(async (list) => {
      const images = await Promise.all(list.map((frame) => new Promise((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `data:image/jpeg;base64,${frame.data}`
      })))
      const canvas = document.createElement('canvas')
      canvas.width = images[0].naturalWidth; canvas.height = images[0].naturalHeight
      document.body.appendChild(canvas)
      const context = canvas.getContext('2d')
      context.drawImage(images[0], 0, 0)
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 2_500_000 })
      const chunks = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      const stopped = new Promise((resolve) => { recorder.onstop = resolve })
      recorder.start(250)
      const started = performance.now()
      for (let i = 0; i < images.length; i += 1) {
        const wait = (list[i].t - list[0].t) * 1000 - (performance.now() - started)
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        context.drawImage(images[i], 0, 0)
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
      recorder.stop()
      await stopped
      const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(binary)
    }, frames)
    const buffer = Buffer.from(base64, 'base64')
    assert.equal(buffer.subarray(0, 4).toString('hex'), '1a45dfa3', 'WebM signature')
    writeFileSync(file, buffer)
    return { frames: frames.length, bytes: buffer.length, seconds: Math.round((frames.at(-1).t - frames[0].t) * 10) / 10 }
  } finally {
    await encoder.close()
  }
}

let server
let browser
const videos = {}
try {
  browser = await launchBrowser()
  const env = appEnv(PORT)
  if (process.env.CHAT_SKIP_BUILD !== '1') await buildApp(env)
  server = await startApp(PORT, env)
  const base = server.base

  const tables = seed()
  const backend = createBackend(tables, { userId: USER, rpc, strictQueries: true })
  const main = await open(browser, backend)
  const { page } = main
  let chat

  await check('open: the latest 50 at the bottom, history without entrance animation; reopening does not replay it', async () => {
    chat = await openChat(page, base)
    await chat.log.getByText('Сообщение 60', { exact: true }).waitFor()
    assert.equal(await chat.log.locator('[data-message-id]').count(), 50)
    assert.ok((await scrollState(chat.log)).gap <= 72, 'opened at the bottom')
    assert.equal(await chat.log.locator('[data-fresh]').count(), 0, 'loaded history does not animate')
    await chat.panel.getByRole('button', { name: 'Закрыть чат' }).click()
    chat = await openChat(page, base)
    await chat.log.getByText('Сообщение 60', { exact: true }).waitFor()
    assert.equal(await chat.log.locator('[data-fresh]').count(), 0, 'reopening does not replay')
    await shot(page, 'chat-open-1440', chat.panel)
  })

  await check('long messages and links wrap inside the bubble; no horizontal scroll', async () => {
    const long = chat.log.locator('[data-message-id="M58"]')
    await long.scrollIntoViewIfNeeded()
    assert.equal((await scrollState(chat.log)).width <= 0, true, 'no horizontal overflow in the log')
    const bubble = await long.locator('div').first().boundingBox()
    const log = await chat.log.boundingBox()
    assert.ok(bubble.x + bubble.width <= log.x + log.width + 1, 'bubble stays inside')
    await chat.log.evaluate((el) => { el.scrollTop = el.scrollHeight })
  })

  await check('reading at the bottom: a new message of another member stays in view and animates once', async () => {
    pushFromMember(tables, 'N1', 'Новое сообщение от Анны')
    await refocus(page)
    const added = chat.log.locator('[data-message-id="N1"]')
    await added.waitFor()
    assert.equal(await added.getAttribute('data-fresh'), 'true')
    await settle(page)
    await reachesBottom(chat.log)
    assert.ok((await scrollState(chat.log)).gap <= 72, 'still at the bottom')
    assert.equal(await chat.panel.getByRole('button', { name: /Новые сообщения/ }).count(), 0)
  })

  await check('reading older messages: no forced scroll; «Новые сообщения» leads to the first new one', async () => {
    await chat.log.evaluate((el) => { el.scrollTop = 0 })
    await page.waitForTimeout(100)
    pushFromMember(tables, 'N2', 'Второе новое сообщение')
    pushFromMember(tables, 'N3', 'Третье новое сообщение')
    await refocus(page)
    const button = chat.panel.getByRole('button', { name: 'Новые сообщения (2)' })
    await button.waitFor()
    assert.ok((await scrollState(chat.log)).top < 5, 'the reading position is kept')
    await shot(page, 'chat-new-messages-1440', chat.panel)
    await button.click()
    // Smooth scrolling over the whole log takes a moment; wait until the first new message is in view.
    const inView = await chat.log.evaluate((el) => new Promise((resolve) => {
      const target = el.querySelector('[data-message-id="N2"]')
      const started = Date.now()
      const step = () => {
        const box = target.getBoundingClientRect()
        const view = el.getBoundingClientRect()
        const visible = box.top >= view.top - 2 && box.top < view.bottom
        if (visible || Date.now() - started > 3000) resolve(visible); else requestAnimationFrame(step)
      }
      step()
    }))
    assert.ok(inView, 'first new message in view')
    assert.equal(await button.count(), 0)
  })

  await check('older history keeps the message being read in place', async () => {
    // The previous check started a smooth scroll; measure only once the log stands still at the top.
    await chat.log.evaluate((el) => new Promise((resolve) => {
      let last = -1
      let still = 0
      const step = () => {
        el.scrollTop = 0
        still = el.scrollTop === last ? still + 1 : 0
        last = el.scrollTop
        if (still >= 5) resolve(); else requestAnimationFrame(step)
      }
      step()
    }))
    const readFirst = chat.log.locator('[data-message-id="M11"]')
    const before = await readFirst.evaluate((el) => el.getBoundingClientRect().top)
    await chat.log.getByRole('button', { name: 'Показать предыдущие сообщения' }).click()
    await chat.log.locator('[data-message-id="M01"]').waitFor({ state: 'attached' })
    await page.waitForTimeout(50)
    const after = await readFirst.evaluate((el) => el.getBoundingClientRect().top)
    assert.ok(Math.abs(after - before) <= 2, `read message moved by ${after - before}px`)
    assert.equal(await chat.log.locator('[data-message-id^="M"]').count(), 60, 'all 60 old messages now, no duplicates')
    assert.equal(await chat.log.getByRole('button', { name: 'Показать предыдущие сообщения' }).count(), 0)
    assert.equal(await chat.log.locator('[data-message-id="M01"][data-fresh]').count(), 0, 'history does not animate')
  })

  await check('send: Shift+Enter is a new line; «Отправляется…» until confirmed; repeated Enter sends once', async () => {
    const input = chat.panel.getByRole('textbox', { name: 'Сообщение команде' })
    await input.click()
    await input.type('Первая строка')
    await page.keyboard.press('Shift+Enter')
    await input.type('вторая строка')
    assert.equal(await input.inputValue(), 'Первая строка\nвторая строка')
    const before = posts(backend).length
    backend.delays.push({ method: 'POST', table: 'project_messages', ms: 900 })
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const pending = chat.log.locator('[data-status="sending"]')
    await pending.getByText('Отправляется…').waitFor()
    await shot(page, 'chat-sending-1440', chat.panel)
    await pending.waitFor({ state: 'detached' })
    backend.delays.length = 0
    assert.equal(posts(backend).length - before, 1, 'one request')
    const saved = tables.project_messages.filter((m) => m.body === 'Первая строка\nвторая строка')
    assert.equal(saved.length, 1, 'one row')
    const shown = chat.log.locator(`[data-message-id="${saved[0].id}"]`)
    assert.equal(await shown.getAttribute('data-status'), null, 'confirmed by the server')
    assert.equal(await chat.log.getByText('Первая строка').count(), 1, 'no duplicate on screen')
    assert.equal(await input.inputValue(), '')
    await reachesBottom(chat.log)
    assert.ok((await scrollState(chat.log)).gap <= 72, 'own message brought into view')
    await refocus(page)
    await page.waitForTimeout(300)
    assert.equal(await chat.log.getByText('Первая строка').count(), 1, 'a later read adds no duplicate')
  })

  await check('IME: Enter that confirms a composition does not send', async () => {
    const input = chat.panel.getByRole('textbox', { name: 'Сообщение команде' })
    await input.fill('にほんご')
    const before = posts(backend).length
    await input.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    })
    await page.waitForTimeout(200)
    assert.equal(posts(backend).length, before, 'nothing sent during composition')
    assert.equal(await input.inputValue(), 'にほんご')
    await input.fill('')
  })

  await check('server refusal: the text is kept, nothing is marked sent; editing it back is explicit', async () => {
    const input = chat.panel.getByRole('textbox', { name: 'Сообщение команде' })
    backend.failures.push({ method: 'POST', table: 'project_messages', status: 400, code: 'P0001', message: 'Автор сообщения должен быть участником этого проекта.' })
    await input.fill('Сообщение, которое сервер отклонит')
    await page.keyboard.press('Enter')
    const failed = chat.log.locator('[data-status="failed"]')
    await failed.getByText('Не отправлено. Сервер не принял сообщение: Автор сообщения должен быть участником этого проекта.').waitFor()
    assert.ok(await failed.getByText('Сообщение, которое сервер отклонит').isVisible(), 'text kept')
    await reachesBottom(chat.log)
    assert.ok((await scrollState(chat.log)).gap <= 72, 'the failed bubble with its actions stays in view')
    await shot(page, 'chat-failed-1440', chat.panel)
    await failed.getByRole('button', { name: 'Изменить текст' }).click()
    assert.equal(await input.inputValue(), 'Сообщение, которое сервер отклонит')
    assert.equal(await failed.count(), 0)
    await input.fill('')
  })

  await check('lost answer: the saved message is found by its id; a repeat after a failed check makes no duplicate', async () => {
    const input = chat.panel.getByRole('textbox', { name: 'Сообщение команде' })
    // 1. Saved, answer lost: the chat checks by id and shows it as sent.
    let lostOnce = false
    await page.route('https://pilot-test.supabase.co/rest/v1/project_messages*', async (route) => {
      if (route.request().method() !== 'POST' || lostOnce) return route.fallback()
      lostOnce = true
      tables.project_messages.push({ ...route.request().postDataJSON(), created_at: new Date().toISOString(), edited_at: null, is_deleted_for_all: false })
      return route.abort('failed')
    })
    await input.fill('Ответ потерялся, сообщение сохранено')
    await page.keyboard.press('Enter')
    const lost = await until(() => tables.project_messages.find((m) => m.body === 'Ответ потерялся, сообщение сохранено'), 'saved row')
    await page.waitForFunction((id) => { const el = document.querySelector(`[data-message-id="${id}"]`); return el && !el.hasAttribute('data-status') }, lost.id, { timeout: 15000 })
    assert.equal(tables.project_messages.filter((m) => m.body === 'Ответ потерялся, сообщение сохранено').length, 1)
    await page.unroute('https://pilot-test.supabase.co/rest/v1/project_messages*')
    // 2. Saved, answer lost and the check fails too: «Повторить» resends the same id → 23505 → found.
    let posted = 0
    await page.route('https://pilot-test.supabase.co/rest/v1/project_messages*', async (route) => {
      const req = route.request()
      if (req.method() === 'POST' && posted === 0) {
        posted += 1
        tables.project_messages.push({ ...req.postDataJSON(), created_at: new Date().toISOString(), edited_at: null, is_deleted_for_all: false })
        return route.abort('failed')
      }
      if (req.method() === 'GET' && new URL(req.url()).searchParams.get('id') && posted === 1) { posted += 1; return route.abort('failed') }
      return route.fallback()
    })
    await input.fill('Повтор без дубля')
    await page.keyboard.press('Enter')
    const failed = chat.log.locator('[data-status="failed"]')
    await failed.getByText(/Повторите отправку — дубль не появится/).waitFor()
    await failed.getByRole('button', { name: 'Повторить отправку' }).click()
    await failed.waitFor({ state: 'detached' })
    await page.unroute('https://pilot-test.supabase.co/rest/v1/project_messages*')
    assert.equal(tables.project_messages.filter((m) => m.body === 'Повтор без дубля').length, 1, 'one row on the server')
    assert.equal(await chat.log.getByText('Повтор без дубля').count(), 1, 'one bubble')
  })

  await check('keyboard: actions reachable without hover; Escape cancels a reply before closing the panel', async () => {
    const target = chat.log.locator('[data-message-id="N1"]')
    const reply = target.getByRole('button', { name: 'Ответить' })
    assert.ok(await reply.isVisible(), 'visible without hover')
    await reply.focus()
    await page.keyboard.press('Enter')
    const input = chat.panel.getByRole('textbox', { name: 'Сообщение команде' })
    await chat.panel.getByText('Ответ на сообщение').waitFor()
    assert.equal(await input.evaluate((el) => el === document.activeElement), true, 'focus moves to the field')
    await page.keyboard.press('Escape')
    assert.equal(await chat.panel.getByText('Ответ на сообщение').count(), 0, 'reply cancelled')
    assert.ok(await chat.panel.isVisible(), 'panel still open')
    // Editing an own message: Ctrl+Enter saves.
    const own = chat.log.locator('[data-message-id="M59"]')
    await own.getByRole('button', { name: 'Редактировать' }).click()
    const editor = own.getByRole('textbox', { name: 'Текст сообщения' })
    await editor.fill('Сообщение 59 — исправлено')
    await page.keyboard.press('Control+Enter')
    await own.getByText('Сообщение 59 — исправлено').waitFor()
    await own.getByText('· изменено').waitFor()
    await page.keyboard.press('Escape')
    await chat.panel.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Чат команды', 'focus returns to the chat button')
  })

  await check('reduced motion: new messages arrive without animations', async () => {
    const reduced = await open(browser, backend, { reducedMotion: 'reduce' })
    const c = await openChat(reduced.page, base)
    await c.log.getByText('Новое сообщение от Анны').waitFor()
    pushFromMember(tables, 'N4', 'Сообщение при reduced motion')
    await refocus(reduced.page)
    await c.log.locator('[data-message-id="N4"]').waitFor()
    assert.equal(await reduced.page.evaluate(() => document.getAnimations().length), 0)
    await reduced.context.close()
  })

  await check('mobile 360: panel fits, actions are tappable (≥ 44 px) and visible without hover', async () => {
    const mobile = await open(browser, backend, { width: 360, height: 740, touch: true })
    const c = await openChat(mobile.page, base)
    await c.log.getByText('Сообщение при reduced motion').waitFor()
    assert.ok(await noHorizontalOverflow(mobile.page))
    const action = c.log.locator('[data-message-id="N4"]').getByRole('button', { name: 'Ответить' })
    const box = await action.boundingBox()
    assert.ok(box.height >= 43, `tap target ${box.height}px`)
    const panel = await c.panel.boundingBox()
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 361, 'panel inside the screen')
    await shot(mobile.page, 'chat-360', c.panel)
    await mobile.context.close()
  })

  await check('account change while the chat loads: the late answer is dropped and nothing of the old session shows', async () => {
    const ctx = await open(browser, backend)
    await ctx.page.goto(`${base}/projects/P1`)
    backend.delays.push({ method: 'GET', table: 'project_messages', ms: 2500 })
    await ctx.page.getByRole('button', { name: 'Чат команды' }).click()
    const panel = ctx.page.getByRole('region', { name: 'Чат проекта' })
    await panel.getByText('Загружаем сообщения…').waitFor()
    await switchUser(ctx.page, OTHER)
    await panel.getByText(/Аккаунт изменился/).waitFor()
    await ctx.page.waitForTimeout(3000)
    backend.delays.length = 0
    assert.equal(await panel.locator('[data-message-id]').count(), 0, 'no messages of the previous session')
    assert.equal(await panel.getByRole('textbox', { name: 'Сообщение команде' }).isDisabled(), true)
    await shot(ctx.page, 'chat-session-changed-1440', panel)
    await ctx.context.close()
  })

  await check('project change: a late answer of the previous project never shows in the next one', async () => {
    const ctx = await open(browser, backend)
    let held = 0
    await ctx.page.route('https://pilot-test.supabase.co/rest/v1/project_messages*', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() === 'GET' && url.searchParams.get('project_id') === 'eq.P1' && held === 0) {
        held += 1
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
      return route.fallback()
    })
    await ctx.page.goto(`${base}/projects/P1`)
    await ctx.page.getByRole('button', { name: 'Чат команды' }).click()
    await ctx.page.getByRole('region', { name: 'Чат проекта' }).getByText('Загружаем сообщения…').waitFor()
    await ctx.page.getByRole('navigation', { name: 'Рабочие разделы' }).getByRole('link', { name: 'Рабочий центр' }).click()
    await ctx.page.waitForURL((u) => u.pathname === '/dashboard')
    await ctx.page.locator('a[href="/projects/P3"]').first().click()
    await ctx.page.waitForURL((u) => u.pathname === '/projects/P3')
    await ctx.page.getByRole('button', { name: 'Чат команды' }).click()
    const panel = ctx.page.getByRole('region', { name: 'Чат проекта' })
    await panel.getByText('Сообщение второго проекта').waitFor()
    await ctx.page.waitForTimeout(3200)
    assert.equal(held, 1, 'the P1 answer was held and delivered late')
    assert.deepEqual(await panel.locator('[data-message-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-message-id'))), ['Q1'])
    await ctx.context.close()
  })

  if (process.env.CHAT_SKIP_VIDEO !== '1') {
    await check('video: arrival at the bottom, «Новые сообщения» while reading, sending', async () => {
      const ctx = await open(browser, backend, { width: 1280, height: 800 })
      const c = await openChat(ctx.page, base)
      await c.log.getByText('Сообщение при reduced motion').waitFor()
      videos.chat = await recordVideo(browser, ctx.page, `${out}/chat-motion.webm`, async () => {
        pushFromMember(tables, 'V1', 'Анна: прислала расчёт привода')
        await refocus(ctx.page)
        await c.log.locator('[data-message-id="V1"]').waitFor()
        await ctx.page.waitForTimeout(700)
        await c.log.evaluate((el) => el.scrollBy({ top: -500, behavior: 'smooth' }))
        await ctx.page.waitForTimeout(700)
        pushFromMember(tables, 'V2', 'Анна: посмотри, пожалуйста, допуски')
        await refocus(ctx.page)
        await c.panel.getByRole('button', { name: /Новые сообщения/ }).waitFor()
        await ctx.page.waitForTimeout(900)
        await c.panel.getByRole('button', { name: /Новые сообщения/ }).click()
        await ctx.page.waitForTimeout(800)
        backend.delays.push({ method: 'POST', table: 'project_messages', ms: 700 })
        const input = c.panel.getByRole('textbox', { name: 'Сообщение команде' })
        await input.click()
        await input.type('Спасибо, посмотрю сегодня', { delay: 25 })
        await ctx.page.keyboard.press('Enter')
        await c.log.locator('[data-status="sending"]').waitFor({ state: 'detached' })
        backend.delays.length = 0
        await ctx.page.waitForTimeout(600)
      })
      assert.ok(videos.chat.bytes > 20_000, `video too small: ${videos.chat.bytes}`)
      await ctx.context.close()
    })
  }

  await main.context.close()
  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks: results.length, results, errors, videos }, null, 2))
  console.log('PASS', results.length, 'chat checks (mock API)', JSON.stringify(videos))
} catch (error) {
  console.error('FAIL', error.message)
  writeFileSync(`${out}/errors.json`, JSON.stringify({ errors, passed: results, failure: error.message, stack: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.stop()
}
