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
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [owner, expert, outsider, otherOwner, otherExpert] = [1, 2, 3, 4, 5].map(
  id,
)
async function user(uid, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid || '',
  ])
  await db.exec(`set role ${role}`)
}
async function rows(sql, args = []) {
  return (await db.query(sql, args)).rows
}
async function ok(label, fn) {
  await fn()
  passed++
  console.log('PASS', label)
}
async function deny(label, sql, args = []) {
  await ok(label, async () => {
    await assert.rejects(() => db.query(sql, args))
  })
}
async function feed(uid, kind = 'projects', project = null) {
  await user(uid)
  return rows('select * from get_my_recommendations($1,$2)', [kind, project])
}
async function count(uid, type) {
  await user(uid)
  return Number(
    (
      await rows(
        'select count(*) n from notifications where recipient_id=$1 and type=$2',
        [uid, type],
      )
    )[0].n,
  )
}
async function project(
  uid,
  title,
  skills = ['CAD', 'FEM'],
  roles = ['Инженер'],
  extra = {},
) {
  await user(uid)
  return (
    await rows(
      `insert into listings(user_id,created_by,title,skills,roles_needed,visibility,deadline_at,university_id)
 values($1,$1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        uid,
        title,
        skills,
        roles,
        extra.visibility || 'public',
        extra.deadline || null,
        extra.university || null,
      ],
    )
  )[0].id
}
try {
  await db.query('insert into auth.users(id) select unnest($1::uuid[])', [
    [owner, expert, outsider, otherOwner, otherExpert],
  ])
  for (const uid of [owner, expert, outsider, otherOwner, otherExpert]) {
    await user(uid)
    await db.query(
      "insert into profiles(user_id,display_name) values($1,'Анна Иванова')",
      [uid],
    )
  }
  await user(expert)
  await db.query(
    "update profiles set skills=array[' CAD ','cad','C++'],roles=array[' ИНЖЕНЕР '],availability_hours=10 where user_id=$1",
    [expert],
  )
  const first = await project(owner, 'Первый проект')
  await ok('publication notifies matching expert', async () =>
    assert.equal(await count(expert, 'recommended_project'), 1),
  )
  await ok('publication notifies project owner', async () =>
    assert.equal(await count(owner, 'recommended_expert'), 1),
  )
  await ok(
    'recommendations explain normalized skill and role matches',
    async () => {
      const [r] = await feed(expert)
      assert.equal(r.project_id, first)
      assert.deepEqual(r.matched_skills, ['cad'])
      assert.deepEqual(r.matched_roles, ['инженер'])
      assert.equal(r.score, 60)
    },
  )
  await ok('reverse feed contains correct specialist and project', async () => {
    const [r] = await feed(owner, 'experts')
    assert.equal(r.expert_id, expert)
    assert.equal(r.project_id, first)
  })
  await ok(
    'outsider cannot read either side with a guessed project id',
    async () => {
      assert.deepEqual(await feed(outsider, 'projects', first), [])
      assert.deepEqual(await feed(outsider, 'experts', first), [])
    },
  )
  await user(outsider)
  await deny(
    'cannot forge recommendation notifications',
    "select create_notification_secure($1,$2,$3,'recommended_project','Fake',null,'/recommendations','{}'::jsonb)",
    [expert, outsider, first],
  )
  await deny(
    'internal delivery is not callable by browser',
    'select deliver_recommendations_internal($1)',
    [expert],
  )
  await deny(
    'internal match view is private',
    'select * from recommendation_live',
  )
  await deny(
    'delivery ledger is private',
    'select * from recommendation_deliveries',
  )
  await deny(
    'browser cannot truncate recommendation pairs',
    'truncate recommendation_pairs',
  )
  await user(null, 'anon')
  await deny(
    'guest cannot retrieve recommendations',
    "select * from get_my_recommendations('projects')",
  )
  await user(owner)
  await db.query(
    "update listings set roles_needed=array['инженер'],title='Обновлённый заголовок' where id=$1",
    [first],
  )
  await user(expert)
  await db.query(
    "update profiles set skills=array['CAD','C++'],display_name='Анна Петрова' where user_id=$1",
    [expert],
  )
  await ok('edits do not repeat notifications', async () => {
    assert.equal(await count(expert, 'recommended_project'), 1)
    assert.equal(await count(owner, 'recommended_expert'), 1)
  })
  await ok(
    'feed uses current title and profile instead of stale snapshots',
    async () => {
      const [r] = await feed(owner, 'experts')
      assert.equal(r.expert_name, 'Анна Петрова')
      assert.equal(r.project_title, 'Обновлённый заголовок')
    },
  )
  await user(owner)
  await db.query(
    'insert into user_settings(user_id,notification_prefs) values($1,\'{"recommend_experts":false}\')',
    [owner],
  )
  await user(expert)
  await db.query(
    'insert into user_settings(user_id,notification_prefs) values($1,\'{"recommend_projects":false}\')',
    [expert],
  )
  const second = await project(owner, 'Второй проект')
  await ok('both notification opt-outs are respected', async () => {
    assert.equal(await count(expert, 'recommended_project'), 1)
    assert.equal(await count(owner, 'recommended_expert'), 1)
  })
  await ok('notification opt-out preserves on-demand suggestions', async () =>
    assert.equal((await feed(expert)).length, 2),
  )
  await user(expert)
  await db.query(
    "update profiles set show_rate=false,price_from=9000,price_unit='project' where user_id=$1",
    [expert],
  )
  await ok('hidden service price remains masked', async () => {
    const [r] = await feed(owner, 'experts')
    assert.equal(r.price_from, null)
    assert.equal(r.price_unit, 'negotiable')
  })
  await user(owner)
  await db.query("select dismiss_my_recommendation($1,$2,'experts')", [
    first,
    expert,
  ])
  await ok(
    'dismissing only affects the recipient who requested it',
    async () => {
      assert.equal((await feed(owner, 'experts', first)).length, 0)
      assert.equal((await feed(expert, 'projects', first)).length, 1)
    },
  )
  await user(outsider)
  await deny(
    'outsider cannot hide someone else recommendation',
    "select dismiss_my_recommendation($1,$2,'projects')",
    [second, expert],
  )
  await user(owner)
  await db.query("select restore_my_recommendations('experts')")
  await ok('hidden recommendations can be restored', async () =>
    assert.equal((await feed(owner, 'experts', first)).length, 1),
  )
  await user(expert)
  await db.query("update profiles set visibility='hidden' where user_id=$1", [
    expert,
  ])
  await ok(
    'hidden profile disappears from recommendations immediately',
    async () => assert.deepEqual(await feed(owner, 'experts'), []),
  )
  await ok('old inbox items contain no title or name snapshots', async () => {
    await user(owner)
    const data = JSON.stringify(
      await rows(
        "select title,body,payload from notifications where type='recommended_expert'",
      ),
    )
    assert.ok(!data.includes('Анна'))
    assert.ok(!data.includes('Первый проект'))
    assert.ok(!data.includes('Обновлённый заголовок'))
  })
  await user(expert)
  await db.query(
    "update profiles set visibility='platform_only' where user_id=$1",
    [expert],
  )
  await ok(
    'platform-only profiles may be recommended to signed-in owners',
    async () => assert.equal((await feed(owner, 'experts', first)).length, 1),
  )
  await user(expert)
  await db.query('update profiles set availability_hours=0 where user_id=$1', [
    expert,
  ])
  await ok('zero availability excludes an expert', async () =>
    assert.deepEqual(await feed(owner, 'experts'), []),
  )
  await user(expert)
  await db.query(
    'update profiles set availability_hours=null where user_id=$1',
    [expert],
  )
  await ok('unspecified availability does not exclude an expert', async () =>
    assert.equal((await feed(owner, 'experts', first)).length, 1),
  )
  await user(owner)
  await db.query("update listings set visibility='private' where id=$1", [
    first,
  ])
  await ok('newly private project disappears from both feeds', async () => {
    assert.deepEqual(await feed(expert, 'projects', first), [])
    assert.deepEqual(await feed(owner, 'experts', first), [])
  })
  const expired = await project(
    owner,
    'Истёкший проект',
    ['CAD'],
    ['Инженер'],
    { deadline: '2000-01-01T00:00:00Z' },
  )
  await ok('expired project is not recommended', async () =>
    assert.deepEqual(await feed(expert, 'projects', expired), []),
  )
  const privateId = await project(
    owner,
    'Закрытый проект',
    ['CAD'],
    ['Инженер'],
    { visibility: 'private' },
  )
  await ok('private project cannot generate suggestions', async () =>
    assert.deepEqual(await feed(expert, 'projects', privateId), []),
  )
  const noTags = await project(owner, 'Без требований', [], [])
  await ok('no blind recommendations without matching tags', async () =>
    assert.deepEqual(await feed(expert, 'projects', noTags), []),
  )
  const cOnly = await project(owner, 'Язык С', ['C'], [])
  const cpp = await project(owner, 'Язык C++', ['C++'], [])
  await ok('C and C++ are not conflated', async () => {
    assert.deepEqual(await feed(expert, 'projects', cOnly), [])
    assert.equal((await feed(expert, 'projects', cpp)).length, 1)
  })
  await user(expert)
  await db.query(
    "insert into applications(listing_id,user_id,status) values($1,$2,'pending')",
    [second, expert],
  )
  await ok('existing application excludes a recommendation', async () =>
    assert.deepEqual(await feed(expert, 'projects', second), []),
  )
  await user(owner)
  await db.query(
    "update applications set status='rejected' where listing_id=$1 and user_id=$2",
    [second, expert],
  )
  await ok('rejected application is not promoted again', async () =>
    assert.deepEqual(await feed(expert, 'projects', second), []),
  )
  const finished = await project(owner, 'Завершаемый проект')
  await user(owner)
  await db.query(
    "insert into applications(listing_id,user_id,invited_by_author,status) values($1,$2,true,'pending')",
    [finished, outsider],
  )
  await user(outsider)
  await db.query(
    "update applications set status='accepted' where listing_id=$1 and user_id=$2",
    [finished, outsider],
  )
  await user(owner)
  await db.query('update listings set completed_at=now() where id=$1', [
    finished,
  ])
  await ok('completed project disappears from recommendations', async () =>
    assert.deepEqual(await feed(expert, 'projects', finished), []),
  )
  await user(null, 'postgres')
  const uni = (
    await rows(
      "insert into universities(name) values('Инженерный университет') returning id",
    )
  )[0].id
  await user(expert)
  await db.query('update profiles set university_id=$1 where user_id=$2', [
    uni,
    expert,
  ])
  await user(outsider)
  await db.query('update profiles set university_id=$1 where user_id=$2', [
    uni,
    outsider,
  ])
  const uniProject = await project(
    owner,
    'Вузовский проект',
    ['CAD'],
    ['Инженер'],
    { university: uni },
  )
  await ok('shared university is an explainable bonus', async () => {
    const [r] = await feed(expert, 'projects', uniProject)
    assert.equal(r.university_match, true)
    assert.equal(r.score, 100)
  })
  await ok('same university alone is insufficient', async () =>
    assert.deepEqual(await feed(outsider, 'projects', uniProject), []),
  )
  await user(expert)
  await db.query(
    "update profiles set skills=array['Биохимия'],roles=array['Исследователь'] where user_id=$1",
    [expert],
  )
  await ok('obsolete skill matches are revalidated on read', async () =>
    assert.deepEqual(await feed(expert), []),
  )
  // A new specialist should also notify authors of already published projects.
  const waiting = await project(
    otherOwner,
    'Ждём технолога',
    ['Сварка'],
    ['Технолог'],
  )
  await user(otherExpert)
  await db.query(
    "update profiles set skills=array['Сварка'],roles=array['Технолог'] where user_id=$1",
    [otherExpert],
  )
  await ok('profile update notifies owner of an existing project', async () =>
    assert.equal(await count(otherOwner, 'recommended_expert'), 1),
  )
  await ok(
    'profile update recommends an existing project to the expert',
    async () =>
      assert.equal((await feed(otherExpert, 'projects', waiting)).length, 1),
  )
  const quotaProjects = [waiting]
  for (let i = 0; i < 5; i++)
    quotaProjects.push(
      await project(
        otherOwner,
        `Задача по сварке ${i}`,
        ['Сварка'],
        ['Технолог'],
      ),
    )
  await ok(
    'recipient receives at most three recommendations in 24 hours',
    async () => {
      assert.equal(await count(otherExpert, 'recommended_project'), 3)
      assert.equal(await count(otherOwner, 'recommended_expert'), 3)
    },
  )
  await user(otherExpert)
  await db.query(
    "update notifications set created_at=now()-interval '2 days' where recipient_id=$1",
    [otherExpert],
  )
  await user(otherOwner)
  await db.query('delete from listings where id=$1', [quotaProjects[0]])
  await project(otherOwner, 'Повторное создание', ['Сварка'], ['Технолог'])
  await ok(
    'editing inbox dates and deleting projects cannot reset quota',
    async () => {
      await user(null, 'postgres')
      assert.equal(
        Number(
          (
            await rows(
              'select count(*) n from recommendation_deliveries where recipient_id=$1',
              [otherExpert],
            )
          )[0].n,
        ),
        3,
      )
    },
  )
  await user(null, 'postgres')
  await db.query(
    "update recommendation_deliveries set created_at=now()-interval '25 hours' where recipient_id=any($1::uuid[])",
    [[otherExpert, otherOwner]],
  )
  await user(otherExpert)
  const refresh = (await rows('select refresh_my_recommendations() r'))[0].r
  await ok(
    'next-day refresh delivers previously deferred suggestions',
    async () => assert.ok(refresh.sent > 0 && refresh.sent <= 3),
  )
  const again = (await rows('select refresh_my_recommendations() r'))[0].r
  await ok('refresh is throttled on server', async () =>
    assert.equal(again.refreshed, false),
  )
  await user(null, 'postgres')
  await db.query('delete from recommendation_pairs where expert_id=$1', [
    otherExpert,
  ])
  await db.query('delete from recommendation_refreshes where user_id=$1', [
    otherExpert,
  ])
  await user(otherExpert)
  await db.query('select refresh_my_recommendations()')
  await ok(
    'initial refresh backfills existing profiles and projects',
    async () => assert.ok((await feed(otherExpert)).length > 0),
  )
  // A same-transaction invitation must be seen before notifications are generated.
  await user(null, 'postgres')
  await db.query(
    "update recommendation_deliveries set created_at=now()-interval '25 hours' where recipient_id=$1",
    [otherExpert],
  )
  await user(otherOwner)
  await db.exec('begin')
  const invited = (
    await rows(
      "insert into listings(user_id,created_by,title,skills,roles_needed) values($1,$1,'Прямое приглашение',array['Сварка'],array['Технолог']) returning id",
      [otherOwner],
    )
  )[0].id
  await db.query(
    'insert into applications(listing_id,user_id,invited_by_author) values($1,$2,true)',
    [invited, otherExpert],
  )
  await db.exec('commit')
  await ok(
    'same-transaction invitation produces no redundant recommendation',
    async () => {
      await user(null, 'postgres')
      assert.equal(
        (
          await rows(
            'select * from recommendation_pairs where project_id=$1 and expert_id=$2',
            [invited, otherExpert],
          )
        ).length,
        0,
      )
      assert.equal(
        (
          await rows(
            'select * from recommendation_deliveries where project_id=$1',
            [invited],
          )
        ).length,
        0,
      )
      await user(otherExpert)
      assert.equal((await feed(otherExpert, 'projects', invited)).length, 0)
    },
  )
  const dual = '10000000-0000-4000-8000-000000000006'
  const partner = '10000000-0000-4000-8000-000000000007'
  await user(null, 'postgres')
  await db.query('insert into auth.users(id) select unnest($1::uuid[])', [
    [dual, partner],
  ])
  for (const uid of [dual, partner]) {
    await user(uid)
    await db.query(
      "insert into profiles(user_id,display_name,skills) values($1,'Павел Петров',array['Оптика'])",
      [uid],
    )
  }
  const ownProject = await project(
    dual,
    'Своя оптическая задача',
    ['Оптика'],
    [],
  )
  await project(partner, 'Оптическая задача', ['Оптика'], [])
  await project(partner, 'Ещё оптическая задача', ['Оптика'], [])
  await project(dual, 'Четвёртая оптическая задача', ['Оптика'], [])
  await ok(
    'one shared daily quota covers both recommendation directions',
    async () => {
      assert.equal(await count(dual, 'recommended_project'), 2)
      assert.equal(await count(dual, 'recommended_expert'), 1)
    },
  )
  await ok(
    'a project author is never recommended their own project',
    async () => {
      assert.deepEqual(await feed(dual, 'projects', ownProject), [])
    },
  )
  console.log(`PASS ${passed} recommendation database checks`)
} catch (error) {
  console.error('FAIL', error.message, error.detail || '')
  process.exitCode = 1
} finally {
  await db.close()
}
