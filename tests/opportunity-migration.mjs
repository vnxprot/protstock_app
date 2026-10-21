import { PGlite } from '../.v4-sql-check/node_modules/@electric-sql/pglite/dist/index.js'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
try {
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create schema extensions;
    create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
    create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.is_active_member() returns boolean language sql stable as $$select auth.uid() is not null$$;
    create function public.is_prot_admin() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
    create table user_profiles(user_id uuid,username text,role text,status text);insert into user_profiles values('${owner}','prot','ADMIN','ACTIVE');
    create table symbols(id bigint, symbol text,sector text,active boolean);
    create table job_runs(trading_date date,status text,source_revision text,counts jsonb,finished_at timestamptz);
    create table intraday_radar_sessions(trading_date date,status text,published_at timestamptz);
    create table technical_snapshots(symbol_id bigint,timeframe text,as_of_date date);
    create table daily_prices(symbol_id bigint,trading_date date,open numeric,high numeric,low numeric,close numeric,volume bigint,quality_status text,price_basis text,data_revision text);
    create table consolidated_signals(symbol_id bigint,as_of_date date,source_revision text,timeframe text,composite_action text,signal_state text,trigger_price numeric,invalidation_price numeric,reasons jsonb);
    create table intraday_spike_events(symbol_id bigint,trading_date date,source text,id bigint,start_time text,end_time text,volume bigint,value_vnd numeric,volume_ratio numeric,price_change_pct numeric,direction text,baseline_sessions int,created_at timestamptz);
    create table intraday_radar_symbol_status(symbol_id bigint,trading_date date);
    create table momentum_radar_assessments(symbol_id bigint,as_of_date date,version text);
    create table signal_funnel_assessments(symbol_id bigint,as_of_date date,version text);
    create table macd_divergence_assessments(symbol_id bigint,as_of_date date,version text,oscillator text);
    create table market_breadth_snapshots(trading_date date);
    insert into job_runs values('2026-10-20','SUCCEEDED','core-rules-v0.0.0-trend1','{"published_signals":0}','2026-10-20 09:00+00');
    insert into intraday_radar_sessions values('2026-10-20','PUBLISHED','2026-10-20 10:00+00');
    grant usage on schema auth,extensions to authenticated,service_role;
    grant select on all tables in schema public to service_role,authenticated;
    grant update on intraday_radar_sessions to service_role;`)
  await db.exec(await readFile('supabase/migrations/20261021020000_next_session_opportunities.sql','utf8'))
  const scalar = async (sql, params = []) => Object.values((await db.query(sql,params)).rows[0])[0]
  const publish = `select publish_opportunities('2026-10-20','V1','hash','2026-10-20 09:00+00','2026-10-20 10:00+00','[{"symbol":"VSC"}]','{}',true)`
  await db.exec('set role service_role;')
  const id = await scalar(publish)
  assert.equal(await scalar(publish),id)
  assert.equal(Number(await scalar('select count(*) from opportunity_publications')),1)
  await assert.rejects(()=>scalar(publish.replace('09:00+00','08:00+00')),/Source publication/)
  assert.equal((await scalar("select opportunity_inputs('2026-10-20')")).eod.status,'SUCCEEDED')
  await db.exec(`reset role;set request.jwt.claim.sub='${owner}';set role authenticated;`)
  assert.equal((await scalar("select get_opportunities('2026-10-20')")).rows[0].symbol,'VSC')
  assert.equal((await scalar("select get_opportunities('2026-10-21')")).status,'WAIT_EOD')
  await assert.rejects(()=>db.exec("update opportunity_publications set rows='[]'"),/permission denied/)
  await assert.rejects(()=>scalar(publish),/permission denied/)
  await assert.rejects(()=>scalar("select opportunity_inputs('2026-10-20')"),/permission denied/)
  await db.exec(`set request.jwt.claim.sub='${other}';`)
  assert.equal(Number(await scalar('select count(*) from opportunity_notification_settings')),0)
  await assert.rejects(()=>db.exec(`insert into opportunity_notification_settings(user_id) values('${owner}')`),/row-level security/)
  await db.exec('reset role;set role service_role;')
  await db.exec("update intraday_radar_sessions set published_at='2026-10-20 11:00+00'")
  await db.exec(`reset role;set request.jwt.claim.sub='${owner}';set role authenticated;`)
  assert.equal((await scalar("select get_opportunities('2026-10-20')")).status,'WAIT_SUMMARY')
  assert.equal((await scalar('select get_opportunities(null,$1)',[id])).rows[0].symbol,'VSC')
  console.log('PASS: migration, atomic source guards, immutable history, idempotency, RLS, date pinning, stale-source handling')
  await db.exec(`reset role;
    alter table intraday_radar_sessions add baseline_ready_symbols int,add expected_symbols int;
    alter table technical_snapshots add close numeric,add ema20 numeric,add rsi14 numeric,add macd_histogram numeric,add volume_avg20 bigint,add volume_ratio20 numeric,add cmf20 numeric,add atr14 numeric,add monthly_context jsonb;
    alter table intraday_radar_symbol_status add status text,add baseline_sessions int;
    alter table momentum_radar_assessments add stage text,add entry_status text,add evidence jsonb;
    alter table signal_funnel_assessments add stage text;
    alter table macd_divergence_assessments add stage text,add swings int,add trigger_date date;
    alter table market_breadth_snapshots add vnindex_trend_state text,add pct_above_sma50 numeric;
    insert into job_runs values('2026-10-21','SUCCEEDED','core-rules-v0.0.0-trend1','{"published_signals":0,"publication_status":"COMPLETE"}','2026-10-21 09:00+00');
    insert into symbols select i,'S'||i,'TEST',true from generate_series(1,30) i;
    insert into daily_prices select s.id,'2026-10-21'::date-i,13,13.4,12.7,13.4,7000000,'VALID','VENDOR',null from symbols s cross join generate_series(0,24) i;
    insert into technical_snapshots select s.id,'D','2026-10-21'::date-i,13.4,13.1,52,.1,7000000,1,-.2,.4,
      jsonb_build_object('state','DOWN','unused_history',repeat('x',4000)) from symbols s cross join generate_series(0,3) i;
    insert into macd_divergence_assessments select s.id,'2026-10-21','MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0','MACD_LINE','WATCH_PRICE_CONFIRMATION',i,null from symbols s cross join generate_series(2,4) i;`)
  await db.exec(await readFile('supabase/migrations/20261022010000_opportunity_pipeline_recovery.sql','utf8'))
  await db.exec('set role service_role;')
  const ids=Array.from({length:25},(_,i)=>i+1)
  const batch=await scalar("select opportunity_input_batch('2026-10-21',$1,'core-rules-v0.0.0-trend1',false)",[ids])
  assert.equal(batch.length,25);assert.equal(new Set(batch.map(s=>s.symbol_id)).size,25)
  assert(batch.every(s=>s.macd.swings===4));assert(JSON.stringify(batch).length<200000)
  assert(!JSON.stringify(batch).includes('unused_history'))
  await assert.rejects(()=>scalar("select opportunity_input_batch('2026-10-21',$1,'r',true)",[Array.from({length:26},(_,i)=>i+1)]),/1 to 25/)
  const begin="select begin_opportunity_build('2026-10-21',$1,'V2','2026-10-21 09:00+00',$2,null)"
  const eodClaim=await scalar(begin,['EOD',null])
  assert.equal((await scalar(begin,['EOD',null])).action,'IN_PROGRESS')
  const finish="select finish_opportunity_build('2026-10-21',$1,$2,$3,$4,$5,true)"
  const eodId=await scalar(finish,['EOD',eodClaim.token,'eod-v2','[]','{"input_complete":true}'])
  assert.equal((await scalar(begin,['EOD',null])).action,'READY')
  await db.exec(`reset role;set request.jwt.claim.sub='${owner}';set role authenticated;`)
  assert.equal((await scalar("select get_opportunities('2026-10-21')")).status,'PROVISIONAL')
  assert.equal((await scalar('select get_opportunities(null,$1)',[eodId])).phase,'EOD')
  await db.exec(`reset role;insert into intraday_radar_sessions values('2026-10-21','PUBLISHED','2026-10-21 11:00+00',30,30);set role service_role;`)
  const radarClaim=await scalar(begin,['RADAR','2026-10-21 11:00+00'])
  const radarId=await scalar(finish,['RADAR',radarClaim.token,'radar-v2','[{"symbol_id":1,"symbol":"S1"}]','{"input_complete":true}'])
  await assert.rejects(()=>scalar(finish,['RADAR',eodClaim.token,'bad','[]','{}']),/lease/)
  await scalar("select publish_opportunities('2026-10-21','V2','late-eod','2026-10-21 09:00+00',null,'[]','{}',true)")
  await db.exec(`reset role;set request.jwt.claim.sub='${owner}';set role authenticated;`)
  assert.equal((await scalar("select get_opportunities('2026-10-21')")).id,radarId)
  await assert.rejects(()=>scalar(begin,['RADAR','2026-10-21 11:00+00']),/permission denied/)
  await db.exec(`reset role;insert into job_runs values('2026-10-22','SUCCEEDED','core-rules-v0.0.0-trend1','{"published_signals":0}','2026-10-22 09:00+00');set role service_role;`)
  const retry="select begin_opportunity_build('2026-10-22','EOD','V2','2026-10-22 09:00+00',null,null)"
  for(let i=1;i<=3;i++){assert.equal((await scalar(retry)).attempt,i);await db.exec("update opportunity_builds set status='FAILED',last_error='Input unavailable',finished_at=now() where trading_date='2026-10-22'")}
  assert.equal((await scalar(retry)).action,'RETRY_LIMIT')
  await db.exec(`reset role;set request.jwt.claim.sub='${owner}';set role authenticated;`)
  const failure=await scalar("select get_opportunities('2026-10-22')")
  assert.equal(failure.status,'FAILED');assert.equal(failure.build.retry_exhausted,true)
  assert.equal((await scalar('select get_opportunities(null,$1)',[radarId])).rows[0].symbol,'S1')
  console.log('PASS: compact unique batches, EOD preview, final promotion, no downgrade, lease ownership and bounded failure state')
} finally { await db.close() }
