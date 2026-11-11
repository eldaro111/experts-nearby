// ER-001 navigation browser checks.
// Builds and starts the app with fake public Supabase settings; every request to a host
// other than 127.0.0.1 and the fake Supabase host is aborted, and the fake host is answered
// by an in-test mock. No real Auth, database, Storage or Realtime is contacted.
// Set NAV_UI_SKIP_BUILD=1 to reuse an existing .next build made with the same fake settings.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use a locally installed Chromium/Edge.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const port = 3002
const base = `http://127.0.0.1:${port}`
const testEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: 'https://pilot-test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-public-key',
  NEXT_PUBLIC_SITE_URL: base,
}
const next = 'node_modules/next/dist/bin/next'

if (process.env.NAV_UI_SKIP_BUILD !== '1') {
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [next, 'build'], { cwd: root, env: testEnv, stdio: 'inherit' })
    build.once('error', reject)
    build.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`))))
  })
}
const server = spawn(process.execPath, [next, 'start', '--port', String(port), '--hostname', '127.0.0.1'], {
  cwd: root,
  env: testEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { server.kill(); reject(new Error('Server startup timeout')) }, 20000)
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('Ready')) { clearTimeout(timer); resolve() }
  })
  server.once('error', reject)
})

const out = `${root}/test-results/navigation`
mkdirSync(out, { recursive: true })
const browser = await chromium
  .launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  })
  .catch((error) => { server.kill(); throw error })

const userId = '00000000-0000-4000-8000-000000000001'
const errors = []
const results = []
let signOutRequests = 0

async function context({ signed = false, width = 1440, touch = false } = {}) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch })
  if (signed) {
    const claims = Buffer.from(JSON.stringify({
      sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url')
    await c.addInitScript(({ userId, claims }) => localStorage.setItem('sb-pilot-test-auth-token', JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.test`,
      refresh_token: 'test',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: userId, email: 'test@example.ru' },
    })), { userId, claims })
  }
  await c.route('**/*', (route) => {
    const u = new URL(route.request().url())
    return ['127.0.0.1', 'pilot-test.supabase.co'].includes(u.hostname) ? route.continue() : route.abort()
  })
  await c.route('https://pilot-test.supabase.co/**', async (route) => {
    const req = route.request()
    const u = new URL(req.url())
    let data = []
    if (u.pathname === '/auth/v1/user') {
      data = { id: userId, email: 'test@example.ru', app_metadata: { provider: 'email' }, user_metadata: {} }
    } else if (u.pathname.includes('/auth/v1/logout')) {
      signOutRequests++
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
    } else if (u.pathname.includes('/rest/v1/rpc/')) {
      data = u.pathname.endsWith('is_site_editor') ? false : []
    }
    if (Array.isArray(data) && req.headers().accept?.includes('vnd.pgrst.object+json')) data = null
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' },
      body: JSON.stringify(data),
    })
  })
  const page = await c.newPage()
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`))
  return { c, page }
}

async function check(name, fn) {
  await fn()
  results.push(name)
  console.log('PASS', name)
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
const mainBelowHeader = (page) => page.evaluate(() => {
  const header = document.querySelector('.site-header').getBoundingClientRect()
  const main = document.querySelector('#main-content').getBoundingClientRect()
  return main.top >= header.bottom - 1
})
const focusedText = (page) => page.evaluate(() => document.activeElement?.textContent?.trim() || '')
const hrefs = (locator) => locator.locator('a').evaluateAll((links) => links.map((a) => a.getAttribute('href')))

try {
  // ---------- Guest, desktop 1440 ----------
  {
    const { c, page } = await context()
    await page.goto(base + '/')
    await page.locator('h1').first().waitFor()
    const nav = page.getByRole('navigation', { name: 'Основная навигация' })
    const projects = nav.getByRole('button', { name: 'Проекты', exact: true })
    const partners = nav.getByRole('button', { name: 'Вузам и стартапам', exact: true })

    await check('1440 guest: top level items and removed links', async () => {
      assert.ok(await nav.isVisible())
      assert.equal(await nav.getByRole('link', { name: 'Главная', exact: true }).getAttribute('href'), '/')
      assert.equal(await nav.getByRole('link', { name: 'Эксперты', exact: true }).getAttribute('href'), '/experts')
      assert.equal(await nav.getByRole('link', { name: 'Новости', exact: true }).getAttribute('href'), '/news')
      for (const removed of ['Аукционы', 'Помощь', 'События и новости', 'ВУЗам', 'Стартапам']) {
        assert.equal(await nav.getByRole('link', { name: removed, exact: true }).count(), 0, removed)
      }
      assert.equal(await projects.getAttribute('aria-expanded'), 'false')
      assert.equal(await projects.getAttribute('aria-controls'), 'projects-navigation')
      assert.equal(await partners.getAttribute('aria-controls'), 'partners-navigation')
      assert.ok(await page.getByRole('link', { name: 'Поиск по платформе' }).isVisible())
      assert.equal(await page.locator('.header-login').getAttribute('href'), '/auth')
      assert.ok(await noOverflow(page))
      assert.ok(await mainBelowHeader(page))
    })

    await check('1440 guest: «Проекты» opens by click with expected links, no signed-in items', async () => {
      await projects.click()
      assert.equal(await projects.getAttribute('aria-expanded'), 'true')
      const panel = page.locator('#projects-navigation')
      await panel.waitFor()
      assert.deepEqual(await hrefs(panel), ['/listings', '/listings/new', '/auctions'])
      assert.ok(await panel.getByRole('link', { name: 'Рынок проектов', exact: true }).isVisible())
      assert.equal(await panel.getByRole('link', { name: 'Мои проекты' }).count(), 0)
      assert.ok(await noOverflow(page))
      await page.screenshot({ path: `${out}/desktop-1440-projects-open.png` })
    })

    await check('1440: Escape closes and returns focus to the trigger', async () => {
      await page.keyboard.press('Escape')
      assert.equal(await projects.getAttribute('aria-expanded'), 'false')
      assert.equal(await page.locator('#projects-navigation').count(), 0)
      assert.ok(await projects.evaluate((el) => el === document.activeElement))
    })

    await check('1440: keyboard Enter / ArrowDown / End / Tab-out', async () => {
      await projects.focus()
      await page.keyboard.press('Enter')
      assert.equal(await projects.getAttribute('aria-expanded'), 'true')
      await page.keyboard.press('ArrowDown')
      assert.equal(await focusedText(page), 'Каталог проектов')
      await page.keyboard.press('ArrowDown')
      assert.equal(await focusedText(page), 'Создать проект')
      await page.keyboard.press('End')
      assert.equal(await focusedText(page), 'Рынок проектов')
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#projects-navigation').count(), 0, 'menu closes when focus leaves')
      assert.equal(await projects.getAttribute('aria-expanded'), 'false')
    })

    await check('1440: ArrowDown on closed trigger opens and focuses first item', async () => {
      await partners.focus()
      await page.keyboard.press('ArrowDown')
      assert.equal(await partners.getAttribute('aria-expanded'), 'true')
      assert.equal(await focusedText(page), 'Вузам')
      assert.deepEqual(await hrefs(page.locator('#partners-navigation')), ['/universities', '/startups'])
      await page.keyboard.press('Escape')
      assert.ok(await partners.evaluate((el) => el === document.activeElement))
    })

    await check('1440: only one dropdown open; outside click closes', async () => {
      await projects.click()
      await partners.click()
      assert.equal(await projects.getAttribute('aria-expanded'), 'false')
      assert.equal(await partners.getAttribute('aria-expanded'), 'true')
      await page.locator('#main-content').click({ position: { x: 5, y: 300 } })
      assert.equal(await partners.getAttribute('aria-expanded'), 'false')
    })

    await check('1440: selecting «Рынок проектов» opens /auctions and closes the menu', async () => {
      await projects.click()
      await page.locator('#projects-navigation').getByRole('link', { name: 'Рынок проектов' }).click()
      await page.waitForURL(`${base}/auctions`)
      await page.getByRole('heading', { level: 1, name: 'Рынок проектов' }).waitFor()
      assert.equal(await page.locator('#projects-navigation').count(), 0)
      assert.equal(await projects.getAttribute('class').then((v) => v.includes('is-active')), true)
    })

    await check('footer: help kept, news and ethics links removed, other legal links kept', async () => {
      const footer = page.locator('footer')
      const navLinks = await hrefs(footer.getByRole('navigation', { name: 'Навигация в подвале' }))
      assert.ok(navLinks.includes('/help'))
      assert.ok(navLinks.includes('/help/faq'))
      assert.ok(!navLinks.includes('/news'))
      assert.equal(await footer.getByRole('link', { name: 'Помощь', exact: true }).getAttribute('href'), '/help')
      const legal = await hrefs(footer.getByRole('navigation', { name: 'Юридические документы' }))
      assert.deepEqual(legal, ['/legal/site-use', '/legal/privacy', '/legal/terms'])
    })

    await check('routes kept: /legal/ethics, /news, /help, /auctions/new, /startups respond', async () => {
      for (const route of ['/legal/ethics', '/news', '/help', '/help/faq', '/auctions/new', '/startups', '/universities', '/listings', '/listings/new']) {
        const response = await page.request.get(base + route)
        assert.equal(response.status(), 200, route)
      }
      await page.goto(base + '/legal/ethics')
      await page.getByRole('heading', { level: 1, name: 'Этика' }).waitFor()
    })

    await check('guest: no «аукцион» in visible text of market pages', async () => {
      for (const route of ['/', '/auctions', '/auctions/new', '/search']) {
        await page.goto(base + route)
        await page.locator('h1').first().waitFor()
        const text = await page.locator('body').innerText()
        assert.ok(!/аукцион/i.test(text), `${route} still mentions «аукцион»`)
        assert.ok(!/победител|ставк[аиуое]/i.test(text), `${route} still uses bidding vocabulary`)
        assert.equal(await page.locator('svg.lucide-gavel').count(), 0, `${route} still shows a gavel icon`)
      }
    })

    await check('market: neutral type names and FAQ entry', async () => {
      await page.goto(base + '/help/faq')
      await page.getByText('Что такое «Рынок проектов»?').first().waitFor()
      assert.ok(await page.getByText('Как автор объявления выбирает предложение?').first().isVisible())
    })

    await check('English labels for the new navigation', async () => {
      await page.goto(base + '/')
      await page.locator('#site-language').selectOption('en')
      const enProjects = nav.getByRole('button', { name: 'Projects', exact: true })
      await enProjects.waitFor()
      assert.ok(await nav.getByRole('button', { name: 'Universities & startups', exact: true }).isVisible())
      assert.equal(await nav.getByRole('link', { name: 'News', exact: true }).getAttribute('href'), '/news')
      await enProjects.click()
      assert.ok(await page.locator('#projects-navigation').getByRole('link', { name: 'Project market', exact: true }).isVisible())
      assert.ok(await page.locator('footer').getByRole('link', { name: 'Help', exact: true }).isVisible())
      await page.screenshot({ path: `${out}/desktop-1440-projects-open-en.png` })
      await page.goto(base + '/auctions')
      await page.locator('h1').first().waitFor()
      assert.ok(!/auction/i.test(await page.locator('body').innerText()), 'English /auctions mentions auction')
      await page.goto(base + '/')
      await page.keyboard.press('Escape')
      await page.locator('#site-language').selectOption('ru')
    })
    await c.close()
  }

  // ---------- Signed-in, desktop 1440 ----------
  {
    const { c, page } = await context({ signed: true })
    await page.goto(base + '/')
    const account = page.getByRole('button', { name: 'Меню аккаунта' })
    await account.waitFor()
    await check('1440 signed-in: notifications, work bar and «Мои проекты»', async () => {
      await page.getByRole('button', { name: 'Уведомления' }).waitFor()
      assert.ok(await page.getByRole('navigation', { name: 'Рабочие разделы' }).getByRole('link', { name: 'Объявления и предложения' }).isVisible())
      const projects = page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Проекты', exact: true })
      await projects.click()
      assert.deepEqual(await hrefs(page.locator('#projects-navigation')), ['/listings', '/listings/new', '/auctions', '/dashboard#my-projects'])
      await page.screenshot({ path: `${out}/desktop-1440-signed-projects-open.png` })
      await page.keyboard.press('Escape')
      assert.ok(await noOverflow(page))
      assert.ok(await mainBelowHeader(page))
    })
    await check('signed-in: new listing form uses neutral type names', async () => {
      await page.goto(base + '/auctions/new')
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      assert.ok(await page.getByText('Готовый проект', { exact: true }).first().isVisible())
      assert.ok(await page.getByText('Заказ на разработку', { exact: true }).first().isVisible())
      assert.ok(await page.getByRole('button', { name: 'Разместить объявление' }).isVisible())
      await page.screenshot({ path: `${out}/market-new-listing-1440.png`, fullPage: true })
    })
    await check('signed-in: «Мои проекты» opens the dashboard section', async () => {
      await page.goto(base + '/')
      await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('button', { name: 'Проекты', exact: true }).click()
      await page.locator('#projects-navigation').getByRole('link', { name: 'Мои проекты' }).click()
      await page.waitForURL(`${base}/dashboard#my-projects`)
      await page.locator('#my-projects').waitFor()
      await page.waitForFunction(() => {
        const box = document.getElementById('my-projects')?.getBoundingClientRect()
        return box && box.top >= 0 && box.top < innerHeight
      })
    })
    await check('signed-in: no «аукцион» on dashboard and own listings', async () => {
      for (const route of ['/dashboard', '/auctions/my', '/auctions/new', '/']) {
        await page.goto(base + route)
        await page.locator('h1').first().waitFor({ timeout: 10000 }).catch(async (error) => {
          await page.screenshot({ path: `${out}/debug-${route.replaceAll('/', '_')}.png`, fullPage: true })
          throw new Error(`${route}: ${error.message.split(String.fromCharCode(10))[0]}`)
        })
        const text = await page.locator('body').innerText()
        assert.ok(!/аукцион/i.test(text), `${route} still mentions «аукцион»`)
      }
    })
    await check('1440 signed-in: account menu keyboard, Escape and sign-out', async () => {
      await account.focus()
      await page.keyboard.press('ArrowDown')
      assert.equal(await account.getAttribute('aria-expanded'), 'true')
      assert.equal(await focusedText(page), 'Мой профиль')
      await page.keyboard.press('Escape')
      assert.equal(await account.getAttribute('aria-expanded'), 'false')
      assert.ok(await account.evaluate((el) => el === document.activeElement))
      await account.click()
      await page.locator('#account-navigation').getByRole('button', { name: 'Выйти' }).click()
      await page.waitForURL(`${base}/auth`)
      assert.ok(signOutRequests >= 1)
    })
    await c.close()
  }

  // ---------- Touch / mobile layouts: 360 and 768 ----------
  for (const width of [360, 768]) {
    const { c, page } = await context({ width, touch: true })
    await page.goto(base + '/')
    await page.locator('h1').first().waitFor()
    const toggle = page.getByRole('button', { name: 'Открыть навигацию' })
    await check(`${width}: desktop nav hidden, toggle visible, no overflow`, async () => {
      assert.equal(await page.getByRole('navigation', { name: 'Основная навигация' }).isVisible(), false)
      assert.ok(await toggle.isVisible())
      assert.ok(await page.getByRole('link', { name: 'Поиск по платформе' }).isVisible())
      assert.ok(await page.locator('.header-login').isVisible())
      assert.ok(await noOverflow(page))
      assert.ok(await mainBelowHeader(page))
    })
    await check(`${width}: tap opens menu and submenus`, async () => {
      await toggle.tap()
      const mobile = page.locator('#mobile-navigation')
      await mobile.waitFor()
      const close = page.getByRole('button', { name: 'Закрыть навигацию' })
      assert.equal(await close.getAttribute('aria-expanded'), 'true')
      const projects = mobile.getByRole('button', { name: 'Проекты', exact: true })
      assert.equal(await projects.getAttribute('aria-expanded'), 'false')
      await projects.tap()
      assert.equal(await projects.getAttribute('aria-expanded'), 'true')
      assert.deepEqual(await hrefs(page.locator('#mobile-projects-navigation')), ['/listings', '/listings/new', '/auctions'])
      const partners = mobile.getByRole('button', { name: 'Вузам и стартапам', exact: true })
      await partners.tap()
      assert.deepEqual(await hrefs(page.locator('#mobile-partners-navigation')), ['/universities', '/startups'])
      assert.equal(await page.locator('#mobile-projects-navigation').count(), 0, 'one submenu at a time')
      const top = await hrefs(mobile)
      for (const href of ['/', '/experts', '/news', '/search']) assert.ok(top.includes(href), href)
      assert.ok(!top.includes('/help'))
      assert.ok(await noOverflow(page))
      await page.screenshot({ path: `${out}/mobile-${width}-partners-open.png` })
      await projects.tap()
      await page.screenshot({ path: `${out}/mobile-${width}-projects-open.png` })
    })
    await check(`${width}: tapping «Рынок проектов» navigates and closes menu`, async () => {
      await page.locator('#mobile-projects-navigation').getByRole('link', { name: 'Рынок проектов' }).tap()
      await page.waitForURL(`${base}/auctions`)
      await page.getByRole('heading', { level: 1, name: 'Рынок проектов' }).waitFor()
      assert.equal(await page.locator('#mobile-navigation').count(), 0)
      assert.ok(await noOverflow(page))
    })
    await check(`${width}: active group expanded on reopen; Escape closes and restores focus`, async () => {
      await page.getByRole('button', { name: 'Открыть навигацию' }).tap()
      assert.equal(await page.locator('#mobile-navigation').getByRole('button', { name: 'Проекты', exact: true }).getAttribute('aria-expanded'), 'true')
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('#mobile-navigation').count(), 0)
      const reopened = page.getByRole('button', { name: 'Открыть навигацию' })
      assert.ok(await reopened.evaluate((el) => el === document.activeElement))
    })
    await check(`${width}: footer without overflow`, async () => {
      await page.goto(base + '/')
      await page.locator('footer').scrollIntoViewIfNeeded()
      assert.ok(await noOverflow(page))
      await page.screenshot({ path: `${out}/mobile-${width}-home.png`, fullPage: true })
    })
    await c.close()
  }

  // ---------- Signed-in 360 ----------
  {
    const { c, page } = await context({ signed: true, width: 360, touch: true })
    await page.goto(base + '/')
    await page.getByRole('button', { name: 'Меню аккаунта' }).waitFor()
    await check('360 signed-in: header fits with notifications/account; «Мои проекты» in submenu', async () => {
      await page.getByRole('button', { name: 'Уведомления' }).waitFor()
      assert.ok(await noOverflow(page))
      await page.getByRole('button', { name: 'Открыть навигацию' }).tap()
      await page.locator('#mobile-navigation').getByRole('button', { name: 'Проекты', exact: true }).tap()
      assert.deepEqual(await hrefs(page.locator('#mobile-projects-navigation')), ['/listings', '/listings/new', '/auctions', '/dashboard#my-projects'])
      assert.ok(await noOverflow(page))
      await page.screenshot({ path: `${out}/mobile-360-signed-projects-open.png` })
    })
    await c.close()
  }

  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks: results.length, results, errors }, null, 2))
  console.log('PASS', results.length, 'navigation checks (mock API)')
} catch (e) {
  console.error('FAIL', e.message)
  writeFileSync(`${out}/errors.json`, JSON.stringify({ errors, passed: results, failure: e.message }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
}
