import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const db = new PGlite()
await db.exec(`create publication supabase_realtime; create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table storage.buckets(id text primary key,name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
grant all on storage.buckets to service_role;`)
try {
  for (const filename of [
    '20260823110236_baseline_public.sql',
    '20260823110300_project_files_storage.sql',
    '20261004090000_pilot_feedback.sql',
    '20261004150000_recommendations.sql',
    '20261019160000_startup_projects.sql',
  ]) {
    let sql = readFileSync(`${root}/supabase/migrations/${filename}`, 'utf8')
    if (filename.includes('baseline')) sql = `begin;\n${sql}\ncommit;`
    await db.exec(sql)
    console.log('PASS migration', filename)
  }
} catch (e) {
  console.error('MIGRATION FAIL', e.message, e.detail, e.position)
  await db.close()
  process.exit(1)
}
let passed = 0
const ids = Array.from(
  { length: 10 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
)
const [owner, expert, outsider, hidden, platform] = ids
async function user(id, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id || '',
  ])
  await db.exec(`set role ${role}`)
}
async function ok(label, fn) {
  await fn()
  console.log('PASS', label)
  passed++
}
async function rejects(label, fn, pattern) {
  await ok(label, async () => {
    let failure
    try {
      await fn()
    } catch (e) {
      failure = e
    }
    assert.ok(failure, 'Expected rejection')
    if (pattern) assert.match(failure.message, pattern)
  })
}
async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows
}
try {
  await db.query('insert into auth.users(id) select unnest($1::uuid[])', [ids])
  for (const [i, id] of ids.entries()) {
    await user(id)
    await db.query('insert into profiles(user_id,display_name) values($1,$2)', [
      id,
      [
        'Иван Иванов',
        'Анна Петрова',
        'Олег Петров',
        'Сергей Сидоров',
        'Мария Семёнова',
      ][i] || 'Василий Иванов',
    ])
  }
  await user(owner)
  const initialCode = (
    await rows('select expert_code from profiles where user_id=$1', [owner])
  )[0].expert_code
  await ok('registration code generated', async () =>
    assert.match(initialCode, /^ER-\d+$/),
  )
  await rejects(
    'registration code immutable',
    () =>
      db.query("update profiles set expert_code='ER-1' where user_id=$1", [
        owner,
      ]),
    /номер/,
  )
  await rejects(
    'digits rejected in real name',
    () =>
      db.query("update profiles set display_name='Иван0' where user_id=$1", [
        owner,
      ]),
    /Имя/,
  )
  await rejects(
    'basic abusive name rejected',
    () =>
      db.query("update profiles set display_name='Пидор' where user_id=$1", [
        owner,
      ]),
    /оскорб/,
  )
  await ok('compound real name accepted', () =>
    db.query(
      "update profiles set display_name='Анна-Мария О''Нил' where user_id=$1",
      [owner],
    ),
  )
  await ok('upsert preserves registration code', async () => {
    await db.query(
      "insert into profiles(user_id,display_name) values($1,'Иван Иванов') on conflict(user_id) do update set display_name=excluded.display_name",
      [owner],
    )
    assert.equal(
      (
        await rows('select expert_code from profiles where user_id=$1', [owner])
      )[0].expert_code,
      initialCode,
    )
  })
  await rejects(
    'self-verified language cannot be forged',
    () =>
      db.query('update profiles set languages=$1 where user_id=$2', [
        JSON.stringify([{ language: 'English', level: 'C1', verified: true }]),
        owner,
      ]),
    /язык/,
  )
  const uni = (
    await rows(
      "select propose_university_path('Тестовый университет','Инженерная школа','Группа А') as p",
    )
  )[0].p
  await rejects(
    'directory proposals rate limited',
    () => db.query("select propose_university_path('Другой вуз')"),
    /минуту/,
  )
  await user(expert)
  const uni2 = (
    await rows(
      "select propose_university_path('Второй университет','Факультет','Группа Б') as p",
    )
  )[0].p
  await user(owner)
  await rejects(
    'school cannot be attached to another university',
    () =>
      db.query(
        'update profiles set university_id=$1, school_id=$2 where user_id=$3',
        [uni.university_id, uni2.school_id, owner],
      ),
    /foreign key/,
  )
  await db.query(
    "update profiles set university_id=$1,school_id=$2,study_group_id=$3,academic_role='student',price_from=5000,price_unit='project',show_rate=false where user_id=$4",
    [uni.university_id, uni.school_id, uni.study_group_id, owner],
  )
  await user(hidden)
  await db.query("update profiles set visibility='hidden' where user_id=$1", [
    hidden,
  ])
  await user(platform)
  await db.query(
    "update profiles set visibility='platform_only' where user_id=$1",
    [platform],
  )
  await user(null, 'anon')
  await ok('hidden and platform-only profiles hidden from guests', async () =>
    assert.equal(
      (
        await rows(
          'select * from profiles_public where user_id=any($1::uuid[])',
          [[hidden, platform]],
        )
      ).length,
      0,
    ),
  )
  await rejects(
    'registration sequence cannot be changed by guests',
    () => db.query("select setval('expert_code_seq',1)"),
    /permission denied/,
  )
  await ok('private price is masked', async () =>
    assert.equal(
      (
        await rows('select price_from from profiles_public where user_id=$1', [
          owner,
        ])
      )[0].price_from,
      null,
    ),
  )
  await rejects(
    'raw profiles are not publicly readable',
    () => db.query('select * from profiles'),
    /permission denied/,
  )
  await user(outsider)
  await ok('platform-only profile available to signed-in users', async () =>
    assert.equal(
      (await rows('select * from profiles_public where user_id=$1', [platform]))
        .length,
      1,
    ),
  )
  await rejects(
    'ordinary users cannot truncate content',
    () => db.query('truncate publications'),
    /permission denied/,
  )
  await rejects(
    'ordinary users cannot become editors',
    () => db.query('insert into site_editors(user_id) values($1)', [outsider]),
    /permission denied/,
  )
  await rejects(
    'ordinary users cannot publish news',
    () =>
      db.query(
        "insert into publications(title,kind,status,published_at) values('Чужая публикация','news','published',now())",
      ),
    /row-level security/,
  )
  await user(owner)
  await rejects(
    'hidden profile cannot receive unsolicited request',
    () =>
      db.query('select send_contact_request($1,$2)', [
        hidden,
        'Здравствуйте, предлагаем сотрудничество.',
      ]),
    /недоступен/,
  )
  const request = (
    await rows('select send_contact_request($1,$2) as id', [
      expert,
      'Здравствуйте, предлагаем сотрудничество по проекту.',
    ])
  )[0].id
  await rejects(
    'only one initial message per expert',
    () =>
      db.query('select send_contact_request($1,$2)', [
        expert,
        'Здравствуйте, повторное сообщение эксперту.',
      ]),
    /уже отправили/,
  )
  await rejects(
    'browser cannot mutate contact directly',
    () =>
      db.query("update contact_requests set status='accepted' where id=$1", [
        request,
      ]),
    /permission denied/,
  )
  await rejects(
    'project cannot be created before expert agrees',
    () =>
      db.query(
        "select create_project_from_contact($1,'Инженерный проект','Описание инженерного проекта',array[]::text[],array[]::text[],'Europe/Moscow')",
        [request],
      ),
    /согласия/,
  )
  await user(outsider)
  await ok('contact is private to participants', async () =>
    assert.equal(
      (await rows('select * from contact_requests where id=$1', [request]))
        .length,
      0,
    ),
  )
  await rejects(
    'outsider cannot respond to contact',
    () => db.query('select respond_contact_request($1,true)', [request]),
    /недоступно/,
  )
  await user(expert)
  await db.query('select respond_contact_request($1,true,$2)', [
    request,
    'Готова обсудить задачу.',
  ])
  await user(owner)
  const createSql =
    "select create_project_from_contact($1,'Инженерный проект','Описание инженерного проекта',array[]::text[],array[]::text[],'Europe/Moscow',$2,$3,$4) as id"
  const args = [request, uni.university_id, uni.school_id, uni.study_group_id]
  const project = (await rows(createSql, args))[0].id
  await ok('project creation is idempotent', async () =>
    assert.equal((await rows(createSql, args))[0].id, project),
  )
  await ok(
    'accepted inquiry creates an invitation, not automatic membership',
    async () => {
      const [app] = await rows(
        'select * from applications where listing_id=$1',
        [project],
      )
      assert.equal(app.status, 'pending')
      assert.equal(app.invited_by_author, true)
      assert.equal(app.user_id, expert)
    },
  )
  await rejects(
    'cannot complete without accepted participant',
    () =>
      db.query('update listings set completed_at=now() where id=$1', [project]),
    /принятый/,
  )
  await user(expert)
  await db.query(
    "update applications set status='accepted' where listing_id=$1 and user_id=$2",
    [project, expert],
  )
  await user(owner)
  await rejects(
    'review before completion rejected',
    () =>
      db.query(
        'insert into profile_reviews(project_id,reviewer_id,reviewed_user_id,rating) values($1,$2,$3,5)',
        [project, owner, expert],
      ),
    /row-level security/,
  )
  const task = (
    await rows(
      "insert into tasks(project_id,title) values($1,'Выполнить расчёт') returning id",
      [project],
    )
  )[0].id
  await rejects(
    'cannot complete with unfinished task',
    () =>
      db.query('update listings set completed_at=now() where id=$1', [project]),
    /задачи/,
  )
  await db.query("update tasks set status='done' where id=$1", [task])
  await db.query('update listings set completed_at=now() where id=$1', [
    project,
  ])
  await ok('participants may review completed project', () =>
    db.query(
      'insert into profile_reviews(project_id,reviewer_id,reviewed_user_id,rating) values($1,$2,$3,5)',
      [project, owner, expert],
    ),
  )
  await rejects(
    'completed project cannot be reopened',
    () =>
      db.query('update listings set completed_at=null where id=$1', [project]),
    /отменить/,
  )
  await rejects(
    'cannot add participants after completion',
    () =>
      db.query(
        'insert into applications(listing_id,user_id,invited_by_author) values($1,$2,true)',
        [project, outsider],
      ),
    /зафиксированы/,
  )
  await rejects(
    'cannot reopen tasks after completion',
    () => db.query("update tasks set status='todo' where id=$1", [task]),
    /зафиксированы/,
  )
  await user(outsider)
  await rejects(
    'outsider cannot review completed project',
    () =>
      db.query(
        'insert into profile_reviews(project_id,reviewer_id,reviewed_user_id,rating) values($1,$2,$3,5)',
        [project, outsider, expert],
      ),
    /row-level security/,
  )
  await user(owner)
  const privateProject = (
    await rows(
      "insert into listings(user_id,created_by,title,visibility,university_id) values($1,$1,'Закрытый проект','private',$2) returning id",
      [owner, uni.university_id],
    )
  )[0].id
  await user(null, 'anon')
  await ok('university view preserves project privacy', async () =>
    assert.equal(
      (
        await rows('select * from university_projects where id=$1', [
          privateProject,
        ])
      ).length,
      0,
    ),
  )
  await user(owner)
  await rejects(
    'browser cannot reserve portfolio quota',
    () => db.query("select reserve_portfolio_file($1,'file.pdf',10)", [owner]),
    /permission denied/,
  )
  await rejects(
    'browser cannot forge portfolio metadata',
    () =>
      db.query(
        "insert into portfolio_files(user_id,name,storage_path,size_bytes,status) values($1,'x.pdf','x.pdf',1,'ready')",
        [owner],
      ),
    /permission denied/,
  )
  await rejects(
    'browser cannot upload arbitrary storage files',
    () =>
      db.query(
        "insert into storage.objects(bucket_id,name,owner_id) values('portfolio','x.pdf',$1)",
        [owner],
      ),
    /row-level security/,
  )
  await user(null, 'service_role')
  const file = (
    await rows("select * from reserve_portfolio_file($1,'file.pdf',15728640)", [
      owner,
    ])
  )[0]
  await rejects(
    '15 MB quota enforced server-side',
    () => db.query("select reserve_portfolio_file($1,'second.pdf',1)", [owner]),
    /15 МБ/,
  )
  await db.query("update portfolio_files set status='ready' where id=$1", [
    file.id,
  ])
  await db.query(
    "insert into storage.objects(bucket_id,name,owner_id) values('portfolio',$1,$2)",
    [file.storage_path, owner],
  )
  await user(null, 'anon')
  await ok('public portfolio readable through storage policy', async () =>
    assert.equal(
      (await rows("select * from storage.objects where bucket_id='portfolio'"))
        .length,
      1,
    ),
  )
  await user(owner)
  await db.query('update profiles set show_portfolio=false where user_id=$1', [
    owner,
  ])
  await user(null, 'anon')
  await ok('portfolio preference also protects stored objects', async () =>
    assert.equal(
      (await rows("select * from storage.objects where bucket_id='portfolio'"))
        .length,
      0,
    ),
  )
  await db.exec('reset role')
  await db.query('insert into site_editors(user_id) values($1)', [owner])
  await user(owner)
  await db.query(
    "insert into publications(title,kind,status,published_at) values ('Открытая новость','news','published',now()),('Черновик новости','news','draft',null),('Будущая новость','news','published',now()+interval '1 day')",
  )
  await db.query(
    "update legal_documents set body='Согласованный текст',version='1.0',published_at=now() where slug='terms'",
  )
  await user(null, 'anon')
  await ok('only published news visible to guests', async () =>
    assert.equal((await rows('select * from publications')).length, 1),
  )
  await ok('draft legal documents hidden', async () =>
    assert.deepEqual(
      (await rows('select slug from legal_documents')).map((r) => r.slug),
      ['terms'],
    ),
  )
  await user(owner)
  for (const id of [platform, ...ids.slice(5, 8)])
    await db.query('select send_contact_request($1,$2)', [
      id,
      'Здравствуйте, предлагаем обсудить сотрудничество.',
    ])
  await rejects(
    'daily contact limit enforced',
    () =>
      db.query('select send_contact_request($1,$2)', [
        ids[8],
        'Здравствуйте, предлагаем обсудить сотрудничество.',
      ]),
    /пяти/,
  )
  console.log(
    `PASS ${passed} database regression checks (local PostgreSQL engine, simulated Supabase roles)`,
  )
} catch (e) {
  console.error('FAIL', e.message, e.detail || '')
  process.exitCode = 1
} finally {
  await db.close()
}
