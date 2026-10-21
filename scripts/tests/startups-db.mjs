import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
try {
 await db.exec(`create role anon; create role authenticated; create table public.listings (
 id uuid primary key default gen_random_uuid(), title text, description text, roles_needed text[], skills text[],
 visibility text default 'public', created_at timestamptz default now(), completed_at timestamptz,
 university_id uuid, school_id uuid, study_group_id uuid);
 grant usage on schema public to anon, authenticated;
 grant select on public.listings to anon, authenticated;
 alter table public.listings enable row level security;
 create policy public_read on public.listings for select using (visibility = 'public');
 insert into public.listings(title) values ('Existing project');`)
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261019160000_startup_projects.sql',import.meta.url),'utf8'))
 assert.equal((await db.query('select project_kind from listings')).rows[0].project_kind,'project')
 await assert.rejects(db.exec("insert into listings(project_kind) values ('startup')"), /listings_startup_fields_check/)
 await assert.rejects(db.exec("insert into listings(project_kind,startup_stage,participation_terms) values ('startup','wrong','paid')"), /listings_startup_fields_check/)
 await db.exec(`insert into listings(title,project_kind,startup_stage,participation_terms,skills,roles_needed,university_id) values
 ('Robot','startup','prototype','equity',array['CAD'],array['Сооснователь'],'00000000-0000-0000-0000-000000000001');
 insert into listings(title,project_kind,startup_stage,participation_terms,visibility) values ('Secret','startup','idea','paid','private');
 insert into listings(title,project_kind,startup_stage,participation_terms,completed_at) values ('Finished','startup','sales','paid',now());
 set role anon;`)
 assert.equal((await db.query('select * from search_startups()')).rows.length,1)
 assert.equal((await db.query("select * from search_startups('cad')")).rows.length,1)
 assert.equal((await db.query("select * from search_startups('сооснователь')")).rows.length,1)
 assert.equal((await db.query("select * from search_startups('', 'idea')")).rows.length,0)
 assert.equal((await db.query("select * from search_startups('', null, 'paid')")).rows.length,0)
 assert.equal((await db.query("select * from search_startups('', null,null,'00000000-0000-0000-0000-000000000002')")).rows.length,0)
 assert.equal((await db.query("select * from search_startups('%')")).rows.length,0)
 await db.exec("reset role; insert into listings(title,project_kind,startup_stage,participation_terms) select 'Page ' || n,'startup','idea','paid' from generate_series(1,30) n; set role authenticated;")
 const page1=(await db.query('select id from search_startups()')).rows
 const page2=(await db.query("select id from search_startups('',null,null,null,null,null,24)")).rows
 assert.equal(page1.length,25);assert.equal(page2.length,7)
 assert.equal(new Set([...page1.slice(0,24),...page2].map(r=>r.id)).size,31)
 console.log('PASS existing rows preserved; required fields and values constrained; public-only search; skills/roles; stage/terms/university filters; literal search; stable pagination; anon/authenticated execution')
} finally { await db.close() }
