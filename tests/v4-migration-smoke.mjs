// CI installs PGlite separately; the production application has no SQL runtime dependency.
// npm install --prefix .v4-sql-check --no-save --package-lock=false @electric-sql/pglite@0.5.8
// node tests/v4-migration-smoke.mjs
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const pgliteDirectory = resolve(process.env.PGLITE_DIR ?? '.v4-sql-check/node_modules/@electric-sql/pglite')
const { PGlite } = await import(pathToFileURL(resolve(pgliteDirectory, 'dist/index.js')))
const { pgcrypto } = await import(pathToFileURL(resolve(pgliteDirectory, 'dist/contrib/pgcrypto.js')))
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const db = new PGlite({ extensions: { pgcrypto } })
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
try {
 await db.exec(`create schema extensions; create schema auth;
 create role authenticated; create role anon; create role service_role bypassrls;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;
 grant usage on schema auth,extensions to authenticated,service_role;
 grant execute on all functions in schema auth to authenticated,service_role;
 insert into auth.users values('${owner}','prot@protstock.local'),('${other}','other@example.local');`)
 const files = (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()
 const skip = new Set(['20260914110000_eod_watchdog_cron.sql','20260929040000_single_eod_watchdog.sql'])
 for (const file of files) {
  if(skip.has(file))continue
  // The legacy TRC repair intentionally requires verified pre-existing data.
  // Synthetic fixtures exercise its original guard instead of weakening it.
  if(file==='20261001010000_research_prices_and_macd_divergence.sql') {
   await db.exec(`insert into public.symbols(symbol,sector) values('TRC','SMOKE');`)
  }
  if(file==='20261001020000_verified_trc_price_rebase.sql') {
   await db.exec(`insert into public.daily_prices(symbol_id,trading_date,open,high,low,close,volume,source,price_unit,source_version)
    select s.id,'2021-01-01'::date+i,40,40,40,40,100,'KBS_PUBLIC','THOUSAND_VND_PER_SHARE','KBS_PUBLIC_V2_20260930'
    from public.symbols s cross join generate_series(0,1000)i where s.symbol='TRC';
    insert into public.research_price_bars(symbol_id,trading_date,open,high,low,close,volume,price_unit,basis,source,source_version,source_url,collected_at,quality_status)
    select s.id,'2021-01-01'::date+i,10,10,10,10,100,'THOUSAND_VND_PER_SHARE','KBS_VENDOR_REBASED','KBS_PUBLIC','KBS_PUBLIC_V2_20260930','https://fixture.invalid/trc',now(),'VALID'
    from public.symbols s cross join generate_series(0,1000)i where s.symbol='TRC';
    insert into public.research_price_sync_status(symbol_id,requested_start_date,requested_end_date,first_date,last_date,vendor_bars,stored_bars,unmatched_stored_dates,quarantined_bars,coverage_status,source_version)
    select id,'2021-01-01','2026-09-30','2021-01-01','2023-09-28',1001,1001,0,0,'MATCHED','KBS_PUBLIC_V2_20260930' from public.symbols where symbol='TRC';`)
  }
  if(file==='20261003020000_rotate_hnx_universe.sql') {
   await db.exec(`insert into public.symbols(symbol,sector,exchange) values('DNP','BE TONG_NHUA DUONG','HNX'),('MVB','THAN','HNX'),('NSH','THEP','HNX'),('SLS','DUONG','HNX'),('THT','THAN','HNX'),('VIF','GO','HNX');
    insert into public.daily_prices(symbol_id,trading_date,open,high,low,close,volume,source)
      select id,'2021-01-04',10,10,10,10,100,'KBS' from public.symbols where symbol in ('DNP','MVB','NSH','SLS','THT','VIF');`)
  }
  try { await db.exec(await readFile('supabase/migrations/'+file,'utf8')) }
  catch(error){ console.error('MIGRATION FAILED',file,error.message); throw error }
 }
 console.log('PASS: all application migrations including v4; cron/Vault integrations excluded')
 assert.equal(Number(Object.values((await db.query(`select count(*) from public.symbols where symbol in ('DNP','MVB','NSH','SLS','THT','VIF')`)).rows[0])[0]),0)
 assert.equal(Number(Object.values((await db.query(`select count(*) from public.daily_prices where source='KBS' and trading_date='2021-01-04'`)).rows[0])[0]),0)
 assert.equal(Number(Object.values((await db.query(`select count(*) from public.symbols where symbol in ('NVB','HUT','VC3','BVS','DXP','HDA','APS','NRC','EVS','CTP','VFS','API','PSD','VC7','SVN','DST','C69','KSV','DVM','KSF','BKC')`)).rows[0])[0]),21)
 assert.equal(Number(Object.values((await db.query(`select count(*) from daily_prices p join symbols s on s.id=p.symbol_id where s.symbol='TRC' and p.close=10 and p.volume=400 and p.source_version='KBS_PUBLIC_V2_20260930_TRC_VSDC_199296'`)).rows[0])[0]),1001)
 // Supabase grants these through its platform default privileges.
 await db.exec(`grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;`)
 await db.exec(`insert into public.user_profiles(user_id,username,full_name,role,status) values('${other}','other','Other','ADMIN','ACTIVE');
 insert into public.symbols(symbol,sector) values('AAA','TECH'),('BBB','TECH') on conflict(symbol)do nothing;
 insert into public.portfolios(id,user_id,name,capital) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${owner}','A',1000000),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${other}','B',2000000);
 select set_config('request.jwt.claim.sub','${owner}',false),set_config('request.jwt.claim.role','authenticated',false);
 set role authenticated;`)
 const scalar = async(sql,params=[]) => Object.values((await db.query(sql,params)).rows[0])[0]
 const reject = async(sql,pattern,params=[])=>assert.rejects(()=>db.query(sql,params),pattern)
 await scalar(`select apply_watchlist_entry('AAA','{"tier":"S","reason":"Preserved reason","investmentHorizon":"Long term","buyZone":"10-12","targetPrice":"15","stopLoss":"9"}')`)
 await reject(`select apply_watchlist_entry('AAA','{"reason":"Wrong owner"}',$1)`,/owner mismatch/,[other])
 await reject(`select apply_watchlist_entry('AAA','{"reason":"Missing owner"}',null)`,/owner mismatch/)
 const pinnedWatchlist=await scalar(`select apply_watchlist_entry('AAA','{"tier":"A"}',$1)`,[owner])
 assert.equal(pinnedWatchlist.find(item=>item.symbol==='AAA').reason,'Preserved reason')
 assert.equal(await scalar(`select pronargdefaults from pg_proc where oid='public.apply_watchlist_entry(text,jsonb,uuid)'::regprocedure`),0)
 assert.equal(await scalar(`select has_function_privilege('authenticated','public.apply_watchlist_entry(text,jsonb,uuid)','EXECUTE')`),true)
 assert.equal(await scalar(`select has_function_privilege('anon','public.apply_watchlist_entry(text,jsonb,uuid)','EXECUTE')`),false)
 const watchlist=await scalar(`select apply_watchlist_change('AAA','A')`)
 const watched=watchlist.find(item=>item.symbol==='AAA')
 assert.equal(watched.reason,'Preserved reason');assert.equal(watched.investmentHorizon,'Long term');assert.equal(watched.tier,'A')
 await scalar(`select apply_watchlist_entry('DPC','{"tier":"B"}')`)
 assert.equal((await scalar(`select items from user_watchlists where user_id=auth.uid()`)).some(item=>item.symbol==='DPC'),false)
 console.log('PASS: remote watchlist sheet fields survive Tier edits and retired symbols stay excluded')
 const portfolio='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 const request='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
 const capitalSql=`select public.record_portfolio_capital_movement($1,'DEPOSIT',100000,'2026-09-28',null,$2) value`
 const movement = await scalar(capitalSql,[portfolio,request])
 assert.equal(movement.capital,1100000)
 assert.deepEqual(await scalar(capitalSql,[portfolio,request]),movement)
 assert.equal(Number(await scalar(`select count(*) from portfolio_capital_movements`)),1)
 await reject(`select record_portfolio_capital_movement($1,'DEPOSIT',200000,'2026-09-28',null,$2)`,/different movement/,[portfolio,request])
 await reject(`select record_portfolio_capital_movement($1,'DEPOSIT',1000,'2099-01-01')`,/Future/,[portfolio])
 await reject(`update portfolios set capital=999999 where id=$1`,/capital movement action/,[portfolio])
 await reject(`insert into portfolio_capital_movements(portfolio_id,user_id,movement_type,amount,effective_date) values($1,$2,'DEPOSIT',1,'2026-09-28')`,/permission denied/,[portfolio,owner])
 assert.equal(Number(await scalar(`select count(*) from portfolios`)),1)
 await reject(`select portfolio_report_data('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')`,/Portfolio not found/)
 console.log('PASS: capital atomic/idempotent, future rejection, direct bypass denied, owner RLS')
 const symbol = await scalar(`select id from symbols where symbol='AAA'`)
 const tradeRequest='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 const tradeSql=`select record_portfolio_transaction($1,$2,'BUY_NEW',10,10000,9000,null,'2026-09-28',$3)`
 const trade = await scalar(tradeSql,[portfolio,symbol,tradeRequest])
 assert.equal(await scalar(tradeSql,[portfolio,symbol,tradeRequest]),trade)
 assert.equal(Number(await scalar(`select count(*) from portfolio_transactions`)),1)
 assert.equal(Number(await scalar(`select quantity from positions where symbol_id=$1`,[symbol])),10)
 await scalar(`select update_portfolio_transaction($1,'BUY_NEW',10,10000,9000,null,'2026-09-27')`,[trade])
 assert.equal(String(await scalar(`select decision_date::text from journal_entries where transaction_id=$1`,[trade])),'2026-09-27')
 await scalar(`select update_portfolio_transaction($1,'BUY_NEW',10,10000,9000,null,'2026-09-28')`,[trade])
 await reject(`update portfolio_transactions set quantity=20 where id=$1`,/permission denied/,[trade])
 await reject(`select record_portfolio_transaction($1,$2,'BUY_NEW',10,10000,9000,null,'2099-01-01')`,/Future/,[portfolio,symbol])
 console.log('PASS: trade idempotency, position ledger and future rejection')
 await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false);`)
 await db.query(`insert into daily_prices(symbol_id,trading_date,open,high,low,close,volume,source,quality_status)
 select $1,'2023-01-01'::date+i,10,10,10,10,100,'KBS',case when i=1 then 'WARNING' else 'VALID' end from generate_series(0,1200)i`,[symbol])
 await db.query(`insert into technical_snapshots(symbol_id,timeframe,as_of_date,close,input_last_date,algorithm_version) values($1,'D','2026-09-28',10,'2026-09-28','core-rules-v4.0.0')`,[symbol])
 await db.query(`insert into daily_prices(symbol_id,trading_date,open,high,low,close,volume,source,quality_status) values($1,'2026-09-28',10,10,10,10,100,'KBS','VALID'),($1,'2026-09-29',999,999,999,999,100,'KBS','WARNING')`,[symbol])
 await db.query(`insert into consolidated_signals(symbol_id,timeframe,as_of_date,composite_action,consensus_engines,reasons,source_revision,signal_state)
 select $1,'D','2023-01-01'::date+i,'WATCH',array['Core'],array['reason'],'core-rules-v4.0.0','WATCH_CONTEXT' from generate_series(0,1100)i`,[symbol])
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false),set_config('request.jwt.claim.role','authenticated',false); set role authenticated;`)
 const search = await scalar(`select search_consolidated_signals(p_page=>2,p_page_size=>1000)`)
 assert.equal(search.total,1101); assert.equal(search.rows.length,101)
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);`)
 await db.query(`update consolidated_signals set consensus_engines=array['Prot Core Pack · Phân kỳ RSI + xác nhận MACD'] where symbol_id=$1 and as_of_date='2023-01-01'`,[symbol])
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`)
 const legacyEngine=await scalar(`select search_consolidated_signals(p_engine=>'Prot Core Pack · RSI MACD Divergence')`)
 assert.equal(legacyEngine.total,1)
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);`)
 await db.query(`insert into consolidated_signals(symbol_id,timeframe,as_of_date,composite_action,consensus_engines,reasons,source_revision,signal_state)
 values($1,'D','2026-09-28','WATCH',array['Prot Core Pack · Phân kỳ Dương MACD'],array['research'],'core-rules-v4.0.0','WATCH_CONTEXT')`,[symbol])
 await db.query(`insert into fundamental_periods(symbol_id,period_type,fiscal_year,period_end,published_at,available_from,source)
 values($1,'YEAR',2025,'2025-12-31','2026-01-01','2026-01-01','VNSTOCK_VCI_PROVISIONAL'),($1,'YEAR',2024,'2024-12-31','2025-01-01','2025-01-01','VERIFIED_SMOKE')`,[symbol])
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`)
 assert.equal((await scalar(`select search_consolidated_signals()`)).total,1101)
 const bundle = await scalar(`select stock_analysis_data('AAA','D',null,2600,null)`)
 assert.equal(bundle.prices.length,1203); assert.equal(bundle.technical.length,1)
 assert.equal(bundle.decision,null);assert.equal(bundle.fundamentals.length,1);assert.equal(bundle.fundamentals[0].source,'VERIFIED_SMOKE')
 const report = await scalar(`select portfolio_report_data($1,'2026-09-27')`,[portfolio])
 assert.equal(report.initial_capital,1000000); assert.equal(report.portfolio.capital,1000000); assert.equal(report.transactions.length,0)
 const latestReport = await scalar(`select portfolio_report_data($1,'2026-10-02')`,[portfolio])
 assert.equal(latestReport.initial_capital,1000000); assert.equal(latestReport.portfolio.capital,1100000)
 assert.equal(latestReport.transactions.length,1)
 assert.equal(latestReport.prices.length,1); assert.equal(latestReport.prices[0].close,10)
 console.log('PASS: >1000 history/page aggregates, stock bundle and as-of capital')
 const rv = (await db.query(`select rv.* from rule_versions rv join rules r on r.id=rv.rule_id where r.kind='CORE_PACK' order by rv.created_at desc limit 1`)).rows[0]
 assert.equal(rv.dsl.implementation_version,'core-rules-v4.0.0')
 assert.equal(Number(await scalar(`select count(*) from rules r join lateral(select dsl from rule_versions where rule_id=r.id order by version desc limit 1) v on true where r.kind='CORE_PACK' and coalesce(v.dsl->>'implementation_version','')<>'core-rules-v4.0.0'`)),0)
 assert.ok(Number(await scalar(`select count(*) from rule_versions where coalesce(dsl->>'implementation_version','')<>'core-rules-v4.0.0'`))>0)
 assert.equal(await scalar(`select status from rules where name='Prot Core Pack · Phân kỳ Dương MACD'`),'ARCHIVED')
 await reject(`update rule_versions set dsl='{}' where id=$1`,/permission denied|immutable/,[rv.id])
 const newDsl={...rv.dsl,overrides:{risk:'test'}}
 const newRv = await scalar(`insert into rule_versions(rule_id,version,dsl,compiled_hash) values($1,$2,$3,'client-hash') returning id`,[rv.rule_id,rv.version+1,newDsl])
 assert.deepEqual(await scalar(`select dsl from rule_versions where id=$1`,[rv.id]),rv.dsl)
 assert.notEqual(await scalar(`select compiled_hash from rule_versions where id=$1`,[newRv]),'client-hash')
 const run = await scalar(`insert into backtest_runs(rule_version_id,symbol_id,name,date_from,date_to,assumptions) values($1,$2,'Smoke','2026-09-01','2026-09-28','{}') returning id`,[newRv,symbol])
 assert.deepEqual(await scalar(`select rule_dsl from backtest_runs where id=$1`,[run]),newDsl)
 await reject(`update backtest_runs set assumptions='{"fee":1}' where id=$1`,/immutable/,[run])
 await reject(`select claim_backtest_jobs()`,/permission denied/)
 await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false);set role service_role;`)
 let claimed = (await db.query(`select * from claim_backtest_jobs()`)).rows
 assert.equal(claimed.length,1); assert.equal(claimed[0].id,run)
 assert.equal((await db.query(`select * from claim_backtest_jobs()`)).rows.length,0)
 await db.exec(`reset role;`)
 await db.query(`update backtest_runs set started_at=now()-interval '31 minutes' where id=$1`,[run])
 await db.exec(`set role service_role;`)
 claimed = (await db.query(`select * from claim_backtest_jobs()`)).rows
 assert.equal(claimed.length,1); assert.equal(claimed[0].id,run)
 const trades=[{entry_date:'2026-09-01',exit_date:'2026-09-28',entry_price:10,exit_price:11,quantity:10,pnl:10,return_pct:10,exit_reason:'TEST',evidence:{}}]
 assert.equal(await scalar(`select replace_backtest_trades($1,$2,$3)`,[run,trades,claimed[0].started_at]),1)
 assert.equal(await scalar(`select replace_backtest_trades($1,$2,$3)`,[run,trades,claimed[0].started_at]),1)
 await reject(`select replace_backtest_trades($1,$2,'2000-01-01'::timestamptz)`,/lease expired/,[run,trades])
 await db.query(`update backtest_runs set status='SUCCEEDED',metrics='{"execution_algorithm_version":"core-rules-v4.0.0"}',finished_at=now() where id=$1`,[run])
 console.log('PASS: append-only rule/hash, immutable backtest snapshot, queue lease and retry-safe trades')
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false),set_config('request.jwt.claim.role','authenticated',false);set role authenticated;`)
 assert.equal(await scalar(`select has_function_privilege('authenticated','public.save_investment_thesis(bigint,text,text,text,text,text,uuid,uuid)','EXECUTE')`),true)
 assert.equal(await scalar(`select has_function_privilege('anon','public.save_investment_thesis(bigint,text,text,text,text,text,uuid,uuid)','EXECUTE')`),false)
 await reject(`select save_investment_thesis($1,'Wrong account','','','','OBSERVATION',null,$2)`,/account changed/,[symbol,other])
 const v1 = await scalar(`select save_investment_thesis($1,'Original thesis')`,[symbol])
 const v2 = await scalar(`select save_investment_thesis($1,'Revised thesis','','','','REVIEW',$2)`,[symbol,v1])
 assert.equal(await scalar(`select thesis from investment_thesis_versions where id=$1`,[v1]),'Original thesis')
 assert.notEqual(v1,v2)
 await reject(`select save_investment_thesis($1,'Conflict','','','','REVIEW',$2)`,/THESIS_CONFLICT/,[symbol,v1])
 const journal=await scalar(`insert into journal_entries(symbol_id,decision_date,decision,rationale,evidence_snapshot,thesis_version_id) values($1,'2026-09-28','HOLD','Observe','{"source":"v4"}',$2) returning id`,[symbol,v1])
 await reject(`update journal_entries set evidence_snapshot='{}' where id=$1`,/immutable/,[journal])
 await reject(`update journal_entries set signal_id='33333333-3333-4333-8333-333333333333' where id=$1`,/immutable/,[journal])
 const secondSymbol=await scalar(`select id from symbols where symbol='BBB'`)
 await reject(`insert into journal_entries(symbol_id,decision_date,decision,rationale,thesis_version_id) values($1,'2026-09-28','HOLD','Observe',$2)`,/journal owner and symbol/,[secondSymbol,v1])
 console.log('PASS: thesis 2 versions, stale-edit conflict and immutable matching journal evidence')
 await db.exec(`reset role; update user_profiles set status='SUSPENDED' where user_id='${owner}';set role authenticated;`)
 await reject(`select record_portfolio_capital_movement($1,'DEPOSIT',1000,'2026-09-28')`,/Active admin/,[portfolio])
 await reject(`select update_portfolio_transaction($1,'BUY_NEW',10,10000,9000,null,'2026-09-28')`,/Portfolio not found/,[trade])
 await reject(`select save_investment_thesis($1,'Suspended')`,/Unauthorized/,[symbol])
 await reject(`select apply_watchlist_entry('AAA','{"reason":"Suspended"}',$1)`,/Active account required/,[owner])
 assert.equal(Number(await scalar(`select count(*) from portfolios`)),0)
 console.log('PASS: suspended accounts cannot read personal portfolios or mutate definer APIs')
} catch(error) { console.error('FAIL:',error.message,error.where??'',error.query??'');process.exitCode=1 }
finally { await db.close() }
