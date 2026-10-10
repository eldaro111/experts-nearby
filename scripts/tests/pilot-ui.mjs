import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const testEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: 'https://pilot-test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-public-key',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3001',
}
// Build with explicit fake public credentials; no live Supabase is contacted.
await new Promise((resolve, reject) => {
  const build = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'build'],
    { cwd: root, env: testEnv, stdio: 'inherit' },
  )
  build.once('error', reject)
  build.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`)),
  )
})
const server = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'start',
    '--port',
    '3001',
    '--hostname',
    '127.0.0.1',
  ],
  { cwd: root, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'] },
)
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    server.kill()
    reject(new Error('Server startup timeout'))
  }, 15000)
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('Ready')) {
      clearTimeout(timer)
      resolve()
    }
  })
  server.once('error', reject)
})
const base = 'http://127.0.0.1:3001'
const out = `${root}/test-results/ui`
mkdirSync(out, { recursive: true })
const browser = await chromium
  .launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  })
  .catch((error) => {
    server.kill()
    throw error
  })
const id = '00000000-0000-4000-8000-000000000001'
const uid = '00000000-0000-4000-8000-000000000002'
const profile = {
  user_id: id,
  display_name: 'Иван Иванов',
  expert_code: 'ER-100001',
  roles: ['Инженер'],
  skills: ['CAD'],
  languages: [],
  price_from: null,
  price_unit: 'negotiable',
  portfolio_links: [],
  links: {},
  experience_years: 'none',
  academic_role: null,
  visibility: 'public',
}
const expert = {
  ...profile,
  user_id: uid,
  display_name: 'Анна Петрова',
  expert_code: 'ER-100002',
  price_from: 15000,
  price_unit: 'project',
  university_id: 'uni1',
  school_id: 'school1',
  study_group_id: 'group1',
  university_name: 'Инженерный университет',
  school_name: 'Робототехника',
  study_group_name: 'РТ-01',
  academic_role: 'student',
}
const project = {
  id: 'project1',
  title: 'Разработка робота',
  description: 'Проект по робототехнике для студентов.',
  roles_needed: ['Инженер'],
  skills: ['CAD'],
  university_id: 'uni1',
  school_id: 'school1',
  study_group_id: 'group1',
  university_name: 'Инженерный университет',
  school_name: 'Робототехника',
  study_group_name: 'РТ-01',
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
}
const tables = {
  profiles: [profile],
  listings: [{ ...project, created_by: id, visibility: 'public' }],
  user_settings: [
    { user_id: id, notification_prefs: { tasks: false }, email_prefs: {} },
  ],
  notifications: [
    {
      id: 'notification1',
      recipient_id: id,
      actor_id: null,
      project_id: project.id,
      type: 'recommended_project',
      title: 'Для вас найден подходящий проект',
      body: 'Есть совпадения по навыкам или специализациям. Посмотрите подборку и причины рекомендации.',
      href: '/recommendations?kind=projects',
      payload: {},
      read_at: null,
      created_at: '2026-10-04T00:00:00Z',
    },
  ],
  profiles_public: [
    expert,
    {
      ...expert,
      user_id: 'expert2',
      display_name: 'Олег Иванов',
      expert_code: 'ER-100003',
      price_from: 5000,
    },
    {
      ...expert,
      user_id: 'expert3',
      display_name: 'Сергей Петров',
      expert_code: 'ER-100004',
      price_from: null,
      price_unit: 'negotiable',
    },
  ],
  universities: [
    { id: 'uni1', name: 'Инженерный университет' },
    { id: 'uni2', name: 'Политехнический университет' },
  ],
  university_schools: [
    { id: 'school1', name: 'Робототехника', university_id: 'uni1' },
  ],
  university_groups: [{ id: 'group1', name: 'РТ-01', school_id: 'school1' }],
  university_projects: [project],
  listings_with_count: [project],
  publications: [
    {
      id: 'news1',
      title: 'Инженерный семинар',
      kind: 'seminar',
      summary: 'Обсуждаем инженерную практику.',
      body: 'Программа семинара для студентов и бизнеса.',
      status: 'published',
      published_at: '2026-10-01T00:00:00Z',
    },
  ],
}
const recommendation = {
  project_id: project.id,
  expert_id: uid,
  project_title: project.title,
  project_description: project.description,
  expert_name: expert.display_name,
  expert_code: expert.expert_code,
  price_from: expert.price_from,
  price_unit: expert.price_unit,
  matched_skills: ['cad'],
  matched_roles: ['инженер'],
  university_match: true,
}
const hiddenRecommendations = { projects: false, experts: false }
let savedSettings,
  lastRecommendationRequest,
  failRecommendations = false
let savedProfile,
  signupRequests = 0
const errors = []
const results = []
async function context(signed = false, width = 1440) {
  const c = await browser.newContext({ viewport: { width, height: 1000 } })
  if (signed) {
    const claims = Buffer.from(
      JSON.stringify({
        sub: id,
        aud: 'authenticated',
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url')
    await c.addInitScript(
      ({ id, claims }) =>
        localStorage.setItem(
          'sb-pilot-test-auth-token',
          JSON.stringify({
            access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.test`,
            refresh_token: 'test',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            token_type: 'bearer',
            user: { id, email: 'test@example.ru' },
          }),
        ),
      { id, claims },
    )
  }
  await c.route('**/*', (route) => {
    const u = new URL(route.request().url())
    return ['127.0.0.1', 'pilot-test.supabase.co'].includes(u.hostname)
      ? route.continue()
      : route.abort()
  })
  await c.route('https://pilot-test.supabase.co/**', async (route) => {
    const req = route.request(),
      u = new URL(req.url())
    let data = []
    if (u.pathname === '/auth/v1/user')
      data = {
        id,
        email: 'test@example.ru',
        app_metadata: { provider: 'email' },
        user_metadata: {},
      }
    else if (u.pathname.includes('/auth/v1/signup')) {
      signupRequests++
      data = { user: { id }, session: null }
    } else if (u.pathname.includes('/rest/v1/rpc/')) {
      const rpc = u.pathname.split('/').at(-1)
      const args = req.postDataJSON() || {}
      if (rpc === 'is_site_editor') data = false
      if (rpc === 'refresh_my_recommendations')
        data = { refreshed: true, sent: 0 }
      if (rpc === 'get_my_recommendations') {
        lastRecommendationRequest = args
        if (failRecommendations)
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Test service unavailable' }),
          })
        data = hiddenRecommendations[args.p_kind] ? [] : [recommendation]
      }
      if (rpc === 'dismiss_my_recommendation')
        hiddenRecommendations[args.p_kind] = true
      if (rpc === 'restore_my_recommendations')
        hiddenRecommendations[args.p_kind] = false
    } else {
      const table = u.pathname.split('/').at(-1)
      data = structuredClone(tables[table] || [])
      if (table === 'profiles' && req.method() === 'POST') {
        savedProfile = req.postDataJSON()
        tables.profiles = [{ ...profile, ...savedProfile }]
        data = tables.profiles
      }
      if (table === 'user_settings' && req.method() === 'PATCH') {
        savedSettings = req.postDataJSON()
        tables.user_settings = [
          { ...tables.user_settings[0], ...savedSettings },
        ]
        data = tables.user_settings
      }
      if (table === 'notifications' && req.method() === 'PATCH') {
        tables.notifications = tables.notifications.map((item) => ({
          ...item,
          ...req.postDataJSON(),
        }))
        data = tables.notifications
      }
      for (const [key, value] of u.searchParams) {
        if (value.startsWith('eq.'))
          data = data.filter((row) => String(row[key]) === value.slice(3))
      }
      if (req.headers().accept?.includes('vnd.pgrst.object+json'))
        data = data[0] || null
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'content-range': `0-0/${Array.isArray(data) ? data.length : 1}`,
      },
      body: JSON.stringify(data),
    })
  })
  return c
}
async function check(name, fn) {
  await fn()
  results.push(name)
  console.log('PASS', name)
}
try {
  const c = await context()
  const p = await c.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  for (const [route, name] of [
    ['/', 'home'],
    ['/auth', 'auth'],
    ['/universities', 'universities'],
    ['/experts', 'experts'],
    ['/news', 'news'],
    ['/legal/terms', 'legal'],
  ]) {
    await p.goto(base + route)
    await p.locator('h1').first().waitFor()
    await p.screenshot({ path: `${out}/${name}-desktop.png`, fullPage: true })
    await check(`${route} desktop without overflow`, async () =>
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ),
    )
  }
  await p.goto(base + '/auth?mode=signup')
  await p.getByLabel('Повторите пароль', { exact: true }).waitFor()
  await p
    .getByLabel('Электронная почта', { exact: true })
    .fill('user@example.com')
  await p.getByLabel('Пароль', { exact: true }).fill('ValidPassword123')
  await p.getByLabel('Повторите пароль', { exact: true }).fill('Different123')
  await p
    .getByRole('button', { name: 'Зарегистрироваться', exact: true })
    .click()
  await check('password mismatch stops signup', async () => {
    assert.equal(signupRequests, 0)
    assert.ok(await p.getByText('Пароли не совпадают', { exact: true }).count())
  })
  await p
    .getByRole('button', { name: 'Показать пароль', exact: true })
    .first()
    .click()
  await check('password visibility toggle', async () =>
    assert.equal(
      await p.getByLabel('Пароль', { exact: true }).getAttribute('type'),
      'text',
    ),
  )
  await p.goto(base + '/universities')
  await p.getByLabel('Вуз', { exact: true }).selectOption('uni1')
  await p
    .getByLabel('Направление / инженерная школа', { exact: true })
    .selectOption('school1')
  await p.getByLabel('Учебная группа', { exact: true }).selectOption('group1')
  await check('cascading university filters', async () =>
    assert.ok(
      await p.getByRole('heading', { name: 'Разработка робота' }).isVisible(),
    ),
  )
  await p.getByLabel('Вуз', { exact: true }).selectOption('uni2')
  await check('changing university clears school/group', async () => {
    assert.equal(
      await p.getByLabel('Учебная группа', { exact: true }).inputValue(),
      '',
    )
    assert.ok(
      await p
        .getByText('Подходящих проектов пока нет', { exact: true })
        .isVisible(),
    )
  })
  await p.goto(base + '/experts')
  await p
    .getByLabel('Сортировка по стоимости', { exact: true })
    .selectOption('asc')
  await check('ascending price sorting, negotiable last', async () => {
    const names = await p.locator('.expert-card h2').allTextContents()
    assert.deepEqual(names, ['Олег Иванов', 'Анна Петрова', 'Сергей Петров'])
  })
  await p.goto(base + '/')
  await p.locator('#site-language').selectOption('en')
  await check('English navigation and document language', async () => {
    await p
      .getByRole('link', { name: 'Universities', exact: true })
      .first()
      .waitFor()
    assert.equal(await p.locator('html').getAttribute('lang'), 'en')
  })
  await p.locator('#site-language').selectOption('ru')
  for (const width of [390, 768, 1024]) {
    await p.setViewportSize({ width, height: 844 })
    for (const route of ['/', '/auth', '/universities']) {
      await p.goto(base + route)
      await p.locator('h1').first().waitFor()
      await check(`${route} width ${width} without overflow`, async () =>
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ),
      )
      if (width === 390)
        await p.screenshot({
          path: `${out}/${route === '/' ? 'home' : route.slice(1)}-mobile.png`,
          fullPage: true,
        })
    }
  }
  await c.close()
  const signed = await context(true)
  const form = await signed.newPage()
  form.on('pageerror', (e) => errors.push(e.message))
  await form.goto(base + '/onboarding')
  await form.getByLabel('Имя и фамилия', { exact: true }).waitFor()
  await form.getByLabel('Имя и фамилия', { exact: true }).fill('Иван0')
  await form
    .getByRole('button', { name: 'Сохранить профиль', exact: true })
    .click()
  await check('invalid name rejected before save', async () =>
    assert.equal(savedProfile, undefined),
  )
  await form.getByLabel('Имя и фамилия', { exact: true }).fill('Иван Иванов')
  await form
    .getByLabel('Ваша связь с вузом', { exact: true })
    .selectOption('student')
  await form.getByLabel('Вуз', { exact: true }).selectOption('uni1')
  await form
    .getByLabel('Направление / инженерная школа', { exact: true })
    .selectOption('school1')
  await form
    .getByLabel('Учебная группа', { exact: true })
    .selectOption('group1')
  await form
    .getByLabel('Часовой пояс', { exact: true })
    .selectOption('Asia/Krasnoyarsk')
  await form
    .getByLabel('Условия работы', { exact: true })
    .selectOption('project')
  await form.getByLabel('Стоимость от, ₽', { exact: true }).fill('15000')
  await form.evaluate(() => window.scrollTo(0, 0))
  await form.screenshot({
    path: `${out}/onboarding-desktop.png`,
    fullPage: true,
  })
  await form
    .getByRole('button', { name: 'Сохранить профиль', exact: true })
    .click()
  await form.waitForURL('**/profile')
  await check('university affiliation and project price saved', async () => {
    assert.equal(savedProfile.university_id, 'uni1')
    assert.equal(savedProfile.study_group_id, 'group1')
    assert.equal(savedProfile.price_unit, 'project')
    assert.equal(savedProfile.price_from, 15000)
    assert.ok(!('hourly_rate' in savedProfile))
  })
  await form.goto(base + '/recommendations')
  await form
    .getByRole('heading', { name: project.title, exact: true })
    .waitFor()
  await check(
    'project recommendation explains the match and links to the project',
    async () => {
      assert.ok(
        await form
          .getByRole('heading', { name: 'Почему рекомендуем' })
          .isVisible(),
      )
      assert.ok(
        await form.getByText('Указан общий вуз', { exact: true }).isVisible(),
      )
      assert.equal(
        await form
          .getByRole('link', { name: 'Посмотреть проект' })
          .getAttribute('href'),
        '/listings/project1',
      )
    },
  )
  await form.screenshot({
    path: `${out}/recommendations-desktop.png`,
    fullPage: true,
  })
  await form
    .getByRole('button', {
      name: 'Скрыть рекомендацию: Разработка робота',
      exact: true,
    })
    .click()
  await form
    .getByRole('heading', { name: 'Подходящих рекомендаций пока нет' })
    .waitFor()
  await form
    .getByRole('button', { name: 'Вернуть скрытые рекомендации', exact: true })
    .click()
  await check('hidden recommendation can be restored', async () => {
    await form
      .getByRole('heading', { name: project.title, exact: true })
      .waitFor()
    assert.equal(hiddenRecommendations.projects, false)
  })
  await form
    .getByRole('button', { name: 'Специалисты для проектов', exact: true })
    .click()
  await form
    .getByRole('heading', { name: expert.display_name, exact: true })
    .waitFor()
  await form.getByLabel('Ваш проект', { exact: true }).selectOption(project.id)
  await check(
    'owner can filter specialists by project and contact them',
    async () => {
      await form.waitForURL('**/recommendations?kind=experts&project=project1')
      await form
        .getByRole('heading', { name: expert.display_name, exact: true })
        .waitFor()
      assert.equal(lastRecommendationRequest.p_kind, 'experts')
      assert.equal(lastRecommendationRequest.p_project, project.id)
      assert.equal(
        await form
          .getByRole('link', { name: 'Предложить сотрудничество' })
          .getAttribute('href'),
        `/users/${uid}#contact`,
      )
    },
  )
  await form.setViewportSize({ width: 390, height: 844 })
  await check('recommendations mobile without overflow', async () =>
    assert.ok(
      await form.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ),
  )
  await form.screenshot({
    path: `${out}/recommendations-mobile.png`,
    fullPage: true,
  })
  await form.locator('#site-language').selectOption('en')
  await check(
    'recommendations English navigation and explanation',
    async () => {
      await form
        .getByRole('heading', { name: 'Recommendations', exact: true })
        .waitFor()
      assert.ok(
        await form.getByRole('heading', { name: 'Why this match' }).isVisible(),
      )
    },
  )
  await form.locator('#site-language').selectOption('ru')
  failRecommendations = true
  await form
    .getByRole('button', { name: 'Обновить подборку', exact: true })
    .click()
  await check(
    'recommendation failure hides stale cards and allows retry',
    async () => {
      await form
        .getByRole('alert')
        .filter({ hasText: 'Не удалось загрузить рекомендации' })
        .waitFor()
      assert.equal(await form.locator('.expert-card').count(), 0)
      failRecommendations = false
      await form.getByRole('button', { name: 'Повторить', exact: true }).click()
      await form
        .getByRole('heading', { name: expert.display_name, exact: true })
        .waitFor()
    },
  )
  await form.setViewportSize({ width: 1440, height: 1000 })
  await form.goto(base + '/settings#notifications')
  const projectToggle = form.getByRole('checkbox', {
    name: /^Рекомендации проектов/,
  })
  const expertToggle = form.getByRole('checkbox', {
    name: /^Рекомендации специалистов/,
  })
  await projectToggle.waitFor()
  assert.equal(await projectToggle.isChecked(), true)
  assert.equal(await expertToggle.isChecked(), true)
  await Promise.all([
    form.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/user_settings') &&
        response.request().method() === 'PATCH',
    ),
    projectToggle.uncheck(),
  ])
  await check(
    'recommendation preferences save separately and preserve existing choices',
    async () => {
      assert.equal(savedSettings.notification_prefs.recommend_projects, false)
      assert.equal(savedSettings.notification_prefs.recommend_experts, true)
      assert.equal(savedSettings.notification_prefs.tasks, false)
      await form.reload()
      await projectToggle.waitFor()
      assert.equal(await projectToggle.isChecked(), false)
      assert.equal(await expertToggle.isChecked(), true)
    },
  )
  await form.goto(base + '/notifications')
  await check(
    'recommendation notification opens the correct feed',
    async () => {
      const alert = form
        .locator('article')
        .filter({ hasText: 'Для вас найден подходящий проект' })
      await alert.waitFor()
      assert.ok(
        await alert
          .getByText('Рекомендованный проект', { exact: true })
          .isVisible(),
      )
      await alert.getByRole('button', { name: 'Открыть', exact: true }).click()
      await form.waitForURL('**/recommendations?kind=projects')
      await form
        .getByRole('heading', { name: project.title, exact: true })
        .waitFor()
      assert.ok(tables.notifications[0].read_at)
    },
  )
  await signed.close()
  await check('no browser runtime errors', async () =>
    assert.deepEqual(errors, []),
  )
  writeFileSync(
    `${out}/results.json`,
    JSON.stringify({ checks: results.length, results, errors }, null, 2),
  )
  console.log('PASS', results.length, 'browser checks (mock API)')
} catch (e) {
  console.error('FAIL', e.message)
  writeFileSync(
    `${out}/errors.json`,
    JSON.stringify({ errors, passed: results }, null, 2),
  )
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
}
