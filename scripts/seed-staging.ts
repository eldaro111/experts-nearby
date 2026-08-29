import { createClient, type User } from '@supabase/supabase-js'

import { FIXTURE_IDS, TEST_USERS, type TestUserKey } from './staging-fixtures'
import { getStagingConfig } from './staging-env'

const config = getStagingConfig()
const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

async function ensureAuthUsers() {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`Unable to list staging users: ${error.message}`)

  const usersByKey = {} as Record<TestUserKey, User>

  for (const fixture of TEST_USERS) {
    let user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === fixture.email.toLowerCase(),
    )

    if (!user) {
      const created = await admin.auth.admin.createUser({
        email: fixture.email,
        password: config.testPassword,
        email_confirm: true,
        user_metadata: { seed: true, seed_role: fixture.key },
      })
      if (created.error || !created.data.user) {
        throw new Error(
          `Unable to create ${fixture.key} staging user: ${created.error?.message ?? 'unknown error'}`,
        )
      }
      user = created.data.user
    } else {
      const updated = await admin.auth.admin.updateUserById(user.id, {
        password: config.testPassword,
        user_metadata: { seed: true, seed_role: fixture.key },
      })
      if (updated.error || !updated.data.user) {
        throw new Error(
          `Unable to refresh ${fixture.key} staging user: ${updated.error?.message ?? 'unknown error'}`,
        )
      }
      user = updated.data.user
    }

    usersByKey[fixture.key] = user
  }

  return usersByKey
}

async function upsertRows(
  table: string,
  rows: Record<string, unknown>[],
  onConflict = 'id',
) {
  const { error } = await admin.from(table).upsert(rows, { onConflict })
  if (error) throw new Error(`Unable to seed ${table}: ${error.message}`)
}

async function main() {
  console.log(`Seeding allowed staging project: ${config.projectRef}`)

  const users = await ensureAuthUsers()
  const ownerId = users.owner.id
  const expertId = users.expert.id
  const applicantId = users.applicant.id
  const outsiderId = users.outsider.id

  await upsertRows(
    'profiles',
    TEST_USERS.map((fixture) => ({
      user_id: users[fixture.key].id,
      display_name: fixture.displayName,
      roles: [...fixture.roles],
      skills: [...fixture.skills],
      timezone: 'Europe/Moscow',
      availability_hours: fixture.key === 'owner' ? 10 : 20,
      links: { github: '', orcid: '' },
      city: fixture.city,
      work_format: 'remote',
      experience_level: fixture.experienceLevel,
      hourly_rate: fixture.key === 'owner' ? null : 2500,
      portfolio_links: [],
      about: `TZ-05 staging fixture: ${fixture.key}`,
      visibility: 'public',
      show_rate: true,
      show_city: true,
      show_portfolio: true,
      show_availability: true,
    })),
    'user_id',
  )

  await upsertRows(
    'user_settings',
    TEST_USERS.map((fixture) => ({
      user_id: users[fixture.key].id,
      notification_prefs: {
        files: true,
        tasks: true,
        reviews: true,
        auctions: true,
        projects: true,
        invitations: true,
      },
      email_prefs: {},
    })),
    'user_id',
  )

  await upsertRows('listings', [
    {
      id: FIXTURE_IDS.project,
      user_id: ownerId,
      created_by: ownerId,
      title: 'Staging: роботизированный ассистент',
      description: 'Тестовый проект для закрытого staging-прогона TZ-05.',
      roles_needed: ['Разработчик', 'Инженер', 'Дизайнер'],
      skills: ['TypeScript', 'Supabase', 'Робототехника'],
      timezone: 'Europe/Moscow',
      visibility: 'public',
      deadline_at: isoDaysFromNow(30),
    },
  ])

  await upsertRows(
    'applications',
    [
      {
        id: FIXTURE_IDS.expertApplication,
        listing_id: FIXTURE_IDS.project,
        user_id: expertId,
        status: 'accepted',
        invited_by_author: false,
        created_at: new Date().toISOString(),
      },
      {
        id: FIXTURE_IDS.applicantApplication,
        listing_id: FIXTURE_IDS.project,
        user_id: applicantId,
        status: 'pending',
        invited_by_author: false,
        created_at: new Date().toISOString(),
      },
    ],
    'listing_id,user_id',
  )

  await upsertRows('tasks', [
    {
      id: FIXTURE_IDS.taskTodo,
      project_id: FIXTURE_IDS.project,
      title: 'Проверить staging workflow',
      description: 'Пройти основные сценарии проекта перед приглашением тестировщиков.',
      status: 'todo',
      assignee_id: expertId,
      start_at: isoDaysFromNow(1),
      due_at: isoDaysFromNow(7),
      penalty_percent: 10,
      excuse_status: 'none',
    },
    {
      id: FIXTURE_IDS.taskDone,
      project_id: FIXTURE_IDS.project,
      title: 'Подготовить baseline',
      description: 'Контрольная задача, уже завершённая в staging fixture.',
      status: 'done',
      assignee_id: expertId,
      start_at: isoDaysFromNow(-5),
      due_at: isoDaysFromNow(-1),
      completed_at: isoDaysFromNow(-2),
      penalty_percent: 10,
      excuse_status: 'none',
    },
  ])

  await upsertRows('project_documents', [
    {
      id: FIXTURE_IDS.document,
      project_id: FIXTURE_IDS.project,
      author_id: ownerId,
      title: 'Staging brief',
      content: 'Документ создан seed-скриптом TZ-05 для проверки раздела документов.',
    },
  ])

  await upsertRows('project_events', [
    {
      id: FIXTURE_IDS.event,
      project_id: FIXTURE_IDS.project,
      created_by: ownerId,
      title: 'Staging review',
      description: 'Ручной прогон E1-E17.',
      event_type: 'meeting',
      starts_at: isoDaysFromNow(3),
      ends_at: isoDaysFromNow(3.05),
    },
  ])

  await upsertRows('project_messages', [
    {
      id: FIXTURE_IDS.messageRoot,
      project_id: FIXTURE_IDS.project,
      author_id: ownerId,
      body: 'Добро пожаловать в staging-проект.',
      is_deleted_for_all: false,
    },
    {
      id: FIXTURE_IDS.messageReply,
      project_id: FIXTURE_IDS.project,
      author_id: expertId,
      body: 'Принято, начинаю тестирование.',
      parent_message_id: FIXTURE_IDS.messageRoot,
      is_deleted_for_all: false,
    },
  ])

  await upsertRows('contributions', [
    {
      id: FIXTURE_IDS.contribution,
      project_id: FIXTURE_IDS.project,
      user_id: expertId,
      task_id: FIXTURE_IDS.taskDone,
      kind: 'development',
      title: 'Проверка baseline',
      description: 'Тестовый подтверждённый вклад.',
      hours: 4,
      verified_by: ownerId,
      verified_at: new Date().toISOString(),
    },
  ])

  await upsertRows('auctions', [
    {
      id: FIXTURE_IDS.requestAuction,
      owner_id: ownerId,
      type: 'request',
      title: 'Staging request: разработка модуля',
      public_summary: 'Нужен специалист для тестового request-аукциона.',
      public_description: 'Публичное описание request-аукциона TZ-05.',
      category: 'Разработка',
      budget_min: 50000,
      budget_max: 90000,
      currency: 'RUB',
      required_roles: ['Разработчик'],
      required_skills: ['TypeScript', 'Supabase'],
      expected_result: 'Рабочий прототип.',
      selection_criteria: 'Качество и срок.',
      deal_type: 'fixed',
      linked_listing_id: FIXTURE_IDS.project,
      status: 'open',
      ends_at: isoDaysFromNow(14),
    },
    {
      id: FIXTURE_IDS.offerAuction,
      owner_id: ownerId,
      type: 'offer',
      title: 'Staging offer: технология компьютерного зрения',
      public_summary: 'Тестовый offer-аукцион с закрытыми материалами.',
      public_description: 'Публичная часть предложения.',
      category: 'R&D',
      budget_min: 100000,
      budget_max: 250000,
      currency: 'RUB',
      required_roles: ['Инвестор', 'Партнёр'],
      required_skills: ['Computer Vision'],
      readiness_level: 'prototype',
      implementation_needs: 'Пилотное внедрение.',
      nda_required: true,
      ip_mode: 'license',
      linked_listing_id: FIXTURE_IDS.project,
      status: 'open',
      ends_at: isoDaysFromNow(21),
    },
  ])

  await upsertRows(
    'auction_protected',
    [
      {
        auction_id: FIXTURE_IDS.offerAuction,
        protected_description: 'Закрытое staging-описание технологии и материалов.',
        protected_links: [{ label: 'Demo', url: 'https://example.com/staging-demo' }],
      },
    ],
    'auction_id',
  )

  await upsertRows(
    'auction_access_requests',
    [
      {
        id: FIXTURE_IDS.offerAccessRequest,
        auction_id: FIXTURE_IDS.offerAuction,
        requester_id: applicantId,
        message: 'Прошу открыть тестовые материалы.',
        status: 'approved',
        reviewed_by: ownerId,
        reviewed_at: new Date().toISOString(),
      },
    ],
    'auction_id,requester_id',
  )

  await upsertRows(
    'auction_bids',
    [
      {
        id: FIXTURE_IDS.requestBid,
        auction_id: FIXTURE_IDS.requestAuction,
        bidder_id: applicantId,
        amount: 70000,
        currency: 'RUB',
        proposed_deadline: isoDaysFromNow(10),
        terms: 'Тестовые условия request-ставки.',
        message: 'Готова выполнить работу.',
        deal_type: 'fixed',
        status: 'new',
      },
      {
        id: FIXTURE_IDS.offerBid,
        auction_id: FIXTURE_IDS.offerAuction,
        bidder_id: expertId,
        amount: 180000,
        currency: 'RUB',
        proposed_deadline: isoDaysFromNow(20),
        terms: 'Тестовые условия offer-ставки.',
        message: 'Готов обсудить пилот.',
        deal_type: 'license',
        status: 'shortlisted',
      },
    ],
    'auction_id,bidder_id',
  )

  await upsertRows(
    'profile_reviews',
    [
      {
        id: FIXTURE_IDS.ownerReview,
        project_id: FIXTURE_IDS.project,
        reviewer_id: ownerId,
        reviewed_user_id: expertId,
        rating: 5,
        text: 'Отличная работа в staging-проекте.',
      },
      {
        id: FIXTURE_IDS.expertReview,
        project_id: FIXTURE_IDS.project,
        reviewer_id: expertId,
        reviewed_user_id: ownerId,
        rating: 5,
        text: 'Понятная постановка задачи.',
      },
    ],
    'project_id,reviewer_id,reviewed_user_id',
  )

  console.log('Staging seed completed.')
  console.log(`Project: ${FIXTURE_IDS.project}`)
  console.log('Test accounts:')
  for (const fixture of TEST_USERS) console.log(`  ${fixture.key}: ${fixture.email}`)
  console.log('Password: value from SEED_TEST_PASSWORD (not printed).')
  console.log(`Outsider user id: ${outsiderId}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Staging seed failed: ${message}`)
  process.exitCode = 1
})
