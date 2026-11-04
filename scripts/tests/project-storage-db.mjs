import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
const owner = '00000000-0000-4000-8000-000000000001'
const member = '00000000-0000-4000-8000-000000000002'
const outsider = '00000000-0000-4000-8000-000000000003'
const digest = 'a'.repeat(64)
let passed = 0
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
const user = async (id, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || ''])
  await db.exec(`set role ${role}`)
}
const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name) }
const migration = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const update = migration('20261101090000_project_file_compression.sql')

try {
  await db.exec(`create publication supabase_realtime;
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;`)
  for (const name of ['20260823110236_baseline_public.sql','20260823110300_project_files_storage.sql',
    '20261004090000_pilot_feedback.sql','20261004150000_recommendations.sql','20261019160000_startup_projects.sql']) {
    await db.exec(name.includes('baseline') ? `begin;\n${migration(name)}\ncommit;` : migration(name))
  }
  for (const [id, name] of [[owner, 'Иван Иванов'], [member, 'Анна Петрова'], [outsider, 'Олег Петров']]) {
    await db.query('insert into auth.users(id) values ($1)', [id])
    await db.query('insert into profiles(user_id,display_name) values ($1,$2)', [id, name])
  }
  const project = (await rows("insert into listings(user_id,created_by,title,visibility) values ($1,$1,'Сборка','private') returning id", [owner]))[0].id
  const otherProject = (await rows("insert into listings(user_id,created_by,title,visibility) values ($1,$1,'Другой проект','private') returning id", [outsider]))[0].id
  await db.query("insert into applications(listing_id,user_id,status) values ($1,$2,'accepted')", [project, member])
  const legacyId = (await rows('insert into project_files(project_id,uploaded_by,file_name,file_path,file_size) values ($1,$2,\'old.zip\',$3,123) returning id', [project,owner,`${project}/old.zip`]))[0].id
  await db.exec(update)
  await check('migration replay preserves existing metadata', async () => {
    await db.exec(update)
    const file = (await rows('select * from project_files where id=$1', [legacyId]))[0]
    assert.equal(file.storage_format, 'raw')
    assert.equal(file.file_size, 123)
    assert.equal(file.original_size, null)
  })
  const reserve = (id = owner, overrides = {}) => {
    const p = { project, original: 10000, count: 2, kind: 'folder', hash: digest, size: 1000, ...overrides }
    return rows('select * from reserve_project_file_pack_secure($1,$2,\'Сборка.zip\',$3,$4,$5,$6,$7)', [id,p.project,p.size,p.original,p.count,p.kind,p.hash])
  }
  await user(null, 'anon')
  await check('anonymous reservation denied', () => assert.rejects(reserve(), /permission denied/))
  await user(outsider)
  await check('outsider cannot reserve another project', () => assert.rejects(reserve(outsider), /Нет доступа/))
  await user(owner)
  await check('caller cannot spoof expected identity', () => assert.rejects(reserve(member), /user_id/))
  for (const [label, patch] of [['uncompressed limit',{original:524288001}], ['stored limit',{size:524288001}], ['negative size',{original:-1}], ['file count',{count:2001}], ['invalid hash',{hash:'bad'}], ['unsupported format',{kind:'bad'}], ['single-file count',{kind:'single',count:2}], ['null fields',{hash:null}]]) {
    await check(`reject ${label}`, () => assert.rejects(reserve(owner, patch)))
  }
  const reservation = (await reserve())[0]
  await check('Cyrillic folder name uses an ASCII object key', async () => {
    assert.match(reservation.file_path, /^[A-Za-z0-9/_.-]+$/)
  })
  const finalize = (id = owner, reservationId = reservation.reservation_id) => rows('select * from finalize_project_file_upload_secure($1,$2)', [id,reservationId])
  await check('finalize requires uploaded object', () => assert.rejects(finalize(), /Объект не найден/))
  await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values (\'project-files\',$1,$2,\'{"size":999}\')', [reservation.file_path,owner])
  await check('finalize rejects mismatched stored bytes', () => assert.rejects(finalize(), /Размер объекта/))
  await user(null, 'postgres')
  await db.query('update storage.objects set metadata=\'{"size":1000}\' where name=$1', [reservation.file_path])
  await user(member)
  await check('member cannot finalize another user reservation', () => assert.rejects(finalize(member), /Резервация/))
  await user(owner)
  const id = (await finalize())[0].project_file_id
  await check('finalize stores pack metadata and is retry safe', async () => {
    assert.equal((await finalize())[0].project_file_id, id)
    const file = (await rows('select * from project_files where id=$1', [id]))[0]
    assert.equal(file.file_size, 1000)
    assert.equal(file.original_size, 10000)
    assert.equal(file.file_count, 2)
    assert.equal(file.storage_sha256, digest)
    assert.equal(file.storage_format, 'nearby-pack-v1')
    assert.equal(file.file_name, 'Сборка.zip')
  })
  await user(member)
  await check('accepted member can read pack; outsider cannot', async () => {
    assert.equal((await rows('select * from project_files where id=$1',[id])).length, 1)
    assert.equal((await rows('select * from storage.objects where name=$1',[reservation.file_path])).length, 1)
    await user(outsider)
    assert.equal((await rows('select * from project_files where id=$1',[id])).length, 0)
    assert.equal((await rows('select * from storage.objects where name=$1',[reservation.file_path])).length, 0)
  })
  await check('cross-project storage upload blocked by reservation policy', () => assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner_id) values (\'project-files\',$1,$2)', [reservation.file_path,outsider]), /row-level/))
  await user(null, 'postgres')
  await check('format metadata cannot be silently rewritten', () => assert.rejects(db.query("update project_files set storage_format='raw' where id=$1", [id]), /нельзя изменять/))
  await check('upload switch pauses new packs while keeping saved files readable', async () => {
    await db.exec('create or replace function public.project_file_storage_version() returns integer language sql stable set search_path=public,pg_temp as $$ select 0 $$;')
    await user(owner)
    await assert.rejects(reserve(), /временно отключена/)
    assert.equal((await rows('select * from project_files where id=$1',[id])).length,1)
    await user(null,'postgres')
    await db.exec('create or replace function public.project_file_storage_version() returns integer language sql stable set search_path=public,pg_temp as $$ select 1 $$;')
  })
  await user(owner)
  await check('old client reserve/finalize path remains raw', async () => {
    const r = (await rows('select * from reserve_project_file_upload_secure($1,$2,\'Чертёж.txt\',20)', [owner,project]))[0]
    assert.match(r.file_path, /^[A-Za-z0-9/_.-]+$/)
    await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values (\'project-files\',$1,$2,\'{"size":20}\')',[r.file_path,owner])
    const raw = (await finalize(owner,r.reservation_id))[0].project_file_id
    const saved = (await rows('select storage_format,file_name from project_files where id=$1',[raw]))[0]
    assert.equal(saved.storage_format,'raw')
    assert.equal(saved.file_name,'Чертёж.txt')
  })
  await user(member)
  const revoked = (await reserve(member))[0]
  await db.query('insert into storage.objects(bucket_id,name,owner_id,metadata) values (\'project-files\',$1,$2,\'{"size":1000}\')',[revoked.file_path,member])
  await user(null,'postgres')
  await db.query('delete from applications where listing_id=$1 and user_id=$2',[project,member])
  await user(member)
  await check('membership revocation blocks finalization and reads', async () => {
    await assert.rejects(finalize(member,revoked.reservation_id),/отозван/)
    assert.equal((await rows('select * from storage.objects where name=$1',[reservation.file_path])).length,0)
  })
  await user(owner)
  await check('deletion requires storage removal first, then deletes only that record', async () => {
    await assert.rejects(rows('select * from delete_project_file_record_secure($1,$2)',[owner,id]),/Объект ещё/)
    await db.query('delete from storage.objects where name=$1',[reservation.file_path])
    await rows('select * from delete_project_file_record_secure($1,$2)',[owner,id])
    assert.equal((await rows('select * from project_files where id=$1',[id])).length,0)
    assert.equal((await rows('select * from project_files where id=$1',[legacyId])).length,1)
  })
  assert.ok(otherProject)
  console.log(`${passed} storage database checks passed; no remote database contacted.`)
} finally { await db.close() }
