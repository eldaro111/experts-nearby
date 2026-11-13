// Browser checks for the return to a chosen section after sign-in, sign-up with email confirmation,
// magic link, recovery and onboarding, and for the paged project picker on the home page.
// Mock backend only (scripts/tests/ui-harness.mjs): Auth endpoints are simulated in memory, email
// links are opened the way Supabase would redirect to them. This is NOT a check of real Supabase Auth,
// its redirect allow-list or email templates.
// Usage: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium/edge> node scripts/tests/return-ui.mjs
// RETURN_SKIP_BUILD=1 reuses an existing build made with the same fake settings.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, buildApp, checker, createBackend, launchBrowser, newContext, root, startApp } from './ui-harness.mjs'

const PORT = 3006
const out = `${root}/test-results/return`
mkdirSync(out, { recursive: true })
const results = []
const errors = []
const check = checker(results)
const USER = '00000000-0000-4000-8000-0000000000c1'
const NEWBIE = '00000000-0000-4000-8000-0000000000c2'
const OTHER = '00000000-0000-4000-8000-0000000000c3'
const PAGE = 20

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
const pad = (n) => String(n).padStart(2, '0')
const listing = (id, title, createdBy, daysAgo, extra = {}) => ({
  id, title, description: 'Описание', roles_needed: [], skills: [], timezone: 'Asia/Tomsk', created_by: createdBy,
  created_at: iso(daysAgo), deadline_at: null, completed_at: null, project_kind: 'engineering', ...extra,
})

/** One project for USER (P1) and one participation for NEWBIE (Q1); PX belongs to OTHER only. */
function smallSeed() {
  return {
    listings: [listing('P1', 'Проект Ивана', USER, 3), listing('Q1', 'Проект команды', OTHER, 4), listing('PX', 'Чужой закрытый проект', OTHER, 5)],
    applications: [{ id: 'AQ', listing_id: 'Q1', user_id: NEWBIE, status: 'accepted', created_at: iso(2) }],
    profiles: [{ user_id: USER, display_name: 'Иван Иванов' }],
    profiles_collaboration: [{ user_id: USER, display_name: 'Иван Иванов' }, { user_id: OTHER, display_name: 'Олег Сидоров' }],
    profiles_public: [],
    tasks: [],
    project_events: [],
  }
}

/** 55 own projects (3 completed) and 52 participations for the picker; PX is not accessible. */
function bigSeed() {
  const own = Array.from({ length: 55 }, (_, i) => listing(`O${pad(i + 1)}`, `Мой проект ${pad(i + 1)}`, USER, i + 1, i >= 52 ? { completed_at: iso(1) } : {}))
  const theirs = Array.from({ length: 52 }, (_, i) => listing(`M${pad(i + 1)}`, `Чужой проект ${pad(i + 1)}`, OTHER, 100 + i))
  return {
    listings: [...own, ...theirs, listing('PX', 'Чужой закрытый проект', OTHER, 300)],
    applications: theirs.map((project, i) => ({ id: `A${pad(i + 1)}`, listing_id: project.id, user_id: USER, status: 'accepted', created_at: iso(i + 1) })),
    profiles: [{ user_id: USER, display_name: 'Иван Иванов' }],
    profiles_collaboration: [{ user_id: USER, display_name: 'Иван Иванов' }],
    profiles_public: [],
    tasks: [],
    project_events: [],
  }
}

const backendFor = (seed, userId, options = {}) => createBackend(seed, { userId, rpc: { is_site_editor: false, project_file_storage_version: 1, refresh_my_recommendations: { refreshed: true, sent: 0 } }, ...options })

async function openPage(browser, backend, options = {}) {
  const context = await newContext(browser, backend, options)
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { context, page }
}

const tokenFor = (userId) => {
  const claims = Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  return `eyJhbGciOiJIUzI1NiJ9.${claims}.test`
}
/** Password sign-in through the mock Auth endpoint (the newest route wins over the harness route). */
async function allowPasswordSignIn(context, userId) {
  await context.route('https://pilot-test.supabase.co/auth/v1/token**', (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
    body: JSON.stringify({ access_token: tokenFor(userId), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test', user: { id: userId, email: 'test@example.ru', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} } }),
  }))
}
/** The page Supabase would redirect to from the email: redirect_to plus implicit-flow tokens. */
const emailLink = (redirectTo, userId, type) => `${redirectTo}#access_token=${tokenFor(userId)}&expires_in=3600&refresh_token=test&token_type=bearer&type=${type}`
/** `redirect_to` of the last request to an Auth endpoint (signup, otp, recover). */
function redirectTo(backend, endpoint) {
  const entry = [...backend.log].reverse().find((e) => e.method === 'POST' && e.path === `/auth/v1/${endpoint}`)
  assert.ok(entry, `no request to /auth/v1/${endpoint}`)
  return new URLSearchParams(entry.query).get('redirect_to')
}
async function fillProfile(page) {
  await page.getByLabel('Имя и фамилия', { exact: true }).waitFor()
  await page.getByLabel('Имя и фамилия', { exact: true }).fill('Анна Новикова')
  const price = page.getByLabel('Стоимость от, ₽', { exact: true })
  if (await price.count()) await price.fill('1000')
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click()
}
const signInForm = async (page) => {
  await page.locator('#auth-email').fill('test@example.ru')
  await page.locator('#auth-password').fill('test-password')
  await page.locator('form button[type="submit"]').click()
}
const at = (path) => (url) => `${url.pathname}${url.search}${url.hash}` === path

let server
let browser
try {
  browser = await launchBrowser()
  const env = appEnv(PORT)
  if (process.env.RETURN_SKIP_BUILD !== '1') await buildApp(env)
  server = await startApp(PORT, env)
  const base = server.base

  // ===================== Return after sign-in (mock Auth) =====================
  {
    const backend = backendFor(smallSeed(), NEWBIE)
    const { context, page } = await openPage(browser, backend)
    await check('password, new account: onboarding comes first, then the chosen section', async () => {
      await page.goto(base + '/')
      await page.getByRole('button', { name: /План работ/ }).click()
      await page.waitForURL(at('/auth?next=%2F%3Fworkspace%3Dplan'))
      await allowPasswordSignIn(context, NEWBIE)
      await signInForm(page)
      await page.waitForURL(at('/onboarding?next=%2F%3Fworkspace%3Dplan'))
      await fillProfile(page)
      await page.waitForURL(at('/projects/Q1#plan'), { timeout: 15000 })
      assert.ok(backend.tables.profiles.some((p) => p.user_id === NEWBIE), 'profile saved before the destination')
    })
    await context.close()
  }
  {
    const backend = backendFor(smallSeed(), NEWBIE)
    const { context, page } = await openPage(browser, backend)
    await check('sign-up with email confirmation: the link carries the destination; onboarding, then the section', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('/?workspace=team'))
      await page.getByRole('button', { name: 'Создать аккаунт' }).click()
      await page.locator('#auth-email').fill('new@example.ru')
      await page.locator('#auth-password').fill('long-password-1')
      await page.locator('#auth-password-confirm').fill('long-password-1')
      await page.locator('form button[type="submit"]').click()
      await page.getByText('Письмо для подтверждения отправлено').waitFor()
      const link = redirectTo(backend, 'signup')
      assert.equal(link, `${base}/auth/callback?type=signup&next=%2F%3Fworkspace%3Dteam`)
      await page.goto(emailLink(link, NEWBIE, 'signup'))
      await page.waitForURL(at('/onboarding?next=%2F%3Fworkspace%3Dteam'))
      await fillProfile(page)
      await page.waitForURL(at('/listings/Q1#members'), { timeout: 15000 })
    })
    await context.close()
  }
  {
    const backend = backendFor(smallSeed(), USER)
    const { context, page } = await openPage(browser, backend)
    await check('magic link with a profile: the link opens the chosen section', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('/?workspace=materials'))
      await page.locator('#auth-email').fill('test@example.ru')
      await page.getByRole('button', { name: 'Получить ссылку для входа' }).click()
      await page.getByText('Ссылка для входа отправлена').waitFor()
      const link = redirectTo(backend, 'otp')
      assert.equal(link, `${base}/auth/callback?type=magiclink&next=%2F%3Fworkspace%3Dmaterials`)
      await page.goto(emailLink(link, USER, 'magiclink'))
      await page.waitForURL(at('/projects/P1#materials'), { timeout: 15000 })
    })
    await context.close()
  }
  {
    const backend = backendFor(smallSeed(), NEWBIE)
    const { context, page } = await openPage(browser, backend)
    await check('magic link without a profile: password setup, then onboarding, then the section; other pages wait', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('/?workspace=materials'))
      await page.locator('#auth-email').fill('new@example.ru')
      await page.getByRole('button', { name: 'Получить ссылку для входа' }).click()
      await page.getByText('Ссылка для входа отправлена').waitFor()
      await page.goto(emailLink(redirectTo(backend, 'otp'), NEWBIE, 'magiclink'))
      await page.waitForURL(at('/auth/set-password?next=%2Fonboarding%3Fnext%3D%252F%253Fworkspace%253Dmaterials'))
      // The password step cannot be skipped: other pages redirect back to it.
      const blocked = await page.request.get(base + '/projects/Q1')
      assert.equal(new URL(blocked.url()).pathname, '/auth/set-password')
      await page.getByPlaceholder('Минимум 8 символов').fill('new-password-1')
      await page.getByPlaceholder('Повторите новый пароль').fill('new-password-1')
      await page.getByRole('button', { name: 'Сохранить и продолжить' }).click()
      await page.waitForURL(at('/onboarding?next=%2F%3Fworkspace%3Dmaterials'))
      assert.ok(backend.log.some((e) => e.method === 'PUT' && e.path === '/auth/v1/user'), 'password saved first')
      await fillProfile(page)
      await page.waitForURL(at('/projects/Q1#materials'), { timeout: 15000 })
    })
    await context.close()
  }
  {
    const backend = backendFor(smallSeed(), USER)
    const { context, page } = await openPage(browser, backend)
    await check('recovery: a new password first, then the chosen section', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('/?workspace=plan'))
      await page.locator('#auth-email').fill('test@example.ru')
      await page.getByRole('button', { name: 'Забыли пароль?' }).click()
      await page.getByText('Письмо для сброса пароля отправлено').waitFor()
      const link = redirectTo(backend, 'recover')
      assert.equal(link, `${base}/auth/callback?type=recovery&next=%2F%3Fworkspace%3Dplan`)
      await page.goto(emailLink(link, USER, 'recovery'))
      await page.waitForURL(at('/auth/set-password?next=%2F%3Fworkspace%3Dplan'))
      const blocked = await page.request.get(base + '/projects/P1')
      assert.equal(new URL(blocked.url()).pathname, '/auth/set-password')
      await page.getByPlaceholder('Минимум 8 символов').fill('new-password-2')
      await page.getByPlaceholder('Повторите новый пароль').fill('new-password-2')
      await page.getByRole('button', { name: 'Сохранить и продолжить' }).click()
      await page.waitForURL(at('/projects/P1#plan'), { timeout: 15000 })
    })
    await context.close()
  }
  {
    const backend = backendFor(smallSeed(), USER)
    const { context, page } = await openPage(browser, backend)
    await check('same browser: a link that lost `next` still returns once; the kept copy is used only once', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('/?workspace=plan'))
      await page.locator('#auth-email').fill('test@example.ru')
      await page.getByRole('button', { name: 'Получить ссылку для входа' }).click()
      await page.getByText('Ссылка для входа отправлена').waitFor()
      // As if the email template ignored the redirect parameters.
      await page.goto(emailLink(`${base}/auth/callback?type=magiclink`, USER, 'magiclink'))
      await page.waitForURL(at('/projects/P1#plan'), { timeout: 15000 })
      await page.goto(emailLink(`${base}/auth/callback?type=magiclink`, USER, 'magiclink'))
      await page.waitForURL(at('/profile'), { timeout: 15000 })
    })
    await check('unsafe or looping destinations are refused', async () => {
      await allowPasswordSignIn(context, USER)
      for (const next of ['//evil.example/x', 'https://evil.example', '/auth/callback?type=recovery', '/\\evil.example']) {
        await page.goto(base + '/auth?next=' + encodeURIComponent(next))
        await signInForm(page)
        await page.waitForURL(at('/profile'), { timeout: 15000 })
      }
      await page.goto(emailLink(`${base}/auth/callback?type=magiclink&next=${encodeURIComponent('https://evil.example')}`, USER, 'magiclink'))
      await page.waitForURL(at('/profile'), { timeout: 15000 })
      // set-password accepts only a same-site path as well.
      await context.addCookies([{ name: 'needs_pw_setup', value: '1', url: base }])
      await page.goto(base + '/auth/set-password?next=' + encodeURIComponent('/\\evil.example'))
      await page.getByPlaceholder('Минимум 8 символов').fill('new-password-3')
      await page.getByPlaceholder('Повторите новый пароль').fill('new-password-3')
      await page.getByRole('button', { name: 'Сохранить и продолжить' }).click()
      await page.waitForURL(at('/profile'), { timeout: 15000 })
      assert.equal(new URL(page.url()).host, new URL(base).host)
    })
    await check('a destination in a project without access opens its public page instead', async () => {
      await page.goto(base + '/auth?next=' + encodeURIComponent('/projects/PX?task=T1#plan'))
      await signInForm(page)
      await page.waitForURL(at('/listings/PX'), { timeout: 15000 })
      await page.goto(base + '/auth?next=' + encodeURIComponent('/projects/P1#materials'))
      await signInForm(page)
      await page.waitForURL(at('/projects/P1#materials'), { timeout: 15000 })
    })
    await context.close()
  }

  // ===================== Paged project picker =====================
  {
    const backend = backendFor(bigSeed(), USER, { strictQueries: true })
    const { context, page } = await openPage(browser, backend, { signed: true })
    const dialog = page.getByRole('dialog', { name: 'План работ: выберите проект' })
    const section = (kind) => dialog.locator(`[data-section="${kind}"]`)
    const titles = (kind) => section(kind).locator('.project-picker-title').allInnerTexts()
    const listingGets = () => backend.log.filter((e) => e.method === 'GET' && e.path === '/rest/v1/listings')

    await check('picker: pages of 20 per section, «Показать ещё» continues to the end without duplicates', async () => {
      await page.goto(base + '/')
      await page.getByText('Проект не выбран').waitFor()
      await page.getByRole('button', { name: /План работ/ }).click()
      await dialog.waitFor()
      await section('owned').locator('.project-picker-item').nth(PAGE - 1).waitFor()
      await section('member').locator('.project-picker-item').nth(PAGE - 1).waitFor()
      assert.equal((await titles('owned')).length, PAGE)
      assert.equal((await titles('member')).length, PAGE)
      // Only one row beyond the page is read, never all projects at once.
      const ownGet = listingGets().find((e) => e.query.includes('created_by=eq.'))
      assert.ok(new URLSearchParams(ownGet.query).get('limit') === String(PAGE + 1), ownGet.query)
      await settle(page); await page.screenshot({ path: `${out}/picker-first-page-1440.png` })
      for (const [kind, sizes] of [['owned', [40, 55]], ['member', [40, 52]]]) {
        for (const size of sizes) {
          await section(kind).getByRole('button', { name: 'Показать ещё' }).click()
          await section(kind).locator('.project-picker-item').nth(size - 1).waitFor()
        }
      }
      await page.waitForFunction(() => !document.querySelector('dialog [data-section] [role=status]'))
      const own = await titles('owned')
      const member = await titles('member')
      assert.equal(own.length, 55)
      assert.equal(new Set(own).size, 55, 'no duplicates')
      assert.equal(member.length, 52)
      assert.equal(new Set(member).size, 52, 'no duplicates')
      assert.equal(await section('owned').getByRole('button', { name: 'Показать ещё' }).count(), 0)
      // Active projects first: the three completed ones close the list.
      assert.deepEqual(own.slice(-3).sort(), ['Мой проект 53', 'Мой проект 54', 'Мой проект 55'])
      assert.ok(!own.includes('Чужой закрытый проект') && !member.includes('Чужой закрытый проект'))
    })
    await check('picker: loading state while the next page loads; an error with a retry', async () => {
      await page.keyboard.press('Escape')
      await page.goto(base + '/')
      await page.getByRole('button', { name: /План работ/ }).click()
      await section('owned').locator('.project-picker-item').nth(PAGE - 1).waitFor()
      backend.delays.push({ method: 'GET', table: 'listings', ms: 700 })
      await section('owned').getByRole('button', { name: 'Показать ещё' }).click()
      await section('owned').getByText('Загружаем ещё…').waitFor()
      assert.equal(await section('owned').getByRole('button', { name: 'Показать ещё' }).count(), 0, 'no second request while loading')
      await section('owned').locator('[role=status]').waitFor({ state: 'detached' })
      backend.delays.length = 0
      assert.equal((await titles('owned')).length, 2 * PAGE)
      backend.failures.push({ method: 'GET', table: 'applications', status: 500, message: 'temporary failure' })
      await section('member').getByRole('button', { name: 'Показать ещё' }).click()
      await section('member').getByRole('alert').filter({ hasText: 'Не удалось загрузить следующие проекты' }).waitFor()
      assert.equal((await titles('member')).length, PAGE, 'loaded items stay')
      await settle(page); await page.screenshot({ path: `${out}/picker-error-1440.png` })
      await section('member').getByRole('button', { name: 'Повторить' }).click()
      await section('member').locator('.project-picker-item').nth(2 * PAGE - 1).waitFor()
      const member = await titles('member')
      assert.equal(member.length, 2 * PAGE)
      assert.equal(new Set(member).size, 2 * PAGE)
    })
    await check('picker: server-side search finds projects beyond the loaded pages in both sections', async () => {
      const before = listingGets().length
      await dialog.getByLabel('Поиск по названию').fill('проект 53')
      await section('owned').locator('.project-picker-title', { hasText: 'Мой проект 53' }).waitFor()
      await dialog.getByLabel('Поиск по названию').fill('Чужой проект 51')
      await section('owned').getByText('Совпадений нет.').waitFor()
      await section('member').locator('.project-picker-title', { hasText: 'Чужой проект 51' }).waitFor()
      await page.waitForFunction(() => !document.querySelector('dialog [data-section] [role=status]'))
      assert.deepEqual(await titles('member'), ['Чужой проект 51'])
      assert.equal((await titles('owned')).length, 0)
      const searches = listingGets().slice(before).filter((e) => e.query.includes('title=ilike'))
      assert.ok(searches.length >= 2, 'search runs on the server')
      await settle(page); await page.screenshot({ path: `${out}/picker-search-1440.png` })
      // Choosing from the results opens the destination.
      await section('member').getByRole('link', { name: /Чужой проект 51/ }).click()
      await page.waitForURL(at('/projects/M51#plan'))
    })
    await check('picker: a remembered project beyond the first page stays the current one', async () => {
      await page.goto(base + '/')
      await page.getByText('Проект: Чужой проект 51').waitFor()
      await page.evaluate((id) => localStorage.setItem(`experts-current-project:${id}`, 'O50'), USER)
      await page.reload()
      await page.getByText('Проект: Мой проект 50').waitFor()
      await page.getByRole('button', { name: /План работ/ }).click()
      await page.waitForURL(at('/projects/O50#plan'))
    })
    await check('picker: a remembered project without access is forgotten, not replaced', async () => {
      await page.goto(base + '/')
      await page.evaluate((id) => localStorage.setItem(`experts-current-project:${id}`, 'PX'), USER)
      await page.reload()
      await page.getByText('Проект не выбран').waitFor()
      assert.equal(await page.evaluate((id) => localStorage.getItem(`experts-current-project:${id}`), USER), null)
    })
    await context.close()
  }

  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks: results.length, results, errors }, null, 2))
  console.log('PASS', results.length, 'return and picker checks (mock API)')
} catch (error) {
  console.error('FAIL', error.message)
  writeFileSync(`${out}/errors.json`, JSON.stringify({ errors, passed: results, failure: error.message, stack: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.stop()
}

async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => null))))
}
