// Browser checks of the ER-012 planning interface on a MOCK API (scripts/tests/planning-mock.mjs).
// Real PostgREST, Supabase Auth/RLS and two real accounts are NOT involved; the SQL rules are tested in
// PGlite (planning-client-db.mjs). External HTTP/WS are blocked by ui-harness.mjs.
// Usage: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chromium/edge> node scripts/tests/planning-ui.mjs
// PLANNING_SKIP_BUILD=1 reuses an existing build made with the same fake settings.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appEnv, buildApp, checker, createBackend, launchBrowser, newContext, noHorizontalOverflow, root, startApp } from './ui-harness.mjs'
import { createPlanningMock } from './planning-mock.mjs'

const PORT = 3007
const out = `${root}/test-results/planning`
mkdirSync(out, { recursive: true })
const results = []
const errors = []
const runCheck = checker(results)
const only = process.env.PLANNING_ONLY ? new RegExp(process.env.PLANNING_ONLY) : null
// Filter only independent fixtures. The original lifecycle checks share state.
const check = (name, fn) => !only || only.test(name) ? runCheck(name,fn) : Promise.resolve()
const USER = '00000000-0000-4000-8000-0000000000d1'
const MEMBER = '00000000-0000-4000-8000-0000000000d2'
const OTHER = '00000000-0000-4000-8000-0000000000d3'
const KEY = 'sb-pilot-test-auth-token'

const iso = (days, hour = 10) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(hour, 0, 0, 0); return d.toISOString() }
const task = (id, title, status, extra = {}) => ({ id, project_id: 'P1', title, description: null, status, assignee_id: USER, created_at: iso(-5 + Number(id.slice(1)) / 10), start_at: null, due_at: null,
  completed_at: status === 'done' ? iso(-1) : null, penalty_percent: 10, excuse_reason: null, excuse_status: 'none', excuse_decided_by: null, excuse_decided_at: null,
  stage_id: null, story_points: null, planned_hours: null, planning_version: 1, ...extra })
function seed({ planningColumns = true } = {}) {
  const tasks = [
    task('T1', 'Собрать требования', 'todo', { start_at: iso(1, 2), due_at: iso(2, 11) }),
    task('T2', 'Сделать эскиз', 'doing'),
    task('T3', 'Расчёт привода', 'doing', { start_at: iso(1, 3), due_at: iso(3, 11) }),
    task('T4', 'Согласовать бюджет', 'done'),
    task('T5', 'Заказать детали', 'todo'),
  ]
  if (!planningColumns) for (const t of tasks) { delete t.stage_id; delete t.story_points; delete t.planned_hours; delete t.planning_version }
  return {
    listings: [{ id: 'P1', title: 'Робот-манипулятор', description: 'Описание', roles_needed: [], skills: [], timezone: 'Asia/Tomsk', created_by: USER, created_at: iso(-10), deadline_at: null, completed_at: null, project_kind: 'engineering' }],
    applications: [{ id: 'A1', listing_id: 'P1', user_id: MEMBER, status: 'accepted', created_at: iso(-9) }],
    profiles: [{ user_id: USER }, { user_id: MEMBER }],
    profiles_collaboration: [{ user_id: USER, display_name: 'Иван Иванов' }, { user_id: MEMBER, display_name: 'Анна Петрова' }, { user_id: OTHER, display_name: 'Олег Сидоров' }],
    profiles_public: [], tasks, project_events: [], project_activity: [], notifications: [], project_files: [], project_documents: [], contributions: [], project_reviews: [],
  }
}
const rpcStatic = { is_site_editor: false, project_file_storage_version: 1, refresh_my_recommendations: { refreshed: true, sent: 0 } }

async function open(browser, backend, mock, options = {}) {
  const context = await newContext(browser, backend, { signed: true, ...options })
  await mock.install(context)
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${options.width || 1440}: ${e.message}`))
  return { context, page }
}
const session = (id) => id ? {
  access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`,
  refresh_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id, email: 'test@example.ru' },
} : null
/** Another tab's SDK auth notification through the installed SDK channel (mock Auth). */
const switchUser = (page, id) => page.evaluate(({ key, value }) => {
  if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key)
  const channel = new BroadcastChannel(key)
  channel.postMessage({ event: value ? 'SIGNED_IN' : 'SIGNED_OUT', session: value })
  channel.close()
}, { key: KEY, value: session(id) })
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))))
const shot = async (page, name, locator) => { await settle(page); await (locator ?? page).screenshot({ path: `${out}/${name}.png` }) }
const calls = (mock, fn) => mock.calls.filter((c) => c.fn === fn)

/** A real page load: going to the same address with only another #hash would not reload anything. */
async function openProject(page, base, hash = '#planning') {
  await page.goto(`${base}/projects/P1${hash}`)
  await page.reload()
  const panel = page.locator('#planning')
  await panel.locator('.planning-head').waitFor()
  return panel
}
const tab = (panel, name) => panel.getByRole('tab', { name, exact: true })
const notice = (scope, text) => scope.locator('.planning-notice').filter({ hasText: text }).first()

let server
let browser
try {
  browser = await launchBrowser()
  const env = appEnv(PORT)
  if (process.env.PLANNING_SKIP_BUILD !== '1') await buildApp(env)
  server = await startApp(PORT, env)
  const base = server.base

  const tables = seed()
  const backend = createBackend(tables, { userId: USER, rpc: rpcStatic, strictQueries: true })
  const mock = createPlanningMock(tables)
  const owner = await open(browser, backend, mock)
  let panel

  await check('simple project without settings: defaults, no sprint tabs, nothing written', async () => {
    panel = await openProject(owner.page, base)
    await panel.locator('.planning-mode-badge', { hasText: 'Простой' }).waitFor()
    assert.equal(await tab(panel, 'Бэклог').count(), 0)
    assert.equal(await panel.getByRole('radio', { name: /^Простой/ }).isChecked(), true)
    assert.equal(mock.calls.filter((c) => c.fn !== 'get_project_backlog').length, 0, 'opening writes nothing')
    await panel.getByText('Изменения других участников появятся после обновления').waitFor()
  })

  await check('estimates in the shared task card in simple mode: named arguments, saved after reload, shown on the board', async () => {
    const page = owner.page
    await page.getByRole('button', { name: 'Карточка задачи «Собрать требования»' }).click()
    const dialog = page.getByRole('dialog', { name: 'Собрать требования' })
    await dialog.getByRole('heading', { name: 'Планирование' }).waitFor()
    await dialog.getByText('Не оценено').first().waitFor()
    await dialog.getByRole('button', { name: 'Изменить оценку' }).click()
    await dialog.getByLabel('Story Points').selectOption('5')
    await dialog.getByLabel('Плановые часы').fill('1,234')
    await dialog.getByRole('button', { name: 'Сохранить оценку' }).click()
    await notice(dialog, 'Плановые часы: число больше 0').waitFor()
    assert.equal(calls(mock, 'edit_task_planning').length, 0, 'invalid hours are not sent')
    await dialog.getByLabel('Плановые часы').fill('1,5')
    await dialog.getByRole('button', { name: 'Сохранить оценку' }).click()
    await notice(dialog, 'Оценка сохранена.').waitFor()
    const call = calls(mock, 'edit_task_planning')[0]
    assert.deepEqual(Object.keys(call.args), ['p_task_id', 'p_expected_version', 'p_stage_id', 'p_story_points', 'p_planned_hours'])
    assert.deepEqual([call.args.p_expected_version, call.args.p_story_points, call.args.p_planned_hours], [1, 5, 1.5])
    await dialog.getByText('5 SP').waitFor()
    await dialog.getByText('1,5 ч').waitFor()
    await dialog.getByText('Фактические часы (по вкладам)').waitFor()
    await shot(page, 'task-card-estimate-1440', dialog)
    await page.keyboard.press('Escape')
    await page.locator('[data-task-card="T1"] .task-estimate', { hasText: '5 SP' }).waitFor()
    await page.reload()
    await page.locator('[data-task-card="T1"] .task-estimate', { hasText: '1,5 ч' }).waitFor()
  })

  await check('author switches to Scrum: default stages, Backlog/Sprints switch; soft WIP shows the excess', async () => {
    panel = await openProject(owner.page, base)
    await panel.getByRole('radio', { name: /^Scrum/ }).check()
    await panel.getByLabel('Цель проекта').fill('Собрать прототип к выставке')
    await panel.getByRole('button', { name: 'Сохранить настройки' }).click()
    await notice(panel, 'Настройки планирования сохранены.').waitFor()
    await tab(panel, 'Бэклог').waitFor()
    await tab(panel, 'Режим и правила').click()
    const stages = panel.locator('.planning-stage')
    assert.deepEqual(await stages.locator('.planning-stage-head strong').allTextContents(), ['К выполнению', 'В работе', 'Готово'])
    const doing = stages.filter({ hasText: 'В работе' }).first()
    await doing.getByRole('button', { name: 'Изменить' }).click()
    await doing.getByLabel('WIP-лимит (необязательно)').fill('1')
    await doing.getByRole('button', { name: 'Сохранить этап' }).click()
    await notice(panel, 'Этап сохранён.').waitFor()
    assert.ok(tables.tasks.every((t) => t.stage_id === null), 'switching mode does not assign legacy tasks')
    for (const title of ['Сделать эскиз', 'Расчёт привода']) {
      await owner.page.getByLabel(`Этап задачи «${title}»`).selectOption({ label: 'В работе' })
      await owner.page.getByLabel(`Этап задачи «${title}»`).isEnabled()
      await owner.page.waitForFunction(() => !document.querySelector('[data-task-card] select:disabled'))
    }
    await panel.locator('.planning-wip.is-over', { hasText: 'превышен лимит (мягкий режим)' }).waitFor()
    await shot(owner.page, 'planning-settings-1440', panel)
  })

  await check('settings conflict: fresh data shown, the person chooses to save over it', async () => {
    const row = tables.project_planning.find((r) => r.project_id === 'P1')
    Object.assign(row, { goal: 'Цель другого участника', version: row.version + 1 })
    await panel.getByLabel('Критерии готовности (Definition of Done)').fill('Проверено вторым участником')
    await panel.getByRole('button', { name: 'Сохранить настройки' }).click()
    await notice(panel, 'Данные уже изменились').waitFor()
    await panel.getByText('Сейчас на сервере').waitFor()
    const before = calls(mock, 'update_project_planning').length
    await panel.getByRole('button', { name: 'Сохранить мои значения поверх новых' }).click()
    await notice(panel, 'Настройки планирования сохранены.').waitFor()
    assert.equal(calls(mock, 'update_project_planning').length, before + 1, 'one explicit repeat')
    assert.equal(row.definition_of_done, 'Проверено вторым участником')
  })

  await check('backlog: keyboard reorder saved as a whole list and kept after reload; conflict offers to re-apply', async () => {
    await tab(panel, 'Бэклог').click()
    const order = () => panel.locator('.planning-list .planning-task-link').allTextContents()
    assert.deepEqual(await order(), ['Собрать требования', 'Сделать эскиз', 'Расчёт привода', 'Заказать детали'])
    await panel.locator('[data-backlog-handle="T5"]').focus()
    await owner.page.keyboard.press('ArrowUp')
    await owner.page.keyboard.press('ArrowUp')
    assert.equal(await owner.page.evaluate(() => document.activeElement?.getAttribute('data-backlog-handle')), 'T5', 'focus follows the moved task')
    assert.deepEqual(await order(), ['Собрать требования', 'Заказать детали', 'Сделать эскиз', 'Расчёт привода'])
    await panel.getByText('Порядок изменён, но ещё не сохранён.').waitFor()
    await panel.getByRole('button', { name: 'Сохранить порядок' }).click()
    await notice(panel, 'Порядок бэклога сохранён.').waitFor()
    assert.deepEqual(calls(mock, 'reorder_project_backlog').at(-1).args.p_task_ids, ['T1', 'T5', 'T2', 'T3'])
    await shot(owner.page, 'backlog-1440', panel)
    panel = await openProject(owner.page, base)
    await tab(panel, 'Бэклог').click()
    assert.deepEqual(await order(), ['Собрать требования', 'Заказать детали', 'Сделать эскиз', 'Расчёт привода'])
    // Another member adds a task meanwhile.
    tables.tasks.push(task('T6', 'Проверить крепления', 'todo'))
    tables.project_backlogs.find((b) => b.project_id === 'P1').version += 1
    await panel.getByRole('button', { name: 'Ниже: Собрать требования' }).click()
    await panel.getByRole('button', { name: 'Сохранить порядок' }).click()
    await notice(panel, 'Данные уже изменились').waitFor()
    await panel.getByRole('button', { name: 'Применить мой порядок к актуальному списку' }).click()
    await notice(panel, 'Ваш порядок применён к актуальному списку').waitFor()
    await panel.getByRole('button', { name: 'Сохранить порядок' }).click()
    await notice(panel, 'Порядок бэклога сохранён.').waitFor()
    assert.deepEqual(calls(mock, 'reorder_project_backlog').at(-1).args.p_task_ids, ['T5', 'T1', 'T2', 'T3', 'T6'], 'new task kept, nothing lost')
  })

  await check('sprint cycle: create, add existing tasks, start explicitly, complete with a decision per unfinished task', async () => {
    const page = owner.page
    await tab(panel, 'Спринты').click()
    await panel.getByRole('button', { name: 'Новый спринт' }).click()
    const form = panel.getByRole('form', { name: 'Новый спринт' })
    await form.getByLabel('Цель спринта').fill('Первая сборка')
    await form.getByLabel('Начало').fill('2026-12-01T09:00')
    await form.getByLabel('Окончание').fill('2026-12-14T18:30')
    await form.getByRole('button', { name: 'Создать спринт' }).click()
    await notice(panel, 'Спринт создан.').waitFor()
    await panel.getByRole('button', { name: 'Новый спринт' }).click()
    await panel.getByRole('form', { name: 'Новый спринт' }).getByRole('button', { name: 'Создать спринт' }).click()
    await notice(panel, 'Спринт создан.').waitFor()
    const create = calls(mock, 'create_project_sprint_once')[0].args
    assert.equal(new Date(create.p_start_at).getTime(), new Date('2026-12-01T09:00:00+07:00').getTime(), 'device zone, time of day kept')

    await tab(panel, 'Бэклог').click()
    for (const title of ['Собрать требования', 'Сделать эскиз', 'Заказать детали']) await panel.getByRole('checkbox', { name: `Выбрать задачу «${title}»` }).check()
    await panel.getByLabel('Добавить выбранные задачи в спринт').selectOption({ label: 'Спринт 1' })
    await panel.getByRole('button', { name: 'Добавить (3)' }).click()
    await notice(panel, 'Задачи добавлены в спринт «Спринт 1».').waitFor()
    assert.deepEqual(calls(mock, 'add_tasks_to_sprint')[0].args.p_tasks.map((t) => t.task_id).sort(), ['T1', 'T2', 'T5'])

    await tab(panel, 'Спринты').click()
    const s1 = panel.getByRole('region', { name: 'Спринт 1' })
    await s1.getByText('Состав: 3').waitFor()
    assert.equal(calls(mock, 'start_project_sprint').length, 0, 'planned dates do not start the sprint')
    await s1.getByRole('button', { name: 'Начать спринт' }).click()
    await s1.getByRole('button', { name: 'Да, начать спринт' }).click()
    await notice(panel, 'Спринт начат').waitFor()
    await s1.locator('.planning-state', { hasText: 'Идёт' }).waitFor()
    await shot(page, 'sprint-active-1440', panel)

    // A task is finished on the board meanwhile.
    await page.getByLabel('Этап задачи «Сделать эскиз»').selectOption({ label: 'Готово' })
    await page.locator('[data-task-card="T2"]').getByText('Завершено:').waitFor()
    await s1.getByRole('button', { name: 'Завершить спринт' }).click()
    const dialog = page.getByRole('dialog', { name: 'Завершение спринта: Спринт 1' })
    await dialog.waitFor()
    assert.deepEqual((await dialog.locator('.planning-decisions .planning-label').evaluateAll((els) => els.map((el) => el.firstChild.textContent.trim()))).sort(), ['Заказать детали', 'Собрать требования'], 'only unfinished tasks need a decision')
    await dialog.getByRole('button', { name: 'Проверить итог' }).click()
    await notice(dialog, 'Выберите решение для каждой незавершённой задачи.').waitFor()
    await dialog.getByLabel(/Собрать требования/).selectOption('backlog')
    await dialog.getByLabel(/Заказать детали/).selectOption({ label: 'Перенести в Спринт 2' })
    await shot(page, 'close-dialog-1440', dialog)
    await dialog.getByRole('button', { name: 'Проверить итог' }).click()
    await dialog.getByText('Шаг 2 из 2: проверьте итог').waitFor()
    assert.equal(calls(mock, 'close_project_sprint_once').length, 0, 'nothing sent before the confirmation')
    await dialog.getByRole('button', { name: 'Подтвердить завершение' }).click()
    await notice(panel, 'Спринт завершён. Итоги сохранены.').waitFor()
    const close = calls(mock, 'close_project_sprint_once')[0].args
    assert.equal(close.p_cancel, false)
    const s2 = tables.project_sprints.find((s) => s.number === 2)
    assert.deepEqual([...close.p_decisions].sort((a, b) => a.task_id.localeCompare(b.task_id)), [{ task_id: 'T1', destination: 'backlog' }, { task_id: 'T5', destination: 'sprint', sprint_id: s2.id, expected_sprint_version: 1 }])
    assert.equal(tables.tasks.find((t) => t.id === 'T1').status, 'todo', 'statuses are not changed')
  })

  await check('closed sprint results come from snapshots and stay unchanged after a task edit and a reload', async () => {
    const page = owner.page
    const results = panel.locator('.planning-results')
    await results.waitFor()
    const rows = () => results.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim()).slice(0, 2).concat(tr.children[3].textContent.trim())))
    const before = await rows()
    assert.deepEqual(before.map((r) => r[1]).sort(), ['Возвращена в бэклог', 'Выполнена', 'Перенесена в спринт: Спринт 2'].sort())
    await shot(page, 'sprint-results-1440', panel.locator('.planning-closed'))
    // Later estimate of a finished task (it was not estimated at closing).
    await page.getByRole('button', { name: 'Карточка задачи «Сделать эскиз»' }).click()
    const card = page.getByRole('dialog', { name: 'Сделать эскиз' })
    await card.getByRole('button', { name: 'Изменить оценку' }).click()
    await card.getByLabel('Story Points').selectOption('13')
    await card.getByRole('button', { name: 'Сохранить оценку' }).click()
    await notice(card, 'Оценка сохранена.').waitFor()
    await page.keyboard.press('Escape')
    assert.deepEqual(await rows(), before, 'results unchanged on screen')
    panel = await openProject(page, base)
    await tab(panel, 'Спринты').click()
    const closed = panel.locator('.planning-closed li').filter({ hasText: 'Спринт 1' })
    await closed.getByRole('button', { name: 'Итоги и состав' }).click()
    await panel.locator('.planning-results').waitFor()
    assert.deepEqual(await rows(), before, 'results unchanged after reload')
    assert.equal(await closed.getByRole('button', { name: /Изменить|Начать спринт|Завершить спринт|Отменить спринт|Исключить/ }).count(), 0, 'closed sprint is read only')
    await closed.getByRole('button', { name: 'Показать историю спринта' }).click()
    await closed.locator('.planning-events li').filter({ hasText: 'Спринт завершён' }).waitFor()
  })

  await check('cancellation needs a reason; a lost answer is checked, not sent again', async () => {
    const page = owner.page
    const s2 = panel.getByRole('region', { name: 'Спринт 2' })
    await s2.getByRole('button', { name: 'Отменить спринт' }).click()
    const dialog = page.getByRole('dialog', { name: 'Отмена спринта: Спринт 2' })
    await dialog.getByLabel(/Заказать детали/).selectOption('backlog')
    await dialog.getByRole('button', { name: 'Проверить итог' }).click()
    await notice(dialog, 'Для отмены спринта укажите причину.').waitFor()
    await dialog.getByLabel('Причина отмены (обязательно)').fill('Заказ деталей перенесён')
    await dialog.getByRole('button', { name: 'Проверить итог' }).click()
    mock.faults.push({ fn: 'close_project_sprint_once', mode: 'drop' })
    await dialog.getByRole('button', { name: 'Подтвердить отмену' }).click()
    await notice(panel, 'Закрытие подтверждено по идентификатору операции').waitFor()
    assert.equal(calls(mock, 'close_project_sprint_once').filter((c) => c.args.p_cancel).length, 1, 'sent exactly once')
    await panel.locator('.planning-closed li').filter({ hasText: 'Спринт 2' }).locator('.planning-state', { hasText: 'Отменён' }).waitFor()
  })

  await check('roles: author assigns a Product Owner and delegates; delegation is the author’s only', async () => {
    await tab(panel, 'Режим и правила').click()
    // The name of a select inside its label also contains the chosen option: match the label start.
    await panel.getByLabel(/^Product Owner/).selectOption({ label: 'Анна Петрова' })
    await notice(panel, 'Роль сохранена.').waitFor()
    assert.deepEqual(tables.project_roles, [{ project_id: 'P1', user_id: MEMBER, role: 'product_owner' }])
  })

  const member = await open(browser, createBackend(tables, { userId: MEMBER, rpc: rpcStatic, strictQueries: true }), mock)
  await check('member: read-only settings; a Product Owner reorders the backlog but manages sprints only with delegation', async () => {
    let p = await openProject(member.page, base)
    await tab(p, 'Режим и правила').click()
    assert.equal(await p.getByRole('radio', { name: /^Scrum/ }).isDisabled(), true)
    assert.equal(await p.getByRole('button', { name: 'Сохранить настройки' }).count(), 0)
    await tab(p, 'Бэклог').click()
    await p.locator('[data-backlog-handle]').first().waitFor()
    await tab(p, 'Спринты').click()
    assert.equal(await p.getByRole('button', { name: 'Новый спринт' }).count(), 0)
    // The author turns delegation on.
    await tab(panel, 'Режим и правила').click()
    await panel.getByRole('checkbox', { name: /Делегировать управление/ }).check()
    await panel.getByRole('button', { name: 'Сохранить настройки' }).click()
    await notice(panel, 'Настройки планирования сохранены.').waitFor()
    await p.getByRole('button', { name: 'Обновить' }).click()
    await p.getByRole('button', { name: 'Новый спринт' }).waitFor()
    assert.equal(await p.getByRole('checkbox', { name: /Делегировать управление/ }).count(), 0, 'not on this tab')
    await tab(p, 'Режим и правила').click()
    assert.equal(await p.getByRole('checkbox', { name: /Делегировать управление/ }).isDisabled(), true, 'delegation stays with the author')
  })

  await check('revoked membership: planning data disappears with a clear state', async () => {
    tables.applications.find((a) => a.user_id === MEMBER).status = 'removed'
    const p = member.page.locator('#planning')
    await p.getByRole('button', { name: 'Обновить' }).click()
    await p.getByText('Нет доступа к планированию проекта.').waitFor()
    assert.equal(await p.locator('.planning-tabs').count(), 0)
    tables.applications.find((a) => a.user_id === MEMBER).status = 'accepted'
  })
  await member.context.close()

  await check('mobile 360: no horizontal overflow; dialog closes with Escape and focus returns to its button', async () => {
    const mobile = await open(browser, backend, mock, { width: 360, height: 780, touch: true })
    const p = await openProject(mobile.page, base)
    await tab(p, 'Спринты').click()
    await p.getByRole('button', { name: 'Новый спринт' }).click()
    await p.getByRole('form', { name: 'Новый спринт' }).getByRole('button', { name: 'Создать спринт' }).click()
    await notice(p, 'Спринт создан.').waitFor()
    assert.ok(await noHorizontalOverflow(mobile.page), 'no horizontal scroll')
    await shot(mobile.page, 'planning-360', p)
    const cancel = p.getByRole('region', { name: /Спринт 3/ }).getByRole('button', { name: 'Отменить спринт' })
    await cancel.focus()
    await mobile.page.keyboard.press('Enter')
    const dialog = mobile.page.getByRole('dialog', { name: /Отмена спринта/ })
    await dialog.waitFor()
    assert.ok(await noHorizontalOverflow(mobile.page))
    await shot(mobile.page, 'close-dialog-360')
    await mobile.page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await mobile.page.evaluate(() => document.activeElement?.textContent?.trim()), 'Отменить спринт')
    await mobile.context.close()
  })

  await check('reduced motion: refreshing shows no animation', async () => {
    const reduced = await open(browser, backend, mock, { reducedMotion: 'reduce' })
    const p = await openProject(reduced.page, base)
    mock.faults.push({ fn: 'project_planning', delayMs: 600 })
    await p.getByRole('button', { name: 'Обновить' }).click()
    await p.getByRole('button', { name: 'Обновляем…' }).waitFor()
    assert.equal(await reduced.page.evaluate(() => document.getAnimations().length), 0)
    await p.getByRole('button', { name: 'Обновить' }).waitFor()
    await reduced.context.close()
  })

  await check('English: planning labels come from the translations', async () => {
    const page = owner.page
    await page.locator('#site-language').selectOption('en')
    const p = page.locator('#planning')
    await tab(p, 'Mode and rules').click()
    await tab(p, 'Backlog').waitFor()
    await tab(p, 'Sprints').waitFor()
    const labels = await p.evaluate((node) => [...node.querySelectorAll('[role=tab], .planning-block-title, .planning-subtitle, .planning-label, legend, button:not(.planning-task-link), .planning-hint')]
      .map((el) => el.textContent.trim()).filter((text) => /[А-Яа-яЁё]/.test(text)))
    // Stage names, member names and goals are user data and keep their language.
    const data = /К выполнению|В работе|Готово|Иван Иванов|Анна Петрова|Олег Сидоров/
    assert.deepEqual(labels.filter((text) => !data.test(text)), [])
    await shot(page, 'planning-en-1440', p)
    await page.locator('#site-language').selectOption('ru')
  })
  await owner.context.close()

  await check('custom stage on the working board: configure, keyboard move, reload, strict WIP/refusal/conflict rollback', async () => {
    const t = seed(), b = createBackend(t, { userId: USER, rpc: rpcStatic, strictQueries: true }), m = createPlanningMock(t)
    t.tasks.push(task('T7','Старый неизвестный статус','legacy-unmapped'))
    const ctx = await open(browser,b,m), page=ctx.page
    let p=await openProject(page,base)
    await p.getByRole('radio',{name:/^Свой процесс/}).check()
    await p.getByRole('button',{name:'Сохранить настройки'}).click()
    await notice(p,'Настройки планирования сохранены.').waitFor()
    await page.locator('[data-task-card="T7"]').getByText('Статус: legacy-unmapped',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('Этап задачи «Старый неизвестный статус»').inputValue(),'unassigned')
    await p.getByRole('button',{name:'Добавить этап'}).click()
    const form=p.getByRole('form',{name:'Новый этап'})
    await form.getByLabel('Название',{exact:true}).fill('Сборка CAD')
    await form.getByLabel('Статус задач в этапе (необязательно)').fill('assembly')
    await form.getByLabel('WIP-лимит (необязательно)').fill('1')
    await form.getByRole('button',{name:'Сохранить этап'}).click()
    await notice(p,'Этап добавлен.').waitFor()
    const stage=t.project_stages.find(s=>s.name==='Сборка CAD'), dates=[t.tasks[0].start_at,t.tasks[0].due_at]
    await page.getByLabel('Этап задачи «Собрать требования»').selectOption(stage.id)
    await page.locator(`[data-stage-id="${stage.id}"] [data-task-card="T1"]`).waitFor()
    p=await openProject(page,base)
    assert.equal(t.tasks.find(x=>x.id==='T7').stage_id,null)
    await page.locator('[data-task-card="T7"]').getByText('Статус: legacy-unmapped',{exact:true}).waitFor()
    await page.locator(`[data-stage-id="${stage.id}"] [data-task-card="T1"]`).waitFor()
    assert.deepEqual([t.tasks[0].start_at,t.tasks[0].due_at],dates)
    await p.getByRole('radio',{name:/^Строг/}).check()
    await p.getByRole('button',{name:'Сохранить настройки'}).click()
    await notice(p,'Настройки планирования сохранены.').waitFor()
    await page.getByLabel('Этап задачи «Заказать детали»').selectOption(stage.id)
    await page.getByText('Превышен строгий WIP-лимит этапа.',{exact:true}).waitFor()
    assert.equal(t.tasks.find(x=>x.id==='T5').stage_id,null)
    assert.equal(await page.getByLabel('Этап задачи «Заказать детали»').inputValue(),'unassigned')
    const moving=t.tasks.find(x=>x.id==='T1');moving.planning_version+=1
    await page.getByLabel('Этап задачи «Собрать требования»').selectOption({label:'В работе'})
    await page.getByText(/Задача изменилась/).first().waitFor()
    assert.equal(await page.getByLabel('Этап задачи «Собрать требования»').inputValue(),stage.id)
    m.faults.push({fn:'edit_task_planning',code:'42501',message:'Нет доступа к задаче.'})
    await page.getByLabel('Этап задачи «Собрать требования»').selectOption({label:'В работе'})
    await page.getByText('Нет доступа к задаче.',{exact:true}).waitFor()
    assert.equal(moving.stage_id,stage.id)
    const grip=page.locator('[data-task-grip="T1"]')
    await grip.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Space')
    await page.locator(`[data-stage-id="${t.project_stages.find(s=>s.category==='done').id}"] [data-task-card="T1"]`).waitFor()
    await page.locator('[data-task-card="T1"]').getByText('Завершено:').waitFor()
    assert.equal(moving.status,'done');assert.ok(moving.completed_at)
    await page.locator('.task-board').evaluate(el=>window.scrollTo({top:el.getBoundingClientRect().top+window.scrollY-160,behavior:'instant'}))
    await settle(page)
    const from=await grip.boundingBox(),target=await page.locator(`[data-stage-id="${stage.id}"]`).boundingBox()
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down()
    await page.mouse.move(target.x+target.width/2,target.y+Math.min(target.height/2,60),{steps:12})
    await page.locator(`[data-stage-id="${stage.id}"].is-drop-target`).waitFor()
    await page.locator('.task-drag-ghost').waitFor();await page.mouse.up()
    await page.waitForFunction(()=>!document.querySelector('[data-task-card="T1"].is-saving'))
    assert.equal(moving.stage_id,stage.id);assert.equal(moving.status,'assembly');assert.equal(moving.completed_at,null)
    await shot(page,'custom-stage-board',page.locator('.task-board'))
    await page.setViewportSize({width:360,height:780})
    assert.ok(await noHorizontalOverflow(page),'custom stage board fits mobile width')
    await page.getByLabel('Этап задачи «Собрать требования»').selectOption({label:'К выполнению'})
    await page.waitForFunction(()=>!document.querySelector('[data-task-card="T1"].is-saving'))
    await page.reload();await page.locator('#planning .planning-mode-badge').waitFor()
    assert.equal(await page.getByLabel('Этап задачи «Собрать требования»').inputValue(),t.project_stages.find(s=>s.category==='todo').id)
    assert.ok(await noHorizontalOverflow(page),'mobile reload keeps layout')
    await ctx.context.close()
  })

  await check('atomic stage and lead UI uses one request; refusal does not partially replace order/role', async () => {
    const t=seed(), b=createBackend(t,{userId:USER,rpc:rpcStatic,strictQueries:true}), m=createPlanningMock(t)
    const ctx=await open(browser,b,m), p=await openProject(ctx.page,base)
    await p.getByRole('radio',{name:/^Kanban/}).check()
    await p.getByRole('button',{name:'Сохранить настройки'}).click();await notice(p,'Настройки планирования сохранены.').waitFor()
    const initial=t.project_stages.map(s=>s.id)
    m.faults.push({fn:'reorder_project_stages',code:'PT409',message:'Состав этапов изменился.'})
    await p.getByRole('button',{name:'Переместить этап ниже: К выполнению'}).click()
    await notice(p,'Данные уже изменились').waitFor()
    assert.deepEqual(t.project_stages.map(s=>s.id),initial)
    await p.getByRole('button',{name:'Переместить этап ниже: К выполнению'}).click()
    await notice(p,'Порядок этапов изменён.').waitFor()
    assert.equal(calls(m,'reorder_project_stages').length,2)
    assert.equal(calls(m,'upsert_project_stage').length,0)
    await p.getByLabel(/^Product Owner/).selectOption({label:'Иван Иванов'});await notice(p,'Роль сохранена.').waitFor()
    m.faults.push({fn:'replace_project_lead',code:'23514',message:'Роль требует действующего членства.'})
    await p.getByLabel(/^Product Owner/).selectOption({label:'Анна Петрова'})
    await notice(p,'Роль требует действующего членства.').waitFor()
    assert.equal(t.project_roles[0].user_id,USER)
    await p.getByLabel(/^Product Owner/).selectOption({label:'Анна Петрова'});await notice(p,'Роль сохранена.').waitFor()
    assert.equal(t.project_roles[0].user_id,MEMBER)
    assert.equal(calls(m,'set_project_role').length,0)
    await ctx.context.close()
  })

  await check('lost create/close answer: absent receipt stays unknown; reload/manual same UUID retry creates no duplicate', async () => {
    const t=seed(), b=createBackend(t,{userId:USER,rpc:rpcStatic,strictQueries:true}), m=createPlanningMock(t)
    const ctx=await open(browser,b,m), page=ctx.page
    let p=await openProject(page,base)
    await p.getByRole('radio',{name:/^Scrum/}).check()
    await p.getByRole('button',{name:'Сохранить настройки'}).click();await notice(p,'Настройки планирования сохранены.').waitFor()
    await tab(p,'Спринты').click();await p.getByRole('button',{name:'Новый спринт'}).click()
    m.faults.push({fn:'create_project_sprint_once',mode:'drop'},{fn:'get_project_planning_request',mode:'null'})
    await p.getByRole('button',{name:'Создать спринт',exact:true}).click()
    await notice(p,'Результат создания пока неизвестен').waitFor()
    assert.equal(calls(m,'create_project_sprint_once').length,1)
    const sent=calls(m,'create_project_sprint_once')[0].args
    p=await openProject(page,base);await tab(p,'Спринты').click();await p.getByRole('button',{name:'Новый спринт'}).click()
    await notice(p,'Сохранён незавершённый запрос создания').waitFor()
    await p.getByRole('button',{name:'Повторить тот же запрос'}).click()
    await notice(p,'Спринт создан.').waitFor()
    assert.deepEqual(calls(m,'create_project_sprint_once')[1].args,sent);assert.equal(t.project_sprints.length,1)
    await p.getByRole('region',{name:'Спринт 1'}).getByRole('button',{name:'Отменить спринт'}).click()
    const dialog=page.getByRole('dialog',{name:'Отмена спринта: Спринт 1'})
    await dialog.getByLabel('Причина отмены (обязательно)').fill('Synthetic')
    await dialog.getByRole('button',{name:'Проверить итог'}).click()
    m.faults.push({fn:'close_project_sprint_once',mode:'drop'},{fn:'get_project_planning_request',mode:'null'})
    await dialog.getByRole('button',{name:'Подтвердить отмену'}).click()
    await notice(dialog,'Результат закрытия пока неизвестен').waitFor()
    assert.equal(calls(m,'close_project_sprint_once').length,1)
    await dialog.getByRole('button',{name:'Проверить результат закрытия'}).click()
    await notice(p,'Закрытие подтверждено по идентификатору операции').waitFor()
    assert.equal(calls(m,'close_project_sprint_once').length,1,'read confirmation does not resend')
    await ctx.context.close()
  })

  await check('server without the planning migrations: a clear unavailable state; board and card still work', async () => {
    const t2 = seed({ planningColumns: false })
    const b2 = createBackend(t2, { userId: USER, rpc: rpcStatic, strictQueries: true })
    const m2 = createPlanningMock(t2, { installed: false })
    const ctx = await open(browser, b2, m2)
    const p = await openProject(ctx.page, base)
    await p.getByText('Планирование пока недоступно на сервере').waitFor()
    await ctx.page.locator('[data-task-card="T1"]').waitFor()
    await shot(ctx.page, 'unavailable-1440', p)
    await ctx.page.getByRole('button', { name: 'Карточка задачи «Собрать требования»' }).click()
    await ctx.page.getByRole('dialog', { name: 'Собрать требования' }).getByText('Оценки задач появятся после обновления базы данных на сервере.').waitFor()
    await ctx.context.close()
  })

  for (const writing of [false,true]) await check(`SPA project switch during ${writing ? 'save' : 'load'}: late P1 response cannot change P2 tasks/settings/notices`, async () => {
    const t=seed();t.listings.push({...t.listings[0],id:'P2',title:'Второй проект'})
    t.tasks.push({...task('T20','Только второй проект','todo'),project_id:'P2'})
    const b=createBackend(t,{userId:USER,rpc:rpcStatic,strictQueries:true}),m=createPlanningMock(t),ctx=await open(browser,b,m),page=ctx.page
    let entered,release,delivered
    const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r),finished=new Promise(r=>delivered=r)
    if(writing) {
      const p=await openProject(page,base)
      await p.getByLabel('Цель проекта').fill('Только первый проект')
      m.faults.push({fn:'update_project_planning',entered,hold,delivered})
      await p.getByRole('button',{name:'Сохранить настройки'}).click()
    } else {
      m.faults.push({fn:'get_project_backlog',entered,hold,delivered})
      await page.goto(`${base}/projects/P1#planning`)
    }
    await started
    await page.evaluate(()=>{window.__planningNavigationProbe='same-document'})
    await page.locator('header a[href="/"]').first().click()
    await page.getByRole('button',{name:'Сменить',exact:true}).click()
    await page.getByRole('dialog',{name:'Выберите проект'}).locator('.project-picker-item').filter({hasText:'Второй проект'}).click()
    await page.getByRole('button',{name:/План работ/}).click()
    const p=page.locator('#planning');await p.locator('.planning-mode-badge').waitFor()
    await page.locator('[data-task-card="T20"]').waitFor()
    release();await finished
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    assert.equal(await page.evaluate(()=>window.__planningNavigationProbe),'same-document','actual client-side navigation')
    assert.equal(new URL(page.url()).pathname,'/projects/P2')
    assert.equal(await page.locator('[data-task-card="T1"]').count(),0)
    assert.equal(await p.getByLabel('Цель проекта').inputValue(),'')
    assert.equal(await p.locator('.planning-notice').count(),0)
    assert.equal(await p.getByRole('button',{name:'Обновить',exact:true}).isEnabled(),true)
    await ctx.context.close()
  })

  await check('account changes while planning loads: the late answer is ignored and the data stays hidden', async () => {
    const t3 = seed()
    const b3 = createBackend(t3, { userId: USER, rpc: rpcStatic, strictQueries: true })
    const m3 = createPlanningMock(t3)
    const ctx = await open(browser, b3, m3)
    m3.faults.push({ fn: 'get_project_backlog', delayMs: 2500 })
    await ctx.page.goto(`${base}/projects/P1#planning`)
    const p = ctx.page.locator('#planning')
    await p.getByText('Загружаем планирование…').waitFor()
    await switchUser(ctx.page, OTHER)
    await p.getByText('Аккаунт изменился в другой вкладке или Вы вышли').waitFor()
    await ctx.page.waitForTimeout(3000)
    assert.equal(await p.locator('.planning-tabs, .planning-mode-badge').count(), 0, 'no data of the previous account')
    await p.getByText('Аккаунт изменился в другой вкладке или Вы вышли').waitFor()
    await shot(ctx.page, 'session-changed-1440', p)
    await ctx.context.close()
  })

  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  writeFileSync(`${out}/${only?'targeted-':''}results.json`, JSON.stringify({ checks: results.length, results, errors }, null, 2))
  console.log('PASS', results.length, 'planning checks (mock API)')
} catch (error) {
  console.error('FAIL', error.message)
  writeFileSync(`${out}/errors.json`, JSON.stringify({ errors, passed: results, failure: error.message, stack: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.stop()
}
