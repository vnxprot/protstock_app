import { PGlite } from '../.v4-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const review = { c: 'PASS', a: 'PASS', n: 'UNKNOWN', i: 'UNKNOWN', reviewed_on: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()), reporting_period: 'Q2/2026', catalyst: '', risks: '', source_url: 'https://example.org/report.pdf' }
try {
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function public.is_prot_admin() returns boolean language sql stable as $$select auth.uid() is not null$$;
    create function public.is_active_member() returns boolean language sql stable as $$select auth.uid() is not null$$;
    grant usage on schema auth to authenticated,service_role;
    create table symbols(id bigint primary key,active boolean not null);insert into symbols values(1,true),(2,true);
    create table job_runs(trading_date date,source_revision text,status text,counts jsonb,finished_at timestamptz);
    insert into job_runs values('2026-10-20','core-rules-v0.0.0-trend1','SUCCEEDED','{"published_signals":0}',now());`)
  await db.exec(await readFile('supabase/migrations/20261020040000_growth_and_cycle_modules.sql', 'utf8'))
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  const save = `select public.save_canslim_review(1,$1::jsonb,$2,$3)`
  await db.exec(`set request.jwt.claim.sub='${owner}';set request.jwt.claim.role='authenticated';set role authenticated;`)
  const saved = await scalar(save, [JSON.stringify(review), 0, owner])
  assert.equal(saved.revision, 1)
  await assert.rejects(() => scalar(save, [JSON.stringify(review), 0, owner]), /conflict/)
  await assert.rejects(() => scalar(save, [JSON.stringify(review), 1, other]), /owner/)
  await assert.rejects(() => scalar(save, [JSON.stringify({ ...review, source_url: '' }), 1, owner]), /Source/)
  assert.equal((await scalar(save, [JSON.stringify(review), 1, owner])).revision, 2)
  await assert.rejects(() => db.query(`update canslim_reviews set c='FAIL'`), /permission denied/)
  await assert.rejects(() => db.query(`select public.publish_investment_modules('[]')`), /permission denied/)
  await db.exec(`set request.jwt.claim.sub='${other}';`)
  assert.equal(Number(await scalar('select count(*) from canslim_reviews')), 0)
  await db.exec(`reset role;set request.jwt.claim.role='service_role';set role service_role;`)
  assert.equal((await scalar('select investment_modules_capacity()')).allowed, true)
  const batch = [1, 2].map(symbol_id => ({ symbol_id, as_of_date: '2026-10-20', source_revision: 'core-rules-v0.0.0-trend1', version: 'INVESTMENT_V1_20261020', evidence: { quality: 'VALID', setup: 'OBSERVE', cycle: { state: 'UNKNOWN', candidate: 'UNKNOWN' } } }))
  await scalar('select publish_investment_modules($1)', [JSON.stringify(batch)])
  await scalar('select publish_investment_modules($1)', [JSON.stringify(batch)])
  assert.equal(Number(await scalar('select count(*) from investment_module_current')), 2)
  assert.equal(Number(await scalar('select count(*) from investment_module_events')), 2)
  await assert.rejects(() => scalar('select publish_investment_modules($1)', [JSON.stringify(batch.slice(1))]), /universe/)
  await assert.rejects(() => scalar('select publish_investment_modules($1)', [JSON.stringify(batch.map(row => ({ ...row, as_of_date: '2026-10-19' })))]), /publication date/)
  assert.equal(Number(await scalar('select count(*) from investment_module_current')), 2)
  console.log('PASS: review ownership, optimistic conflicts, mandatory evidence, RLS, service-only atomic publication, idempotent events, full-universe and revision guards')
} finally { await db.close() }
