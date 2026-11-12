// Browser checks for the consolidated interface package (items 3–7): time zones, home and motion,
// task board drag & drop, Gantt chart and managed ad places.
// Mock backend only (scripts/tests/ui-harness.mjs): no real Supabase, no external hosts, no WebSockets.
// Two builds are made: NEXT_PUBLIC_AD_SLOTS=demo for the ad checks, then the default (off) build.
// Usage: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium/edge> node scripts/tests/interface-ui.mjs
// Iteration only: INTERFACE_SKIP_ADS=1 INTERFACE_SKIP_BUILD=1 reuse the current default build.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, buildApp, checker, createBackend, launchBrowser, newContext, noHorizontalOverflow, root, startApp } from './ui-harness.mjs'

const PORT = 3003
const out = `${root}/test-results/interface`
mkdirSync(out, { recursive: true })
const results = []
const errors = []
const check = checker(results)
const USER = '00000000-0000-4000-8000-0000000000a1'
const MEMBER = '00000000-0000-4000-8000-0000000000a2'

// Fixed local zone of the browser context is Asia/Tomsk (UTC+7, no DST).
const tomskDate = (offsetDays) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tomsk', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const date = new Date(`${today}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}
const at = (offsetDays, time) => new Date(`${tomskDate(offsetDays)}T${time}:00+07:00`).toISOString()
const DAY = 86_400_000

function task(id, title, status, start, due, extra = {}) {
  return { id, project_id: 'P1', title, description: null, status, assignee_id: USER, created_at: at(-5, '10:00'), start_at: start, due_at: due, completed_at: null, penalty_percent: 10, excuse_reason: null, excuse_status: 'none', excuse_decided_by: null, excuse_decided_at: null, ...extra }
}

function seed() {
  return {
    listings_with_count: [
      { id: 'L1', title: 'Проект в Томске', description: 'Описание', roles_needed: ['Инженер'], skills: ['CAD'], timezone: 'Asia/Tomsk', created_at: at(-1, '10:00'), applications_count: 0 },
      { id: 'L2', title: 'Проект в Киеве', description: 'Описание', roles_needed: [], skills: [], timezone: 'Europe/Kiev', created_at: at(-2, '10:00'), applications_count: 0 },
      { id: 'L3', title: 'Проект со старым поясом', description: 'Описание', roles_needed: [], skills: [], timezone: 'UTC+3', created_at: at(-3, '10:00'), applications_count: 0 },
      { id: 'L4', title: 'Проект без пояса', description: 'Описание', roles_needed: [], skills: [], timezone: null, created_at: at(-4, '10:00'), applications_count: 0 },
      { id: 'L5', title: 'Проект в Москве', description: 'Описание', roles_needed: [], skills: [], timezone: 'Europe/Moscow', created_at: at(-5, '10:00'), applications_count: 0 },
    ],
    listings: [
      { id: 'P1', title: 'Робот-манипулятор', description: 'Рабочий проект', roles_needed: [], skills: [], timezone: 'Asia/Tomsk', created_by: USER, created_at: at(-10, '10:00'), deadline_at: at(12, '18:00'), completed_at: null },
      { id: 'P2', title: 'Завершённый проект', description: 'Архив', roles_needed: [], skills: [], timezone: null, created_by: USER, created_at: at(-30, '10:00'), deadline_at: null, completed_at: at(-1, '10:00') },
    ],
    applications: [{ id: 'A1', listing_id: 'P1', user_id: MEMBER, status: 'accepted' }],
    profiles_collaboration: [{ user_id: USER, display_name: 'Иван Иванов' }, { user_id: MEMBER, display_name: 'Анна Петрова' }],
    tasks: [
      task('T1', 'Собрать требования', 'todo', null, null),
      task('T2', 'Сделать эскиз', 'doing', null, null),
      task('T3', 'Согласовать бюджет', 'done', null, null, { completed_at: at(-1, '12:00') }),
      task('T4', 'Проверка внешним экспертом', 'review', null, null),
      task('G1', 'Расчёт привода', 'doing', at(1, '09:30'), at(3, '18:00')),
      task('G2', 'Закупка деталей', 'todo', null, at(6, '12:00')),
      task('G3', 'Испытания', 'todo', null, null),
      { ...task('P2T', 'Архивная задача', 'done', at(-20, '09:00'), at(-18, '18:00')), project_id: 'P2' },
    ],
    auctions: [
      { id: 'M1', type: 'request', status: 'open', title: 'Разработка датчика', public_summary: 'Нужна команда для прототипа.', category: 'Электроника', budget_min: 100000, budget_max: 200000, currency: 'RUB', required_roles: ['Инженер'], ends_at: at(20, '18:00'), owner_id: MEMBER, created_at: at(-2, '10:00'), nda_required: false },
      { id: 'M2', type: 'offer', status: 'open', title: 'Готовый станок ЧПУ', public_summary: 'Прототип для внедрения.', category: 'Станки', budget_min: null, budget_max: 500000, currency: 'RUB', deal_type: 'license', readiness_level: 'prototype', ends_at: at(30, '18:00'), owner_id: MEMBER, created_at: at(-3, '10:00'), nda_required: true },
    ],
    profiles_public: [],
    universities: [],
  }
}

function freshBackend() {
  return createBackend(seed(), { userId: USER, rpc: { is_site_editor: false, project_file_storage_version: 1, refresh_my_recommendations: { refreshed: true, sent: 0 } } })
}

async function openPage(browser, backend, options = {}) {
  const context = await newContext(browser, backend, options)
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${options.width || 1440}: ${e.message}`))
  return { context, page }
}

/** Waits for finite animations (block fade-in, menus) so screenshots show the settled state. */
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations()
  .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
  .map((animation) => animation.finished.catch(() => null))))
/** Closes notification toasts left by previous checks before taking a screenshot. */
const dismissToasts = async (page) => {
  for (const button of await page.locator('.app-toast button').all()) await button.click().catch(() => null)
}
const tasksPatches = (backend, id) => backend.log.filter((entry) => entry.method === 'PATCH' && entry.path.endsWith('/tasks') && entry.query.includes(`id=eq.${id}`))
const taskRow = (backend, id) => backend.tables.tasks.find((row) => row.id === id)

async function dragMouse(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
}
// Centre the element first so drags do not start inside the board's edge auto-scroll zone.
const center = async (locator) => { await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
const boxOf = async (locator) => { await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })); return locator.boundingBox() }
/** Point inside a board column at the height of `from` (columns are side by side on desktop). */
const columnPoint = async (column, from) => {
  const b = await column.boundingBox()
  return { x: b.x + b.width / 2, y: Math.min(Math.max(from.y, b.y + 12), b.y + b.height - 12) }
}

let server
let browser
try {
  browser = await launchBrowser()

  // ===================== Phase 1: ad places in demo mode =====================
  // INTERFACE_SKIP_ADS=1 skips this phase while iterating; full runs keep it.
  if (process.env.INTERFACE_SKIP_ADS !== '1') {
    const env = appEnv(PORT, { NEXT_PUBLIC_AD_SLOTS: 'demo' })
    await buildApp(env)
    server = await startApp(PORT, env)
    const base = server.base
    const backend = freshBackend()
    for (const width of [360, 768, 1440]) {
      const { context, page } = await openPage(browser, backend, { width, touch: width < 1000 })
      await check(`ads demo ${width}: marked placeholders with reserved size on home and catalogues`, async () => {
        const expected = { 360: { home: [320, 100], list: [320, 100] }, 768: { home: [728, 90], list: [728, 90] }, 1440: { home: [970, 90], list: [728, 90] } }[width]
        for (const [route, id, size] of [['/', 'home-after-entry-points', expected.home], ['/listings', 'listings-after-filters', expected.list], ['/experts', 'experts-after-filters', expected.list]]) {
          await page.goto(base + route)
          const slot = page.locator(`[data-ad-slot="${id}"]`)
          await slot.waitFor()
          assert.equal(await slot.getAttribute('aria-label'), 'Рекламное место')
          assert.ok((await slot.innerText()).includes('Демонстрационный блок · не реклама'))
          const box = await slot.locator('.ad-slot-box').boundingBox()
          assert.ok(Math.abs(box.width - size[0]) <= 1 && Math.abs(box.height - size[1]) <= 1, `${route} ${width}: ${box.width}x${box.height}`)
          assert.ok(await noHorizontalOverflow(page), `${route} overflow at ${width}`)
          if (route !== '/experts') { await settle(page); await page.screenshot({ path: `${out}/ads-demo-${route === '/' ? 'home' : 'listings'}-${width}.png`, fullPage: true }) }
        }
      })
      await context.close()
    }
    {
      const { context, page } = await openPage(browser, backend, { signed: true })
      await check('ads demo: no ad places in the private workspace', async () => {
        for (const route of ['/dashboard', '/projects/P1']) {
          await page.goto(base + route)
          await page.locator('h1').first().waitFor()
          assert.equal(await page.locator('[data-ad-slot]').count(), 0, route)
        }
      })
      await context.close()
    }
    await check('ads demo: no third-party requests', async () => {
      assert.deepEqual(backend.externalBlocked.filter((url) => !url.startsWith('ws:')), [])
    })
    server.stop()
  }

  // ===================== Phase 2: default build (ads off) =====================
  const env = appEnv(PORT)
  if (process.env.INTERFACE_SKIP_BUILD !== '1') await buildApp(env)
  server = await startApp(PORT, env)
  const base = server.base

  // ---------- Ads off, home, motion ----------
  {
    const backend = freshBackend()
    const { context, page } = await openPage(browser, backend)
    await check('ads off: nothing rendered and no empty band', async () => {
      for (const route of ['/', '/listings', '/experts']) {
        await page.goto(base + route)
        await page.locator('h1').first().waitFor()
        assert.equal(await page.locator('[data-ad-slot], .ad-slot').count(), 0, route)
      }
      await page.goto(base + '/')
      assert.equal(await page.locator('.entry-points').evaluate((el) => el.nextElementSibling?.className), 'university-home-band')
    })
    await check('home: every card and button link opens an existing page; no nested interactive elements', async () => {
      await page.goto(base + '/')
      const hrefs = [...new Set(await page.locator('main a[href^="/"]').evaluateAll((links) => links.map((a) => a.getAttribute('href'))))]
      assert.ok(hrefs.length >= 8, hrefs.join(','))
      for (const href of hrefs) assert.equal((await page.request.get(base + href)).status(), 200, href)
      assert.equal(await page.locator('main a a, main a button, main button a').count(), 0)
      // Descriptive tiles in the hero panel are not links and do not react to hover like links.
      assert.equal(await page.locator('.workspace-features a').count(), 0)
      await settle(page); await page.screenshot({ path: `${out}/home-1440.png` })
    })
    await check('motion: short one-off block animation, toasts and menus animate', async () => {
      await page.goto(base + '/')
      const anim = await page.locator('.home > section').first().evaluate((el) => { const s = getComputedStyle(el); return [s.animationName, s.animationDuration, s.animationIterationCount] })
      assert.deepEqual(anim, ['fade-up', '0.24s', '1'])
      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Проекты', exact: true }).click()
      assert.equal(await page.locator('#projects-navigation').evaluate((el) => getComputedStyle(el).animationName), 'pop-in')
    })
    await context.close()
    const reduced = await openPage(browser, backend, { reducedMotion: 'reduce' })
    await check('motion: prefers-reduced-motion disables animations, transitions and hover lifts', async () => {
      await reduced.page.goto(base + '/')
      const values = await reduced.page.evaluate(() => {
        const section = getComputedStyle(document.querySelector('.home > section'))
        const button = getComputedStyle(document.querySelector('.action-primary'))
        return [section.animationName, button.transitionDuration]
      })
      assert.deepEqual(values, ['none', '0s'])
    })
    await reduced.context.close()
  }

  // ---------- ER-002 time zones in the catalogue ----------
  {
    const backend = freshBackend()
    const { context, page } = await openPage(browser, backend)
    const titles = () => page.locator('.listing-card h2').allInnerTexts()
    const expectTitles = async (expected) => {
      await page.waitForFunction((list) => {
        const shown = [...document.querySelectorAll('.listing-card h2')].map((el) => el.textContent.trim())
        return JSON.stringify(shown) === JSON.stringify(list)
      }, expected, { timeout: 5000 }).catch(async () => assert.deepEqual(await titles(), expected))
    }
    const combo = () => page.getByRole('combobox', { name: 'Часовой пояс проекта' })
    await page.goto(base + '/listings')
    await page.locator('.listing-card').first().waitFor()
    await check('tz: catalogue uses the searchable picker and readable labels', async () => {
      assert.equal(await page.locator('#project-timezone').getAttribute('role'), 'combobox')
      const meta = await page.locator('.listing-card .card-meta.border-t').allInnerTexts()
      assert.ok(meta.some((text) => text.includes('Томск · UTC+7')), meta.join('|'))
      assert.ok(meta.some((text) => text.includes('Киев · UTC+2')), meta.join('|'))
      assert.ok(meta.some((text) => text.includes('UTC+3')))
      assert.ok(meta.some((text) => text.includes('Часовой пояс не указан')))
    })
    await check('tz: search by Russian name, keyboard select, exact filter', async () => {
      await combo().click()
      assert.equal(await combo().getAttribute('aria-expanded'), 'true')
      await combo().fill('томск')
      const option = page.getByRole('option', { name: /Томск/ }).first()
      assert.ok((await option.innerText()).includes('UTC+7'))
      await settle(page); await page.screenshot({ path: `${out}/tz-catalogue-open-1440.png` })
      await page.keyboard.press('Enter')
      assert.equal(await combo().getAttribute('aria-expanded'), 'false')
      await expectTitles(['Проект в Томске'])
      assert.ok(await page.getByText('Проекты без указанного пояса скрыты.').isVisible())
    })
    await check('tz: clear button resets the filter', async () => {
      await page.getByRole('button', { name: 'Очистить часовой пояс' }).click()
      await expectTitles(['Проект в Томске', 'Проект в Киеве', 'Проект со старым поясом', 'Проект без пояса', 'Проект в Москве'])
    })
    await check('tz: alias Europe/Kiev matches Киев (Europe/Kyiv)', async () => {
      await combo().fill('Киев')
      await page.getByRole('option', { name: /Киев/ }).first().click()
      await expectTitles(['Проект в Киеве'])
    })
    await check('tz: Москва does not match legacy UTC+3 or empty values', async () => {
      await combo().fill('москва')
      await page.getByRole('option', { name: /Москва/ }).first().click()
      await expectTitles(['Проект в Москве'])
    })
    await check('tz: legacy value is offered as is and matches only itself', async () => {
      await page.getByRole('button', { name: 'Очистить часовой пояс' }).click()
      await combo().click()
      const legacy = page.getByRole('option', { name: /UTC\+3.*Ранее указанное значение/ })
      await legacy.waitFor()
      await legacy.click()
      await expectTitles(['Проект со старым поясом'])
    })
    await check('tz: ArrowDown opens, Escape closes and keeps focus; search by offset', async () => {
      await page.getByRole('button', { name: 'Очистить часовой пояс' }).click()
      await combo().focus()
      await page.keyboard.press('ArrowDown')
      assert.equal(await combo().getAttribute('aria-expanded'), 'true')
      assert.ok(await combo().getAttribute('aria-activedescendant'))
      await page.keyboard.press('Escape')
      assert.equal(await combo().getAttribute('aria-expanded'), 'false')
      assert.ok(await combo().evaluate((el) => el === document.activeElement))
      await combo().fill('UTC+7')
      const names = await page.getByRole('option').allInnerTexts()
      assert.ok(names.some((n) => n.includes('Томск')) && names.some((n) => n.includes('Новосибирск')) && !names.some((n) => n.includes('Москва')))
      await page.keyboard.press('Escape')
    })
    for (const width of [360, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await check(`tz ${width}: picker fits, list opens by tap/click without overflow`, async () => {
        await page.goto(base + '/listings')
        await page.locator('.listing-card').first().waitFor()
        await combo().click()
        await page.getByRole('listbox').waitFor()
        assert.ok(await noHorizontalOverflow(page))
        const list = await page.getByRole('listbox').boundingBox()
        assert.ok(list.x >= 0 && list.x + list.width <= width + 1)
        await settle(page); await page.screenshot({ path: `${out}/tz-catalogue-open-${width}.png` })
        await page.keyboard.press('Escape')
      })
    }
    await context.close()
  }

  // ---------- Board drag & drop ----------
  {
    const backend = freshBackend()
    const { context, page } = await openPage(browser, backend, { signed: true })
    const column = (status) => page.locator(`section[data-drop-status="${status}"]`)
    const grip = (title) => page.getByRole('button', { name: `Переместить задачу «${title}»` })
    await page.goto(base + '/projects/P1')
    await column('todo').waitFor()
    await check('board: columns «Нужно сделать / В работе / Готово»; unknown status stays visible', async () => {
      for (const [status, label] of [['todo', 'Нужно сделать'], ['doing', 'В работе'], ['done', 'Готово']]) {
        assert.ok((await column(status).locator('h2').innerText()).startsWith(label))
      }
      const other = page.locator('section[aria-label^="Другие статусы"]')
      assert.ok((await other.innerText()).includes('Проверка внешним экспертом'))
      assert.ok((await other.innerText()).includes('Статус: review'))
      assert.equal(await other.getAttribute('data-drop-status'), null)
    })
    await check('board: mouse drag todo → «В работе» saves via tasks update and survives reload', async () => {
      const from = await center(grip('Собрать требования'))
      await dragMouse(page, from, await columnPoint(column('doing'), from))
      assert.ok(await column('doing').evaluate((el) => el.classList.contains('is-drop-target')))
      await settle(page); await page.screenshot({ path: `${out}/board-drag-1440.png` })
      await page.mouse.up()
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.textContent?.includes('Собрать требования') && !document.querySelector('.task-card.is-saving'))
      assert.equal(taskRow(backend, 'T1').status, 'doing')
      const patch = tasksPatches(backend, 'T1')
      assert.equal(patch.length, 1)
      assert.deepEqual(Object.keys(JSON.parse(patch[0].body)).sort(), ['completed_at', 'status'])
      await page.reload()
      await column('doing').waitFor()
      assert.ok((await column('doing').innerText()).includes('Собрать требования'))
    })
    await check('board: server error returns the card and shows the reason', async () => {
      backend.failures.push({ method: 'PATCH', table: 'tasks', status: 403, message: 'new row violates row-level security policy for table "tasks"' })
      { const from = await center(grip('Собрать требования')); await dragMouse(page, from, await columnPoint(column('todo'), from)) }
      await page.mouse.up()
      // RLS errors are shown through the app's existing mapping as «Недостаточно прав…».
      await page.getByRole('alert').filter({ hasText: 'Недостаточно прав' }).waitFor()
      await settle(page); await page.screenshot({ path: `${out}/board-error-1440.png` })
      assert.ok((await column('doing').innerText()).includes('Собрать требования'))
      assert.equal(taskRow(backend, 'T1').status, 'doing')
    })
    await check('board: no repeated requests while saving', async () => {
      backend.delays.push({ method: 'PATCH', table: 'tasks', ms: 1500 })
      const before = tasksPatches(backend, 'T2').length
      { const from = await center(grip('Сделать эскиз')); await dragMouse(page, from, await columnPoint(column('done'), from)) }
      await page.mouse.up()
      const card = column('done').locator('.task-card', { hasText: 'Сделать эскиз' })
      await card.getByText('Сохраняем…').waitFor()
      // aria-disabled (not disabled) so keyboard focus is not dropped while saving.
      assert.equal(await grip('Сделать эскиз').getAttribute('aria-disabled'), 'true')
      assert.equal(await card.getByRole('button', { name: 'В работу' }).isDisabled(), true)
      await grip('Сделать эскиз').dispatchEvent('keydown', { key: 'ArrowLeft' })
      await card.getByText('Сохраняем…').waitFor({ state: 'detached' })
      backend.delays.length = 0
      assert.equal(tasksPatches(backend, 'T2').length - before, 1)
      assert.equal(taskRow(backend, 'T2').status, 'done')
      assert.ok(taskRow(backend, 'T2').completed_at)
    })
    await check('board: keyboard ArrowLeft on the handle moves to the previous column', async () => {
      await grip('Согласовать бюджет').focus()
      await page.keyboard.press('ArrowLeft')
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.textContent?.includes('Согласовать бюджет') && !document.querySelector('.task-card.is-saving'))
      assert.equal(taskRow(backend, 'T3').status, 'doing')
      assert.equal(taskRow(backend, 'T3').completed_at, null)
      // Focus stays on the moved card's handle, so the next arrow press continues the move.
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Переместить задачу «Согласовать бюджет»')
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('section[data-drop-status="doing"]'))), true)
    })
    await check('board: regular status button still works', async () => {
      await column('doing').locator('.task-card', { hasText: 'Согласовать бюджет' }).getByRole('button', { name: 'Готово' }).click()
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="done"]')?.textContent?.includes('Согласовать бюджет') && !document.querySelector('.task-card.is-saving'))
      assert.equal(taskRow(backend, 'T3').status, 'done')
    })
    await check('board: unknown status can be moved explicitly into a column', async () => {
      { const from = await center(grip('Проверка внешним экспертом')); await dragMouse(page, from, await columnPoint(column('doing'), from)) }
      await page.mouse.up()
      await page.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.textContent?.includes('Проверка внешним экспертом') && !document.querySelector('.task-card.is-saving'))
      assert.equal(taskRow(backend, 'T4').status, 'doing')
      assert.equal(await page.locator('section[aria-label^="Другие статусы"]').count(), 0)
    })
    // Show the column headers under the sticky header, without toasts left by the error checks.
    await dismissToasts(page)
    await column('todo').evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 170, behavior: 'instant' }))
    await settle(page); await page.screenshot({ path: `${out}/board-1440.png`, fullPage: false })
    await context.close()

    // Touch drag at 360 px through real touch events (CDP), plus layout.
    const mobile = await openPage(browser, backend, { signed: true, width: 360, touch: true })
    await check('board 360: touch drag moves a card; no horizontal overflow', async () => {
      const mpage = mobile.page
      await mpage.goto(base + '/projects/P1')
      await mpage.locator('section[data-drop-status="todo"]').waitFor()
      assert.ok(await noHorizontalOverflow(mpage))
      const handle = mpage.getByRole('button', { name: 'Переместить задачу «Испытания»' })
      await handle.scrollIntoViewIfNeeded()
      const from = await center(handle)
      const target = mpage.locator('section[data-drop-status="doing"] h2')
      const cdp = await mobile.context.newCDPSession(mpage)
      const height = mpage.viewportSize().height
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
      // Columns are stacked on phones: hold near the bottom edge so the board scrolls, then drop.
      for (let i = 0; i < 200; i += 1) {
        const to = await center(target)
        if (to.y > 90 && to.y < height - 90) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y }] })
          break
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (i % 2), y: height - 20 }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await mpage.waitForFunction(() => document.querySelector('section[data-drop-status="doing"]')?.textContent?.includes('Испытания') && !document.querySelector('.task-card.is-saving'))
      assert.equal(taskRow(backend, 'G3').status, 'doing')
      await settle(mpage); await mpage.screenshot({ path: `${out}/board-360.png` })
    })
    await mobile.context.close()
  }

  // ---------- Gantt ----------
  {
    const backend = freshBackend()
    const { context, page } = await openPage(browser, backend, { signed: true })
    const bar = (title) => page.locator(`.gantt-bar[aria-label^="${title}."]`)
    await page.goto(base + '/projects/P1')
    await page.locator('.gantt-bar').first().waitFor()
    await check('gantt: real bars sized by dates; decorative bars removed', async () => {
      const box = await boxOf(bar('Расчёт привода'))
      // 09:30 day+1 → 18:00 day+3 = 2 days 8.5 h ≈ 2.354 days × 40 px.
      assert.ok(Math.abs(box.width - ((2 * DAY + 8.5 * 3600_000) / DAY) * 40) <= 2, `width ${box.width}`)
      assert.equal(await page.locator('[style*="width: 75%"], [style*="width: 35%"]').count(), 0)
      assert.ok(await page.getByText('Время — в часовом поясе устройства').isVisible())
      await settle(page); await page.screenshot({ path: `${out}/gantt-1440.png` })
    })
    await check('gantt: dragging the bar shows preview dates and moves both dates by whole days, keeping time and duration', async () => {
      const original = { ...taskRow(backend, 'G1') }
      const from = await center(bar('Расчёт привода'))
      await dragMouse(page, from, { x: from.x + 80, y: from.y })
      const preview = page.locator('.gantt-preview')
      await preview.waitFor()
      const expectedStart = await page.evaluate((iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), at(3, '09:30'))
      assert.ok((await preview.innerText()).includes(expectedStart), await preview.innerText())
      assert.equal(tasksPatches(backend, 'G1').length, 0, 'nothing is saved before release')
      await settle(page); await page.screenshot({ path: `${out}/gantt-drag-preview-1440.png` })
      const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/tasks') && r.request().method() === 'PATCH')
      await page.mouse.up()
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      const row = taskRow(backend, 'G1')
      assert.equal(new Date(row.start_at).toISOString(), at(3, '09:30'))
      assert.equal(new Date(row.due_at).toISOString(), at(5, '18:00'))
      assert.equal(new Date(row.due_at) - new Date(row.start_at), new Date(original.due_at) - new Date(original.start_at))
      const patch = tasksPatches(backend, 'G1').at(-1)
      assert.ok(patch.query.includes(`start_at=eq.`) && patch.query.includes(`due_at=eq.`), 'conditional update on previous dates')
    })
    await check('gantt: the board card shows the same saved deadline', async () => {
      const due = taskRow(backend, 'G1').due_at
      const expected = await page.evaluate((iso) => new Date(iso).toLocaleString(), due)
      const card = page.locator('section[data-drop-status="doing"] .task-card', { hasText: 'Расчёт привода' })
      assert.ok((await card.innerText()).includes(expected), `${await card.innerText()} / ${expected}`)
    })
    await check('gantt: dragging the start edge changes only the start date', async () => {
      const due = taskRow(backend, 'G1').due_at
      const box = await boxOf(bar('Расчёт привода'))
      const from = { x: box.x + 2, y: box.y + box.height / 2 }
      await dragMouse(page, from, { x: from.x - 80, y: from.y })
      const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/tasks') && r.request().method() === 'PATCH')
      await page.mouse.up()
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      assert.equal(new Date(taskRow(backend, 'G1').start_at).toISOString(), at(1, '09:30'))
      assert.equal(taskRow(backend, 'G1').due_at, due)
    })
    await check('gantt: dragging the end edge changes only the deadline; it cannot go before the start', async () => {
      const start = taskRow(backend, 'G1').start_at
      const box = await boxOf(bar('Расчёт привода'))
      const from = { x: box.x + box.width - 2, y: box.y + box.height / 2 }
      await dragMouse(page, from, { x: from.x - 400, y: from.y })
      const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/tasks') && r.request().method() === 'PATCH')
      await page.mouse.up()
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      assert.equal(taskRow(backend, 'G1').start_at, start)
      assert.equal(new Date(taskRow(backend, 'G1').due_at).getTime(), new Date(start).getTime())
    })
    await check('gantt: server error restores the previous dates and shows the reason', async () => {
      const before = { ...taskRow(backend, 'G1') }
      const left = (await boxOf(bar('Расчёт привода'))).x
      backend.failures.push({ method: 'PATCH', table: 'tasks', status: 400, message: 'Проект завершён: изменения запрещены.' })
      const from = await center(bar('Расчёт привода'))
      await dragMouse(page, from, { x: from.x + 120, y: from.y })
      await page.mouse.up()
      await page.getByRole('alert').filter({ hasText: 'Проект завершён' }).waitFor()
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      assert.ok(Math.abs((await boxOf(bar('Расчёт привода'))).x - left) <= 1)
      assert.equal(taskRow(backend, 'G1').start_at, before.start_at)
    })
    await check('gantt: concurrent change is not overwritten; fresh dates are shown', async () => {
      // Another participant changes the deadline after this page loaded.
      const other = at(9, '15:00')
      taskRow(backend, 'G1').due_at = other
      const from = await center(bar('Расчёт привода'))
      await dragMouse(page, from, { x: from.x + 40, y: from.y })
      await page.mouse.up()
      await page.getByText('уже изменил другой участник').first().waitFor()
      assert.equal(taskRow(backend, 'G1').due_at, other)
      const expected = await page.evaluate((iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), other)
      await page.waitForFunction((text) => [...document.querySelectorAll('.gantt-bar')].some((el) => el.getAttribute('aria-label')?.includes(text)), expected)
    })
    await check('gantt: keyboard ArrowRight moves by one day', async () => {
      const before = taskRow(backend, 'G1').start_at
      await bar('Расчёт привода').focus()
      const count = tasksPatches(backend, 'G1').length
      const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/tasks') && r.request().method() === 'PATCH')
      await page.keyboard.press('ArrowRight')
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      assert.equal(tasksPatches(backend, 'G1').length, count + 1)
      assert.equal(new Date(taskRow(backend, 'G1').start_at).getTime() - new Date(before).getTime(), DAY)
    })
    await check('gantt: single-date task is a marker; missing dates are offered, not invented', async () => {
      assert.ok(await bar('Закупка деталей').evaluate((el) => el.classList.contains('is-point')))
      const box = page.locator('h4', { hasText: 'Задачи без полного срока' }).locator('..')
      assert.ok((await box.innerText()).includes('Закупка деталей'))
      assert.equal(taskRow(backend, 'G2').start_at, null)
    })
    await check('gantt: «Назначить сроки» saves dates entered by the user', async () => {
      const item = page.locator('.gantt li', { hasText: 'Закупка деталей' })
      await item.getByRole('button', { name: 'Назначить сроки' }).click()
      await item.getByLabel('Начало').fill(`${tomskDate(4)}T10:00`)
      const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/tasks') && r.request().method() === 'PATCH')
      await item.getByRole('button', { name: 'Сохранить' }).click()
      await saved
      await page.waitForFunction(() => !document.querySelector('.gantt-bar.is-saving'))
      assert.equal(new Date(taskRow(backend, 'G2').start_at).toISOString(), at(4, '10:00'))
      assert.equal(new Date(taskRow(backend, 'G2').due_at).toISOString(), at(6, '12:00'))
    })
    await check('gantt: the regular edit form refuses a deadline before the start', async () => {
      const card = page.locator('.task-card', { hasText: 'Закупка деталей' })
      await card.getByRole('button', { name: 'Редактировать' }).click()
      // In edit mode the title is an input value, so locate the card being edited by its date fields.
      const editing = page.locator('.task-card:has(input[type="datetime-local"])')
      const inputs = editing.locator('input[type="datetime-local"]')
      await inputs.nth(0).fill(`${tomskDate(8)}T10:00`)
      await inputs.nth(1).fill(`${tomskDate(7)}T10:00`)
      const count = tasksPatches(backend, 'G2').length
      await editing.getByRole('button', { name: 'Сохранить' }).click()
      await page.getByText('Дедлайн не может быть раньше начала.').first().waitFor()
      assert.equal(tasksPatches(backend, 'G2').length, count)
      await editing.getByRole('button', { name: 'Отмена' }).click()
    })
    for (const width of [768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await check(`gantt ${width}: chart scrolls inside its own area, opens on today; page has no horizontal overflow`, async () => {
        // Mount at this width, as on a real phone or tablet.
        await page.reload()
        await page.locator('.gantt-bar').first().waitFor()
        await page.locator('.gantt-scroll').scrollIntoViewIfNeeded()
        assert.ok(await noHorizontalOverflow(page))
        assert.ok(await page.locator('.gantt-scroll').evaluate((el) => el.scrollWidth > el.clientWidth))
        const todayShown = await page.locator('.gantt-scroll').evaluate((el) => {
          const today = el.querySelector('.gantt-today').getBoundingClientRect()
          const label = el.querySelector('.gantt-row .gantt-label').getBoundingClientRect()
          return today.left >= label.right && today.left <= el.getBoundingClientRect().right
        })
        assert.ok(todayShown, 'today line is in the visible part of the track')
        await dismissToasts(page)
        await settle(page)
        await page.locator('.gantt').screenshot({ path: `${out}/gantt-${width}.png` })
      })
    }
    await context.close()
    const archived = await openPage(browser, backend, { signed: true })
    await check('gantt: completed project is read-only', async () => {
      await archived.page.goto(base + '/projects/P2')
      await archived.page.locator('.gantt-bar').first().waitFor()
      assert.equal(await archived.page.locator('.gantt-bar.is-editable, .gantt-handle').count(), 0)
      assert.ok(await archived.page.getByText('Изменение недоступно').isVisible())
    })
    await archived.context.close()
  }

  // ---------- Market pages: screenshots of the neutral wording ----------
  {
    const backend = freshBackend()
    for (const width of [1440, 360]) {
      const { context, page } = await openPage(browser, backend, { width, touch: width < 1000 })
      await check(`market ${width}: neutral types and statuses in the catalogue`, async () => {
        await page.goto(base + '/auctions')
        await page.getByRole('heading', { level: 1, name: 'Рынок проектов' }).waitFor()
        await page.getByText('Разработка датчика').waitFor()
        const text = await page.locator('main').innerText()
        for (const word of ['Заказ на разработку', 'Готовый проект', 'Открыто']) assert.ok(text.includes(word), word)
        assert.ok(!/аукцион|ставк[аиуое]|победител/i.test(text))
        assert.ok(await noHorizontalOverflow(page))
        await settle(page); await page.screenshot({ path: `${out}/market-${width}.png`, fullPage: width === 360 })
      })
      await context.close()
    }
  }

  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks: results.length, results, errors }, null, 2))
  console.log('PASS', results.length, 'interface checks (mock API)')
} catch (error) {
  console.error('FAIL', error.message)
  writeFileSync(`${out}/errors.json`, JSON.stringify({ errors, passed: results, failure: error.message, stack: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.stop()
}
