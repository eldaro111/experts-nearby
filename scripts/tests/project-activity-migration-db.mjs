// ER-SEC-001 limited verification: metadata and legitimate operations only.
// Uses in-memory PGlite. No env files, cloud clients, HTTP calls or file writes.
// Does not import/run the separate unverified project-activity-db.mjs draft.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
const readMigration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const update = readMigration('20261110090000_project_activity_execute.sql')
const diagnostic = readFileSync(new URL('../../supabase/diagnostics/ER-SEC-001-project-activity.sql', import.meta.url), 'utf8')
const functionNames = [
  'append_project_activity_internal', 'trusted_activity_from_task',
  'trusted_activity_from_contribution', 'trusted_activity_from_project_file',
  'trusted_activity_from_profile_review',
]
const owner = '00000000-0000-4000-8000-000000000001'
const member = '00000000-0000-4000-8000-000000000002'
let passed = 0
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const check = async (name, run) => { await run(); passed++; console.log('PASS', name) }
const user = async id => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || ''])
  await db.exec(id ? 'set role authenticated' : 'set role postgres')
}
const admin = () => user(null)
const history = async () => {
  await admin()
  return rows('select * from project_activity order by id')
}
const metadata = () => rows(`select p.oid, p.proname, p.proowner,
  p.prosecdef, p.prokind, p.proconfig, p.prosrc, p.proargtypes::text,
  p.prorettype, p.pronargdefaults, p.proargdefaults::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' order by p.oid`)
const otherACLs = () => rows(`select p.oid,p.proacl::text from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and not (p.proname=any($1::text[])) order by p.oid`, [functionNames])
const triggerMetadata = () => rows(`select t.oid,t.tgrelid,t.tgfoid,t.tgname,t.tgenabled,
  t.tgtype,t.tgisinternal,t.tgargs,t.tgattr::text,t.tgqual::text
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by t.oid`)
const roleMetadata = () => rows('select * from pg_auth_members order by roleid,member,grantor')
const policyMetadata = () => rows('select * from pg_policies where schemaname=\'public\' order by tablename,policyname')
const acl = () => rows(`select p.proname,pg_get_userbyid(p.proowner) as owner,
  has_function_privilege('public',p.oid,'EXECUTE') as public_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('postgres',p.oid,'EXECUTE') as postgres_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`, [functionNames])

try {
  await db.exec(`create publication supabase_realtime;
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),name text,owner_id text,
      metadata jsonb,created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;`)
  for (const name of [
    '20260823110236_baseline_public.sql', '20260823110300_project_files_storage.sql',
    '20261004090000_pilot_feedback.sql', '20261004150000_recommendations.sql',
    '20261019160000_startup_projects.sql', '20261101090000_project_file_compression.sql',
  ]) await db.exec(name.includes('baseline') ? `begin;\n${readMigration(name)}\ncommit;` : readMigration(name))

  for (const [id, name] of [[owner, 'Audit Owner'], [member, 'Audit Member']]) {
    await rows('insert into auth.users(id) values ($1)', [id])
    await rows('insert into profiles(user_id,display_name) values ($1,$2)', [id, name])
  }
  const project = (await rows(`insert into listings(user_id,created_by,title,visibility)
    values ($1,$1,'Legitimate activity regression','private') returning id`, [owner]))[0].id
  await rows("insert into applications(listing_id,user_id,status) values ($1,$2,'accepted')", [project, member])
  await user(owner)
  const oldTask = (await rows("insert into tasks(project_id,title) values ($1,'Existing task') returning id", [project]))[0].id
  const oldHistory = await history()
  assert.equal(oldHistory.length, 1)
  assert.equal(oldHistory[0].type, 'task_created')
  const initialMetadata = await metadata()
  const initialTriggers = await triggerMetadata()
  const initialOtherACLs = await otherACLs()
  const initialRoles = await roleMetadata()
  const initialPolicies = await policyMetadata()

  await check('before: five reviewed functions, postgres owner, effective API-role EXECUTE present', async () => {
    const before = await acl()
    assert.equal(before.length, 5)
    for (const entry of before) {
      assert.equal(entry.owner, 'postgres')
      assert.equal(entry.public_execute, false)
      assert.equal(entry.anon_execute, true)
      assert.equal(entry.authenticated_execute, true)
      assert.equal(entry.postgres_execute, true)
      assert.equal(entry.service_execute, true)
    }
  })
  await check('diagnostics before migration: metadata-only queries run READ ONLY', async () => {
    await db.exec('begin read only')
    const result = await db.exec(diagnostic)
    assert.equal(result.length, 5)
    assert.equal(result[0].rows.length, 5)
    assert.ok(result[0].rows.every(row => row.expected_signature_exists && row.overload_count === 1))
    await db.exec('rollback')
  })
  await check('migration applies successfully to the existing local schema', () => db.exec(update))
  await check('after: PUBLIC/anon/authenticated EXECUTE absent; postgres/service_role retained', async () => {
    const after = await acl()
    assert.equal(after.length, 5)
    for (const entry of after) {
      assert.equal(entry.public_execute, false)
      assert.equal(entry.anon_execute, false)
      assert.equal(entry.authenticated_execute, false)
      assert.equal(entry.postgres_execute, true)
      assert.equal(entry.service_execute, true)
    }
  })
  await check('function definitions/owners/settings, triggers, memberships, other ACLs and RLS are unchanged', async () => {
    assert.deepEqual(await metadata(), initialMetadata)
    assert.deepEqual(await triggerMetadata(), initialTriggers)
    assert.deepEqual(await roleMetadata(), initialRoles)
    assert.deepEqual(await otherACLs(), initialOtherACLs)
    assert.deepEqual(await policyMetadata(), initialPolicies)
    assert.equal((await rows("select relrowsecurity from pg_class where oid='public.project_activity'::regclass"))[0].relrowsecurity, true)
  })
  await check('all pre-existing history records are unchanged after migration', async () => {
    assert.deepEqual(await history(), oldHistory)
  })
  const event = async (type, entity) => {
    const found = await rows('select * from project_activity where project_id=$1 and type=$2 and entity_id=$3', [project, type, entity])
    assert.equal(found.length, 1, `${type}: expected exactly one event`)
    return found[0]
  }
  let task
  await check('normal task create, assignment, status, completion and deletion generate history', async () => {
    await user(owner)
    task = (await rows("insert into tasks(project_id,title) values ($1,'Real task') returning id", [project]))[0].id
    assert.equal((await event('task_created', task)).actor_id, owner)
    await rows('update tasks set assignee_id=$1 where id=$2', [member, task])
    assert.equal((await event('task_assignee_changed', task)).actor_id, owner)
    await user(member)
    await rows("update tasks set status='doing' where id=$1", [task])
    assert.equal((await event('task_status_changed', task)).actor_id, member)
    await rows("update tasks set status='done',completed_at=now() where id=$1", [task])
    assert.equal((await event('task_completed', task)).actor_id, member)
    await user(owner)
    await rows('delete from tasks where id=$1', [oldTask])
    assert.equal((await event('task_deleted', oldTask)).actor_id, owner)
  })
  await check('normal member contribution and owner verification generate history', async () => {
    await user(member)
    const contribution = (await rows(`insert into contributions(project_id,user_id,task_id,title)
      values ($1,$2,$3,'Real contribution') returning id`, [project, member, task]))[0].id
    assert.equal((await event('contribution_added', contribution)).actor_id, member)
    await user(owner)
    await rows('update contributions set verified_by=$1,verified_at=now() where id=$2', [owner, contribution])
    assert.equal((await event('contribution_verified', contribution)).actor_id, owner)
  })
  for (const format of ['raw', 'pack']) {
    await check(`normal ${format} file reserve/finalize/delete generate history`, async () => {
      await user(member)
      const reservation = format === 'raw'
        ? (await rows("select * from reserve_project_file_upload_secure($1,$2,'audit.txt',20)", [member, project]))[0]
        : (await rows("select * from reserve_project_file_pack_secure($1,$2,'assembly.zip',20,100,2,'folder',$3)", [member, project, 'a'.repeat(64)]))[0]
      // Metadata stands in for the real Storage API, as in project-storage-db.mjs.
      await rows("insert into storage.objects(bucket_id,name,owner_id,metadata) values ('project-files',$1,$2,'{\"size\":20}')", [reservation.file_path, member])
      const file = (await rows('select * from finalize_project_file_upload_secure($1,$2)', [member, reservation.reservation_id]))[0].project_file_id
      assert.equal((await event('file_uploaded', file)).actor_id, member)
      await rows('delete from storage.objects where name=$1', [reservation.file_path])
      await rows('select * from delete_project_file_record_secure($1,$2)', [member, file])
      assert.equal((await event('file_deleted', file)).actor_id, member)
    })
  }
  await check('normal completed-project review create/update generate history', async () => {
    await user(owner)
    await rows('update listings set completed_at=now() where id=$1', [project])
    const review = (await rows(`insert into profile_reviews(project_id,reviewer_id,reviewed_user_id,rating,text)
      values ($1,$2,$3,4,'Real review') returning id`, [project, owner, member]))[0].id
    assert.equal((await event('profile_review_created', review)).actor_id, owner)
    await rows("update profile_reviews set rating=5,text='Updated review' where id=$1", [review])
    assert.equal((await event('profile_review_updated', review)).actor_id, owner)
  })
  await check('normal auction bid acceptance retains its separate history path and retry behavior', async () => {
    await user(owner)
    const auction = (await rows("insert into auctions(owner_id,type,title) values ($1,'request','Real auction') returning id", [owner]))[0].id
    await user(member)
    const bid = (await rows('select * from save_auction_bid_secure($1,$2,100)', [member, auction]))[0].bid_id
    await user(owner)
    const accepted = (await rows('select * from accept_auction_bid_secure($1,$2)', [owner, bid]))[0]
    const repeated = (await rows('select * from accept_auction_bid_secure($1,$2)', [owner, bid]))[0]
    assert.equal(repeated.already_completed, true)
    const events = await rows("select * from project_activity where project_id=$1 and type='project_member_added_via_auction'", [accepted.project_id])
    assert.equal(events.length, 1)
    assert.equal(events[0].entity_id, bid)
    assert.equal(events[0].actor_id, owner)
  })
  await check('repeat migration keeps all history, effective rights and original definitions', async () => {
    const before = await history()
    const beforeACL = await acl()
    await db.exec(update)
    assert.deepEqual(await history(), before)
    assert.deepEqual(await acl(), beforeACL)
    assert.deepEqual(await metadata(), initialMetadata)
    assert.deepEqual(await triggerMetadata(), initialTriggers)
    assert.deepEqual(await otherACLs(), initialOtherACLs)
    assert.deepEqual(await roleMetadata(), initialRoles)
    assert.deepEqual(await policyMetadata(), initialPolicies)
    const originals = (await history()).filter(row => oldHistory.some(old => old.id === row.id))
    assert.deepEqual(originals, oldHistory)
  })
  await check('diagnostics after migration: no effective client EXECUTE or history-write privilege', async () => {
    await db.exec('begin read only')
    const result = await db.exec(diagnostic)
    assert.equal(result.length, 5)
    assert.ok(result[0].rows.every(row => row.public_execute === false))
    assert.ok(result[2].rows.length >= 10)
    assert.ok(result[2].rows.every(row => row.effective_execute === false))
    assert.equal(result[3].rows.filter(row => row.trigger_name).length, 4)
    assert.equal(result[4].rows.length, 2)
    assert.ok(result[4].rows.every(row => row.rls_enabled && !row.can_insert && !row.can_update
      && !row.can_delete && !row.can_truncate && !row.can_create_history_trigger))
    await db.exec('rollback')
  })
  console.log(`${passed} limited migration checks passed; PGlite only; extended security draft NOT run.`)
} catch (error) {
  console.error('FAIL limited migration verification:', error.message)
  process.exitCode = 1
} finally { await db.close() }
