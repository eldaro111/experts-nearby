// Browser checks for package A: home panel shortcuts, task board drag copy, continuous Gantt drag
// and click, calendar day panel, shared task view. Also records short WebM videos of the card and
// bar movement (CDP screencast frames encoded by MediaRecorder in the same browser; no ffmpeg).
// Mock backend only (scripts/tests/ui-harness.mjs): no real Supabase, no external hosts, no WebSockets.
// Usage: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium/edge> node scripts/tests/motion-ui.mjs
// Iteration only: MOTION_SKIP_BUILD=1 reuses the current default build; MOTION_SKIP_VIDEO=1 skips videos.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, buildApp, checker, createBackend, launchBrowser, newContext, noHorizontalOverflow, root, startApp } from './ui-harness.mjs'
import { createPlanningMock } from './planning-mock.mjs'

const PORT = 3005
const out = `${root}/test-results/motion`
mkdirSync(out, { recursive: true })
const results = []
const errors = []
const runCheck = checker(results)
const only = process.env.MOTION_ONLY ? new RegExp(process.env.MOTION_ONLY) : null
const check = (name, fn) => !only || only.test(name) ? runCheck(name,fn) : Promise.resolve()
const USER = '00000000-0000-4000-8000-0000000000b1'
const MEMBER = '00000000-0000-4000-8000-0000000000b2'
const OTHER = '00000000-0000-4000-8000-0000000000b3'

// Fixed local zone of the browser context is Asia/Tomsk (UTC+7, no DST).
const tomskDate = (offsetDays) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tomsk', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const date = new Date(`${today}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}
const at = (offsetDays, time) => new Date(`${tomskDate(offsetDays)}T${time}:00+07:00`).toISOString()

function task(id, title, status, start, due, extra = {}) {
  return { id, project_id: 'P1', title, description: null, status, assignee_id: USER, created_at: at(-5, '10:00'), start_at: start, due_at: due, completed_at: null, penalty_percent: 10, excuse_reason: null, excuse_status: 'none', excuse_decided_by: null, excuse_decided_at: null, ...extra }
}
const listing = (id, title, createdBy, extra = {}) => ({ id, title, description: 'Описание проекта', roles_needed: ['Инженер'], skills: ['CAD'], timezone: 'Asia/Tomsk', created_by: createdBy, created_at: at(-10, '10:00'), deadline_at: null, completed_at: null, project_kind: 'engineering', ...extra })

/** projects: 'one' — only P1; 'many' — P1, completed P2 and membership in P3; 'none' — nothing. */
function seed(projects = 'one') {
  const listings = projects === 'none' ? [] : [
    listing('P1', 'Робот-манипулятор', USER, { deadline_at: at(12, '18:00') }),
    ...(projects === 'many' ? [
      listing('P2', 'Завершённый стенд', USER, { created_at: at(-30, '10:00'), completed_at: at(-1, '10:00') }),
      listing('P3', 'Датчик давления', OTHER, { created_at: at(-8, '10:00') }),
    ] : []),
  ]
  return {
    listings,
    applications: [
      { id: 'A1', listing_id: 'P1', user_id: MEMBER, status: 'accepted', created_at: at(-9, '10:00') },
      ...(projects === 'many' ? [{ id: 'A3', listing_id: 'P3', user_id: USER, status: 'accepted', created_at: at(-7, '10:00') }] : []),
    ],
    profiles: [{ user_id: USER }],
    profiles_collaboration: [{ user_id: USER, display_name: 'Иван Иванов' }, { user_id: MEMBER, display_name: 'Анна Петрова' }, { user_id: OTHER, display_name: 'Олег Сидоров' }],
    profiles_public: [],
    tasks: projects === 'none' ? [] : [
      task('B1', 'Собрать требования', 'todo', at(1, '09:00'), at(2, '18:00'), { description: 'Список требований заказчика.' }),
      task('B2', 'Сделать эскиз', 'doing', null, null, { assignee_id: MEMBER }),
      task('B3', 'Согласовать бюджет', 'done', null, null, { completed_at: at(-1, '12:00') }),
      task('G1', 'Расчёт привода', 'doing', at(1, '09:30'), at(3, '18:00')),
      { ...task('P2T', 'Архивная задача', 'done', at(1, '09:00'), at(3, '18:00')), project_id: 'P2' },
    ],
    project_events: projects === 'none' ? [] : [
      { id: 'E1', project_id: 'P1', created_by: MEMBER, title: 'Созвон с заказчиком', description: null, event_type: 'call', starts_at: at(1, '11:00'), ends_at: at(1, '12:00'), created_at: at(-3, '10:00') },
      // Same title as a task on the same day: it must stay a separate record.
      { id: 'E2', project_id: 'P1', created_by: USER, title: 'Расчёт привода', description: null, event_type: 'review', starts_at: at(3, '10:00'), ends_at: null, created_at: at(-3, '10:00') },
    ],
    project_activity: [],
    notifications: [],
    project_files: [],
    project_documents: [],
    contributions: [],
    project_reviews: [],
  }
}

function freshBackend(projects = 'one', userId = USER) {
  return createBackend(seed(projects), { userId, rpc: { is_site_editor: false, project_file_storage_version: 1, refresh_my_recommendations: { refreshed: true, sent: 0 } } })
}

async function openPage(browser, backend, options = {}) {
  const context = await newContext(browser, backend, options)
  // Optional integration: valid planning responses in simple mode instead of null RPC stubs.
  if (process.env.MOTION_PLANNING === '1') {
    for (const task of backend.tables.tasks) Object.assign(task,{stage_id:task.stage_id??null,story_points:task.story_points??null,planned_hours:task.planned_hours??null,planning_version:task.planning_version??1})
    await createPlanningMock(backend.tables).install(context)
  }
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${options.width || 1440}: ${e.message}`))
  return { context, page }
}

/** Waits for finite animations and transitions so measurements see the settled state. */
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
  .map((animation) => animation.finished.catch(() => null))))
const centerOf = async (locator) => {
  if(process.env.MOTION_PLANNING === '1' && new URL(locator.page().url()).pathname.startsWith('/projects/')) await locator.page().locator('#planning .planning-mode-badge').waitFor()
  // A card may still be gliding back after a cancel or a refusal; grab it where it ends up.
  await settle(locator.page())
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
  const b = await locator.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const rectOf = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
/** Chromium coalesces pointer moves until the next frame; measurements wait for two frames. */
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function moveSlowly(page, from, to, steps = 10, pause = 0) {
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
    if (pause) await page.waitForTimeout(pause)
  }
  await frames(page)
}
/** Point inside a board column at the pointer height, kept within the column (columns differ in height). */
const inside = (box, y) => ({ x: box.x + box.width / 2, y: Math.min(Math.max(y, box.y + 20), box.y + box.height - 20) })
const patches = (backend, table, id) => backend.log.filter((e) => e.method === 'PATCH' && e.path.endsWith(`/${table}`) && e.query.includes(`id=eq.${id}`))
const scheduleCalls = (backend, id) => backend.log.filter((e) => e.method === 'POST' && e.path.endsWith('/rpc/reschedule_task_secure') && (e.body || '').includes(id))
const row = (backend, id) => backend.tables.tasks.find((t) => t.id === id)

/** Shows the month of `iso` in the calendar of the current page (project or global calendar). */
async function showMonthOf(page, iso) {
  const offset = await page.evaluate((value) => {
    const date = new Date(value)
    const now = new Date()
    return (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth()
  }, iso)
  for (let i = 0; i < Math.abs(offset); i += 1) {
    await page.getByRole('button', { name: offset > 0 ? 'Следующий месяц' : 'Предыдущий месяц', exact: true }).click()
  }
}
const dayWith = (page, text) => page.locator('.calendar-grid .calendar-day', { has: page.locator('.space-y-1 > *', { hasText: text }) }).first()

/**
 * Records `action` as WebM: CDP screencast JPEG frames are replayed with their timestamps on a canvas
 * and encoded by MediaRecorder in a separate blank page of the same browser.
 */
async function recordVideo(browser, page, file, action) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => null)
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 78, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 })
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
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = reject
        image.src = `data:image/jpeg;base64,${frame.data}`
      })))
      const canvas = document.createElement('canvas')
      canvas.width = images[0].naturalWidth
      canvas.height = images[0].naturalHeight
      document.body.appendChild(canvas)
      const context = canvas.getContext('2d')
      context.drawImage(images[0], 0, 0)
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 3_000_000 })
      const chunks = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      const stopped = new Promise((resolve) => { recorder.onstop = resolve })
      recorder.start(250)
      const started = performance.now()
      for (let i = 0; i < images.length; i += 1) {
        const due = (list[i].t - list[0].t) * 1000
        const wait = due - (performance.now() - started)
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
    // WebM (EBML) signature.
    assert.equal(buffer.subarray(0, 4).toString('hex'), '1a45dfa3')
    assert.ok(buffer.length > 20_000, `video too small: ${buffer.length} bytes`)
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
  if (process.env.MOTION_SKIP_BUILD !== '1') await buildApp(env)
  server = await startApp(PORT, env)
  const base = server.base

  // ===================== Home: blue panel shortcuts =====================
  {
    const backend = freshBackend('one')
    const { context, page } = await openPage(browser, backend)
    await check('home guest: a shortcut asks to sign in and returns to the chosen section afterwards', async () => {
      await page.goto(base + '/')
      await page.getByRole('button', { name: /План работ/ }).click()
      await page.waitForURL((url) => url.pathname === '/auth')
      assert.equal(new URL(page.url()).searchParams.get('next'), '/?workspace=plan')
      // Sign-in through the mock Auth endpoint (the newest route wins over the harness route).
      const claims = Buffer.from(JSON.stringify({ sub: USER, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
      await context.route('https://pilot-test.supabase.co/auth/v1/token**', (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.test`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test', user: { id: USER, email: 'test@example.ru', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} } }),
      }))
      await page.locator('#auth-email').fill('test@example.ru')
      await page.locator('#auth-password').fill('test-password')
      await page.locator('form button[type="submit"]').click()
      await page.waitForURL((url) => url.pathname === '/projects/P1' && url.hash === '#plan', { timeout: 15000 })
      await page.locator('#plan').waitFor()
      await settle(page)
      const top = await page.locator('#plan').evaluate((el) => el.getBoundingClientRect().top)
      assert.ok(top >= -2 && top < 260, `#plan top ${top}`)
    })
    await check('home guest: an unsafe return address is ignored after sign-in', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('//example.com/x'))
      // Already signed in from the previous check: submit again and expect the profile, not another site.
      await page.locator('#auth-email').fill('test@example.ru')
      await page.locator('#auth-password').fill('test-password')
      await page.locator('form button[type="submit"]').click()
      await page.waitForURL((url) => url.pathname === '/profile', { timeout: 15000 })
      assert.equal(new URL(page.url()).host, new URL(base).host)
    })
    await context.close()
  }
  {
    const backend = freshBackend('many')
    const { context, page } = await openPage(browser, backend, { signed: true })
    const shortcut = (name) => page.getByRole('button', { name: new RegExp(name) })
    await check('home: several projects — the picker keeps the chosen section and nothing is chosen at random', async () => {
      await page.goto(base + '/')
      await shortcut('Команда').click()
      const dialog = page.getByRole('dialog', { name: 'Команда: выберите проект' })
      await dialog.waitFor()
      assert.equal(new URL(page.url()).pathname, '/')
      const items = dialog.locator('.project-picker-item')
      assert.equal(await items.count(), 3)
      // Two sections: own projects (active first, the completed one last), then participation.
      await page.waitForFunction(() => !document.querySelector('dialog [data-section] [role=status]'))
      assert.deepEqual(await dialog.locator('[data-section="owned"] .project-picker-title').allInnerTexts(), ['Робот-манипулятор', 'Завершённый стенд'])
      assert.deepEqual(await dialog.locator('[data-section="member"] .project-picker-title').allInnerTexts(), ['Датчик давления'])
      assert.ok((await dialog.innerText()).includes('Вы участник'))
      // The modal keeps its own compact heading inside the blue panel.
      assert.ok(await dialog.locator('.app-modal-title').evaluate((el) => parseFloat(getComputedStyle(el).fontSize) <= 20))
      await settle(page); await page.screenshot({ path: `${out}/home-picker-1440.png` })
      assert.ok((await dialog.locator('[data-section="owned"] .project-picker-item').last().innerText()).includes('Завершён'))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-workspace-shortcut')), 'team')
      await shortcut('Команда').click()
      await dialog.getByRole('link', { name: /Робот-манипулятор/ }).click()
      await page.waitForURL((url) => url.pathname === '/listings/P1' && url.hash === '#members')
      await page.locator('#members').waitFor()
      await settle(page)
      const top = await page.locator('#members').evaluate((el) => el.getBoundingClientRect().top)
      assert.ok(top >= 0 && top < 400, `#members top ${top}`)
    })
    await check('home: the chosen project is used by the other shortcuts; «Сменить» changes it', async () => {
      await page.goto(base + '/')
      await page.getByText('Проект: Робот-манипулятор').waitFor()
      await shortcut('План работ').click()
      await page.waitForURL((url) => url.pathname === '/projects/P1' && url.hash === '#plan')
      await page.goto(base + '/')
      await shortcut('Обсуждения и материалы').click()
      await page.waitForURL((url) => url.pathname === '/projects/P1' && url.hash === '#materials')
      await page.locator('#materials').waitFor()
      assert.ok(await page.getByRole('button', { name: 'Чат команды' }).isVisible())
      await page.goto(base + '/')
      await page.getByRole('button', { name: 'Сменить' }).click()
      const dialog = page.getByRole('dialog', { name: 'Выберите проект' })
      await dialog.getByRole('button', { name: /Датчик давления/ }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByText('Проект: Датчик давления').waitFor()
      await shortcut('План работ').click()
      await page.waitForURL((url) => url.pathname === '/projects/P3' && url.hash === '#plan')
      await page.goto(base + '/')
      await page.getByRole('link', { name: 'Открыть рабочий центр' }).click()
      await page.waitForURL((url) => url.pathname === '/dashboard')
    })
    await check('home: hover, focus and press feedback; no nested interactive elements', async () => {
      await page.goto(base + '/')
      const button = shortcut('Команда')
      await button.waitFor()
      assert.equal(await page.locator('.hero-workspace a button, .hero-workspace button a, .hero-workspace a a, .hero-workspace button button').count(), 0)
      // Hover only after the signed-in layout is complete (work navigation, current project line):
      // a later layout shift moves the button away from the pointer and drops :hover.
      await page.getByText('Проект: Датчик давления').waitFor()
      await page.getByRole('navigation', { name: 'Рабочие разделы' }).waitFor()
      await settle(page)
      const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor)
      await button.hover()
      // The :hover transition may start a frame after hover(); wait for its end value, not a snapshot.
      await button.evaluate((el) => new Promise((resolve, reject) => {
        const started = performance.now()
        const tick = () => {
          if (/matrix\(1, 0, 0, 1, 0, -2\)/.test(getComputedStyle(el).transform)) resolve(null)
          else if (performance.now() - started > 3000) reject(new Error(`hover lift not reached: ${getComputedStyle(el).transform}`))
          else requestAnimationFrame(tick)
        }
        tick()
      }))
      await settle(page)
      const hovered = await button.evaluate((el) => [getComputedStyle(el).transform, getComputedStyle(el).backgroundColor])
      assert.ok(/matrix\(1, 0, 0, 1, 0, -2\)/.test(hovered[0]), hovered[0])
      assert.notEqual(hovered[1], before)
      await page.mouse.move(5, 5)
      await page.keyboard.press('Tab')
      await button.focus()
      assert.notEqual(await button.evaluate((el) => getComputedStyle(el).outlineStyle), 'none')
      const anim = await page.locator('.workspace-feature').first().evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).animationIterationCount])
      assert.deepEqual(anim, ['fade-up', '1'])
      await settle(page); await page.locator('.hero-workspace').screenshot({ path: `${out}/home-panel-1440.png` })
    })
    await context.close()

    const reduced = await openPage(browser, backend, { signed: true, reducedMotion: 'reduce' })
    await check('home reduced motion: no movement on hover, the colour still changes', async () => {
      await reduced.page.goto(base + '/')
      const button = reduced.page.getByRole('button', { name: /Команда/ })
      const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor)
      await button.hover()
      const after = await button.evaluate((el) => [getComputedStyle(el).transform, getComputedStyle(el).backgroundColor, getComputedStyle(el).animationName])
      assert.equal(after[0], 'none')
      assert.notEqual(after[1], before)
      assert.equal(after[2], 'none')
    })
    await reduced.context.close()
  }
  {
    const backend = freshBackend('none')
    const { context, page } = await openPage(browser, backend, { signed: true })
    await check('home: no projects — a clear state with creating or finding a project', async () => {
      await page.goto(base + '/')
      await page.getByText('У Вас пока нет проектов с рабочей зоной.').first().waitFor()
      await page.getByRole('button', { name: /План работ/ }).click()
      const dialog = page.getByRole('dialog', { name: 'План работ: выберите проект' })
      await dialog.waitFor()
      assert.equal(await dialog.getByRole('link', { name: 'Создать проект' }).getAttribute('href'), '/listings/new')
      assert.equal(await dialog.getByRole('link', { name: 'Найти проект' }).getAttribute('href'), '/listings')
      await settle(page); await page.screenshot({ path: `${out}/home-no-projects-1440.png` })
    })
    await context.close()
  }
  {
    const backend = freshBackend('many')
    const { context, page } = await openPage(browser, backend, { signed: true })
    await check('home: a loading error is shown with a retry, not hidden', async () => {
      // The first load fails in both sections (own projects and participation); each one retries on its own.
      backend.failures.push({ method: 'GET', table: 'listings', status: 500, message: 'temporary failure' }, { method: 'GET', table: 'applications', status: 500, message: 'temporary failure' })
      const failed = page.waitForResponse((r) => r.url().includes('/rest/v1/applications') && r.status() === 500)
      await page.goto(base + '/')
      await failed
      await page.getByRole('button', { name: /План работ/ }).click()
      const dialog = page.getByRole('dialog', { name: 'План работ: выберите проект' })
      for (const kind of ['owned', 'member']) {
        const section = dialog.locator(`[data-section="${kind}"]`)
        await section.getByRole('alert').filter({ hasText: 'Не удалось загрузить проекты' }).waitFor()
        await section.getByRole('button', { name: 'Повторить' }).click()
      }
      await page.waitForFunction(() => document.querySelectorAll('dialog .project-picker-item').length === 3)
      assert.equal(await dialog.getByRole('alert').count(), 0)
    })
    await context.close()
  }

  // ===================== Task board =====================
  {
    const backend = freshBackend('one')
    const { context, page } = await openPage(browser, backend, { signed: true })
    const column = (status) => page.locator(`section[data-drop-status="${status}"]`)
    const grip = (title) => page.getByRole('button', { name: `Переместить задачу «${title}»` })
    const card = (title) => page.locator('[data-task-card]', { hasText: title })
    await page.goto(base + '/projects/P1')
    await column('todo').waitFor()

    await check('board: the whole card follows the pointer at its size; the target column and the place are shown', async () => {
      const source = card('Собрать требования')
      const size = await source.evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight }))
      const from = await centerOf(grip('Собрать требования'))
      const target = await column('doing').boundingBox()
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, { x: from.x + 60, y: from.y + 20 }, 4)
      const ghost = page.locator('.task-drag-ghost')
      await ghost.waitFor()
      const first = await ghost.evaluate((el) => ({ width: el.offsetWidth, height: el.offsetHeight, text: el.innerText, hidden: el.getAttribute('aria-hidden'), inert: el.inert, rect: el.getBoundingClientRect().toJSON() }))
      assert.ok(Math.abs(first.width - size.width) <= 1 && Math.abs(first.height - size.height) <= 1, JSON.stringify([first, size]))
      for (const part of ['Собрать требования', 'Исполнитель: Иван Иванов', 'Начало:', 'Дедлайн:', 'Список требований заказчика.']) assert.ok(first.text.includes(part), part)
      assert.equal(first.hidden, 'true')
      assert.equal(first.inert, true)
      // The copy moves together with the pointer.
      await moveSlowly(page, { x: from.x + 60, y: from.y + 20 }, { x: from.x + 160, y: from.y + 50 }, 4)
      const second = await ghost.evaluate((el) => el.getBoundingClientRect().toJSON())
      assert.ok(Math.abs(second.x - first.rect.x - 100) <= 2 && Math.abs(second.y - first.rect.y - 30) <= 2, JSON.stringify([first.rect, second]))
      await moveSlowly(page, { x: from.x + 160, y: from.y + 50 }, { x: target.x + target.width / 2, y: from.y }, 6)
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.classList.contains('is-drop-target'))
      const placeholder = column('doing').locator('.task-drop-placeholder')
      await placeholder.waitFor()
      assert.ok(Math.abs((await placeholder.evaluate((el) => el.offsetHeight)) - size.height) <= 1)
      assert.ok(await page.locator('.task-board').evaluate((el) => el.classList.contains('is-dragging')))
      assert.ok(await source.evaluate((el) => el.classList.contains('is-dragging')))
      assert.equal(patches(backend, 'tasks', 'B1').length, 0, 'nothing is saved before release')
      assert.ok(await noHorizontalOverflow(page))
      await page.screenshot({ path: `${out}/board-drag-copy-1440.png` })
      // Smooth placement after release is a FLIP animation on the card.
      await page.evaluate(() => {
        window.__settled = false
        new MutationObserver((list, observer) => {
          if (document.querySelector('.task-card.is-settling')) { window.__settled = true; observer.disconnect() }
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
      })
      await page.mouse.up()
      await ghost.waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.textContent?.includes('Собрать требования') && !document.querySelector('.task-card.is-saving'))
      assert.equal(await page.evaluate(() => window.__settled), true)
      assert.equal(patches(backend, 'tasks', 'B1').length, 1)
      assert.equal(row(backend, 'B1').status, 'doing')
      assert.equal(await page.locator('.task-drop-placeholder').count(), 0)
    })
    await check('board: Escape cancels the drag; nothing is saved and the card stays', async () => {
      const before = patches(backend, 'tasks', 'B2').length
      const from = await centerOf(grip('Сделать эскиз'))
      const target = await column('done').boundingBox()
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, inside(target, from.y), 8)
      await page.locator('.task-drag-ghost').waitFor()
      await page.keyboard.press('Escape')
      await page.locator('.task-drag-ghost').waitFor({ state: 'detached' })
      assert.equal(await page.locator('.is-drop-target').count(), 0)
      await page.mouse.up()
      await page.waitForTimeout(300)
      assert.equal(patches(backend, 'tasks', 'B2').length, before)
      assert.ok((await column('doing').innerText()).includes('Сделать эскиз'))
    })
    await check('board: a server refusal returns the card and shows the reason', async () => {
      backend.failures.push({ method: 'PATCH', table: 'tasks', status: 400, message: 'Проект завершён: изменения запрещены.' })
      const from = await centerOf(grip('Сделать эскиз'))
      const target = await column('done').boundingBox()
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, inside(target, from.y), 8)
      await page.mouse.up()
      await page.getByRole('alert').filter({ hasText: 'Проект завершён' }).waitFor()
      await page.waitForFunction(() => !document.querySelector('.task-card.is-saving'))
      assert.ok((await column('doing').innerText()).includes('Сделать эскиз'))
      assert.ok(!(await column('done').innerText()).includes('Сделать эскиз'))
      assert.equal(row(backend, 'B2').status, 'doing')
    })
    await check('board: hover lifts the card with a deeper shadow; no layout shift or clipped buttons', async () => {
      await page.mouse.move(5, 5)
      const target = card('Согласовать бюджет')
      await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const neighbour = card('Сделать эскиз')
      await settle(page)
      const beforeNeighbour = await rectOf(neighbour)
      const beforeShadow = await target.evaluate((el) => getComputedStyle(el).boxShadow)
      await target.locator('.font-medium').first().hover()
      await settle(page)
      const style = await target.evaluate((el) => [getComputedStyle(el).transform, getComputedStyle(el).boxShadow])
      assert.ok(/matrix\(1, 0, 0, 1, 0, -3\)/.test(style[0]), style[0])
      assert.notEqual(style[1], beforeShadow)
      assert.deepEqual(await rectOf(neighbour), beforeNeighbour)
      const clipped = await target.evaluate((el) => {
        const box = el.getBoundingClientRect()
        return [...el.querySelectorAll('button, select')].filter((node) => { const r = node.getBoundingClientRect(); return r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 }).length
      })
      assert.equal(clipped, 0)
      await page.mouse.move(5, 5)
    })
    await check('board: keyboard move and status buttons remain alternatives to dragging', async () => {
      await grip('Сделать эскиз').focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="done"]')?.textContent?.includes('Сделать эскиз') && !document.querySelector('.task-card.is-saving'))
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Переместить задачу «Сделать эскиз»')
      await card('Сделать эскиз').getByRole('button', { name: 'В работу' }).click()
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.textContent?.includes('Сделать эскиз') && !document.querySelector('.task-card.is-saving'))
      assert.equal(row(backend, 'B2').status, 'doing')
    })

    if (process.env.MOTION_SKIP_VIDEO !== '1') {
      await check('video: board card drag (WebM)', async () => {
        await page.mouse.move(5, 5)
        // Toasts left by the refusal check are closed so the video shows only the board.
        for (const button of await page.locator('.app-toast button').all()) await button.click().catch(() => null)
        await column('todo').evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 160, behavior: 'instant' }))
        await page.waitForTimeout(200)
        videos.board = await recordVideo(browser, page, `${out}/board-drag.webm`, async () => {
          const handle = grip('Согласовать бюджет')
          const box = await handle.boundingBox()
          const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          const target = await column('doing').boundingBox()
          await page.mouse.move(from.x, from.y)
          await page.waitForTimeout(250)
          await page.mouse.down()
          await moveSlowly(page, from, { x: target.x + target.width / 2, y: from.y + 40 }, 40, 25)
          await page.waitForTimeout(500)
          await page.mouse.up()
          await page.waitForFunction(() => !document.querySelector('.task-card.is-saving'))
        })
        assert.equal(row(backend, 'B3').status, 'doing')
      })
    }
    await context.close()

    const reduced = await openPage(browser, backend, { signed: true, reducedMotion: 'reduce' })
    await check('board reduced motion: the copy follows the pointer without tilt or scale', async () => {
      const rpage = reduced.page
      await rpage.goto(base + '/projects/P1')
      const handle = rpage.getByRole('button', { name: 'Переместить задачу «Расчёт привода»' })
      await handle.waitFor()
      const from = await centerOf(handle)
      await rpage.mouse.move(from.x, from.y)
      await rpage.mouse.down()
      await moveSlowly(rpage, from, { x: from.x + 50, y: from.y + 10 }, 4)
      const transform = await rpage.locator('.task-drag-ghost').evaluate((el) => getComputedStyle(el).transform)
      assert.ok(/^matrix\(1, 0, 0, 1, /.test(transform), transform)
      await rpage.keyboard.press('Escape')
      await rpage.mouse.up()
    })
    await reduced.context.close()
  }

  // ===================== Gantt =====================
  {
    const backend = freshBackend('one')
    const { context, page } = await openPage(browser, backend, { signed: true })
    const bar = (title) => page.locator(`.gantt-bar[aria-label^="${title}."]`)
    const taskDialog = page.locator('dialog.task-details[open]')
    await page.goto(base + '/projects/P1')
    await bar('Расчёт привода').waitFor()

    await check('gantt: the whole bar with its title follows the pointer; dates change by whole days; one request on release', async () => {
      const g1 = bar('Расчёт привода')
      const start = await (async () => { await g1.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })); return rectOf(g1) })()
      const title = await rectOf(g1.locator('.gantt-bar-title'))
      const from = { x: start.x + start.width / 2, y: start.y + start.height / 2 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, { x: from.x + 18, y: from.y }, 6)
      const moved = await rectOf(g1)
      const movedTitle = await rectOf(g1.locator('.gantt-bar-title'))
      assert.ok(Math.abs(moved.x - start.x - 18) <= 2, `bar ${start.x} → ${moved.x}`)
      assert.ok(Math.abs(movedTitle.x - title.x - 18) <= 2, `title ${title.x} → ${movedTitle.x}`)
      const preview = page.locator('.gantt-preview')
      const original = await page.evaluate((iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), row(backend, 'G1').start_at)
      assert.ok((await preview.innerText()).includes(original), 'less than half a day keeps the dates')
      await moveSlowly(page, { x: from.x + 18, y: from.y }, { x: from.x + 58, y: from.y }, 6)
      const next = await page.evaluate((iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), at(2, '09:30'))
      assert.ok((await preview.innerText()).includes(next), await preview.innerText())
      assert.ok(Math.abs((await rectOf(g1)).x - start.x - 58) <= 2)
      assert.equal(scheduleCalls(backend, 'G1').length, 0, 'no request while moving')
      const saved = page.waitForResponse((r) => r.url().includes('/rpc/reschedule_task_secure'))
      await page.mouse.up()
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      await settle(page)
      assert.equal(scheduleCalls(backend, 'G1').length, 1)
      assert.ok(Math.abs((await rectOf(g1)).x - start.x - 40) <= 2, 'the bar settles on the whole day')
      assert.equal(new Date(row(backend, 'G1').start_at).toISOString(), at(2, '09:30'))
      assert.equal(new URL(page.url()).searchParams.get('task'), null, 'a drag does not open the task')
      assert.equal(await taskDialog.count(), 0)
    })
    await check('gantt: resizing the end edge changes the width smoothly and saves one new deadline', async () => {
      const g1 = bar('Расчёт привода')
      await g1.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }))
      const box = await rectOf(g1)
      const due = row(backend, 'G1').due_at
      const from = { x: box.x + box.width - 2, y: box.y + box.height / 2 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, { x: from.x + 25, y: from.y }, 5)
      const during = await rectOf(g1)
      assert.ok(Math.abs(during.x - box.x) <= 1 && Math.abs(during.width - box.width - 25) <= 2, JSON.stringify([box, during]))
      assert.equal(scheduleCalls(backend, 'G1').length, 1)
      const saved = page.waitForResponse((r) => r.url().includes('/rpc/reschedule_task_secure'))
      await page.mouse.up()
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      assert.equal(scheduleCalls(backend, 'G1').length, 2)
      assert.equal(new Date(row(backend, 'G1').due_at).getTime() - new Date(due).getTime(), 86_400_000)
      assert.equal(await taskDialog.count(), 0)
    })
    await check('gantt: a small drag that returns to its place neither saves nor opens the task', async () => {
      const g1 = bar('Расчёт привода')
      const from = await centerOf(g1)
      const count = scheduleCalls(backend, 'G1').length
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, { x: from.x + 15, y: from.y }, 3)
      await moveSlowly(page, { x: from.x + 15, y: from.y }, from, 3)
      await page.mouse.up()
      await page.waitForTimeout(300)
      assert.equal(scheduleCalls(backend, 'G1').length, count)
      assert.equal(await taskDialog.count(), 0)
    })
    await check('gantt: an ordinary click opens the task view; the address changes and «Назад» closes it', async () => {
      const count = scheduleCalls(backend, 'G1').length
      await bar('Расчёт привода').click()
      await taskDialog.waitFor()
      assert.equal(new URL(page.url()).searchParams.get('task'), 'G1')
      const text = await taskDialog.innerText()
      for (const part of ['Расчёт привода', 'В работе', 'Исполнитель', 'Иван Иванов', 'Начало', 'Дедлайн']) assert.ok(text.includes(part), part)
      assert.equal(scheduleCalls(backend, 'G1').length, count)
      await settle(page); await page.screenshot({ path: `${out}/task-view-1440.png` })
      await page.goBack()
      await taskDialog.waitFor({ state: 'detached' })
      await page.waitForURL((url) => !url.searchParams.has('task'))
      await bar('Расчёт привода').focus()
      await page.keyboard.press('Enter')
      await taskDialog.waitFor()
      await page.keyboard.press('Escape')
      await taskDialog.waitFor({ state: 'detached' })
      await page.waitForURL((url) => !url.searchParams.has('task'))
      assert.ok(await bar('Расчёт привода').evaluate((el) => el === document.activeElement), 'focus returns to the bar')
    })
    await check('task view: «Показать на доске» closes the view and highlights the card', async () => {
      await bar('Расчёт привода').click()
      await taskDialog.waitFor()
      await taskDialog.getByRole('button', { name: 'Показать на доске' }).click()
      await taskDialog.waitFor({ state: 'detached' })
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Переместить задачу «Расчёт привода»')
    })
    if (process.env.MOTION_SKIP_VIDEO !== '1') {
      await check('video: Gantt bar move and resize (WebM)', async () => {
        const g1 = bar('Расчёт привода')
        await g1.evaluate((el) => el.closest('.gantt').scrollIntoView({ block: 'center', behavior: 'instant' }))
        await page.waitForTimeout(200)
        videos.gantt = await recordVideo(browser, page, `${out}/gantt-drag.webm`, async () => {
          const box = await rectOf(g1)
          const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          await page.mouse.move(from.x, from.y)
          await page.waitForTimeout(250)
          await page.mouse.down()
          await moveSlowly(page, from, { x: from.x + 85, y: from.y }, 34, 25)
          await page.waitForTimeout(400)
          await page.mouse.up()
          await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
          await page.waitForTimeout(500)
          const after = await rectOf(g1)
          const edge = { x: after.x + after.width - 2, y: after.y + after.height / 2 }
          await page.mouse.move(edge.x, edge.y)
          await page.waitForTimeout(250)
          await page.mouse.down()
          await moveSlowly(page, edge, { x: edge.x + 70, y: edge.y }, 28, 25)
          await page.waitForTimeout(400)
          await page.mouse.up()
          await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
        })
      })
    }

    // ===================== Project calendar =====================
    const panel = page.getByRole('dialog', { name: /задачи и события/ })
    await check('calendar: hover shows the day panel with times, assignee, event author and status; the pointer can enter it', async () => {
      // The Gantt checks above moved this task; the calendar checks start from the seeded dates.
      Object.assign(row(backend, 'G1'), { start_at: at(1, '09:30'), due_at: at(3, '18:00') })
      await page.goto(base + '/projects/P1')
      await page.locator('.calendar-grid').waitFor()
      await showMonthOf(page, at(1, '09:00'))
      const day = dayWith(page, 'Созвон с заказчиком')
      await day.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const cell = await rectOf(day)
      await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2)
      await panel.waitFor()
      const text = await panel.innerText()
      for (const part of ['Старт задачи', '09:00', 'Собрать требования', 'Исполнитель: Иван Иванов', 'Статус: В работе', 'Созвон с заказчиком', '11:00–12:00', 'Автор события: Анна Петрова']) {
        assert.ok(text.includes(part), `${part} in ${text}`)
      }
      const eventItem = panel.locator('.calendar-popover-item', { hasText: 'Созвон с заказчиком' })
      assert.ok(!(await eventItem.innerText()).includes('Исполнитель'), 'an assignee is not shown as a meeting participant')
      // Move into the panel through the gap: it stays open.
      const box = await rectOf(panel)
      await moveSlowly(page, { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 }, { x: box.x + box.width / 2, y: box.y + 30 }, 8, 15)
      await page.waitForTimeout(400)
      assert.ok(await panel.isVisible())
      await settle(page); await page.screenshot({ path: `${out}/calendar-panel-1440.png` })
      const link = panel.locator('.calendar-popover-item', { hasText: 'Собрать требования' }).getByRole('link', { name: 'Открыть задачу' })
      assert.equal(await link.getAttribute('href'), '/projects/P1?task=B1')
      await link.click()
      await taskDialog.waitFor()
      assert.ok((await taskDialog.innerText()).includes('Собрать требования'))
      assert.equal(new URL(page.url()).searchParams.get('task'), 'B1')
      await page.goBack()
      await taskDialog.waitFor({ state: 'detached' })
      await page.mouse.move(5, 5)
      await panel.waitFor({ state: 'detached' })
    })
    await check('calendar: keyboard — focus opens, ArrowDown enters, Tab leaves, Escape closes and returns focus', async () => {
      const day = dayWith(page, 'Созвон с заказчиком')
      const trigger = day.locator('.calendar-day-trigger')
      await trigger.focus()
      await panel.waitFor()
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
      await page.keyboard.press('ArrowDown')
      assert.equal(await page.evaluate(() => document.activeElement?.className), 'calendar-popover-action')
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'detached' })
      assert.ok(await trigger.evaluate((el) => el === document.activeElement), 'focus returns to the day')
      // Reopen and walk through with Tab: leaving the last link closes the panel on the day.
      await page.keyboard.press('ArrowDown')
      await panel.waitFor()
      await page.keyboard.press('ArrowDown')
      // Focus is on the first record link (after the close button); Tab past the last one leaves.
      const remaining = await panel.locator('a, button').count() - 1
      for (let i = 0; i < remaining; i += 1) await page.keyboard.press('Tab')
      await panel.waitFor({ state: 'detached' })
      assert.ok(await trigger.evaluate((el) => el === document.activeElement))
    })
    await check('calendar: the same title does not link an event to a task', async () => {
      await showMonthOf(page, at(3, '10:00'))
      const day = dayWith(page, 'Проверка')
      await day.locator('.calendar-day-trigger').focus()
      await panel.waitFor()
      const items = panel.locator('.calendar-popover-item', { hasText: 'Расчёт привода' })
      assert.equal(await items.count(), 2)
      const hrefs = await items.locator('a').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')))
      assert.deepEqual(hrefs.sort(), ['#event-E2', '/projects/P1?task=G1'].sort())
      await page.keyboard.press('Escape')
    })
    await context.close()

    const mobile = await openPage(browser, backend, { signed: true, width: 360, height: 780, touch: true })
    await check('calendar 360 touch: a tap opens the panel inside the screen; a link can be tapped', async () => {
      const mpage = mobile.page
      await mpage.goto(base + '/projects/P1')
      await mpage.locator('.calendar-grid').waitFor()
      await showMonthOf(mpage, at(1, '09:00'))
      const day = dayWith(mpage, 'Созвон с заказчиком')
      const trigger = day.locator('.calendar-day-trigger')
      await trigger.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }))
      await trigger.tap()
      const mpanel = mpage.getByRole('dialog', { name: /задачи и события/ })
      await mpanel.waitFor()
      await mpage.waitForTimeout(200)
      const box = await rectOf(mpanel)
      assert.ok(box.x >= 0 && box.x + box.width <= 360 + 0.5, JSON.stringify(box))
      assert.ok(await noHorizontalOverflow(mpage))
      await settle(mpage); await mpage.screenshot({ path: `${out}/calendar-panel-360.png` })
      await mpanel.locator('.calendar-popover-item', { hasText: 'Собрать требования' }).getByRole('link', { name: 'Открыть задачу' }).tap()
      await mpage.locator('dialog.task-details[open]').waitFor()
      assert.equal(new URL(mpage.url()).searchParams.get('task'), 'B1')
      await mpage.locator('dialog.task-details[open] .action-secondary', { hasText: 'Закрыть' }).tap()
      await mpage.locator('dialog.task-details[open]').waitFor({ state: 'detached' })
      // A tap outside closes the day panel.
      await trigger.tap()
      await mpanel.waitFor()
      await mpage.locator('h3', { hasText: 'Календарь проекта' }).tap()
      await mpanel.waitFor({ state: 'detached' })
    })
    await mobile.context.close()
  }

  // ===================== Global calendar, closed project, consistency =====================
  {
    const backend = freshBackend('many')
    const { context, page } = await openPage(browser, backend, { signed: true })
    const panel = page.getByRole('dialog', { name: /задачи и события/ })
    await check('calendar (all projects): the panel names the project and opens the task view in its project', async () => {
      await page.goto(base + '/calendar')
      await page.locator('.calendar-grid').waitFor()
      await showMonthOf(page, at(1, '09:00'))
      const day = dayWith(page, 'Собрать требования')
      await day.locator('.calendar-day-trigger').focus()
      await panel.waitFor()
      const item = panel.locator('.calendar-popover-item', { hasText: 'Собрать требования' }).first()
      const text = await item.innerText()
      for (const part of ['Проект: Робот-манипулятор', 'Исполнитель: Иван Иванов', 'Статус: Нужно сделать', '09:00']) assert.ok(text.includes(part), `${part} in ${text}`)
      await item.getByRole('link', { name: 'Открыть задачу' }).click()
      await page.waitForURL((url) => url.pathname === '/projects/P1' && url.searchParams.get('task') === 'B1')
      const dialog = page.locator('dialog.task-details[open]')
      await dialog.waitFor()
      await dialog.locator('.action-secondary', { hasText: 'Закрыть' }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(new URL(page.url()).searchParams.get('task'), null)
      await page.goBack()
      await page.waitForURL((url) => url.pathname === '/calendar')
    })
    await check('closed project: a click opens the task, dragging changes nothing', async () => {
      await page.goto(base + '/projects/P2')
      const bar = page.locator('.gantt-bar[aria-label^="Архивная задача."]')
      await bar.waitFor()
      assert.equal(await page.locator('.gantt-bar.is-editable, .gantt-handle').count(), 0)
      const before = await rectOf(bar)
      const from = await centerOf(bar)
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await moveSlowly(page, from, { x: from.x + 80, y: from.y }, 6)
      assert.ok(Math.abs((await rectOf(bar)).x - before.x) <= 1)
      await page.mouse.up()
      assert.equal(scheduleCalls(backend, 'P2T').length, 0)
      await page.locator('dialog.task-details[open]').waitFor({ state: 'detached', timeout: 1000 }).catch(() => null)
      if (await page.locator('dialog.task-details[open]').count()) await page.keyboard.press('Escape')
      await bar.click()
      await page.locator('dialog.task-details[open]').waitFor()
      assert.ok(await page.getByRole('button', { name: 'Переместить задачу «Архивная задача»' }).isDisabled())
      await page.keyboard.press('Escape')
      // Closing goes back in history; wait for it before the next navigation.
      await page.waitForURL((url) => !url.searchParams.has('task'))
    })
    await check('consistency: board, Gantt, calendar panel and task view show the same data after save and reload', async () => {
      await page.goto(base + '/projects/P1')
      const bar = page.locator('.gantt-bar[aria-label^="Расчёт привода."]')
      await bar.waitFor()
      await bar.focus()
      const saved = page.waitForResponse((r) => r.url().includes('/rpc/reschedule_task_secure'))
      await page.keyboard.press('Shift+ArrowRight')
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      await page.getByRole('button', { name: 'Переместить задачу «Расчёт привода»' }).focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="done"]')?.textContent?.includes('Расчёт привода') && !document.querySelector('.task-card.is-saving'))
      await page.reload()
      await bar.waitFor()
      const due = row(backend, 'G1').due_at
      const [full, time, long] = await page.evaluate((iso) => [new Date(iso).toLocaleString(), new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })], due)
      assert.ok((await page.locator('section[data-drop-status="done"] [data-task-card]', { hasText: 'Расчёт привода' }).innerText()).includes(full))
      assert.ok((await bar.getAttribute('aria-label')).includes('Готово'))
      await showMonthOf(page, due)
      const day = page.locator('.calendar-grid .calendar-day', { has: page.locator('.space-y-1 > div', { hasText: 'Дедлайн' }).filter({ hasText: 'Расчёт привода' }) }).first()
      await day.locator('.calendar-day-trigger').focus()
      await panel.waitFor()
      const item = panel.locator('.calendar-popover-item.is-task-due', { hasText: 'Расчёт привода' })
      const text = await item.innerText()
      assert.ok(text.includes(time) && text.includes('Статус: Готово'), text)
      await item.getByRole('link', { name: 'Открыть задачу' }).click()
      const dialog = page.locator('dialog.task-details[open]')
      await dialog.waitFor()
      assert.ok((await dialog.innerText()).includes(long), `${await dialog.innerText()} / ${long}`)
      await page.keyboard.press('Escape')
    })
    await context.close()
  }

  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks: results.length, results, errors, videos }, null, 2))
  console.log('PASS', results.length, 'motion and calendar checks (mock API)', JSON.stringify(videos))
} catch (error) {
  console.error('FAIL', error.message)
  writeFileSync(`${out}/errors.json`, JSON.stringify({ errors, passed: results, failure: error.message, stack: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.stop()
}
