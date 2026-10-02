-- v4: additive integrity, reproducible decisions and bounded read APIs.
begin;

alter table public.job_runs add column if not exists heartbeat_at timestamptz;
alter table public.market_breadth_snapshots add column if not exists health_method_version text;
alter table public.market_breadth_snapshots add column if not exists health_components jsonb;
create index if not exists job_runs_session_status_idx on public.job_runs (trading_date, job_type, status, started_at desc);

alter table public.portfolio_capital_movements add column if not exists request_id uuid;
create unique index if not exists capital_movements_request_idx on public.portfolio_capital_movements(user_id, request_id) where request_id is not null;
alter table public.portfolio_transactions add column if not exists request_id uuid;
create unique index if not exists portfolio_transactions_request_idx on public.portfolio_transactions(user_id, request_id) where request_id is not null;

-- Pin the UI owner across asynchronous JWT refresh/account changes. Keep the
-- two-argument entry point intact while the previous production UI is live.
create or replace function public.apply_watchlist_entry(
 p_symbol text,p_patch jsonb,p_expected_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_expected_user_id is null or auth.uid()<>p_expected_user_id then
  raise exception 'Watchlist owner mismatch';
 end if;
 if not public.is_active_member() then raise exception 'Active account required'; end if;
 return public.apply_watchlist_entry(p_symbol,p_patch);
end $$;
revoke all on function public.apply_watchlist_entry(text,jsonb,uuid) from public,anon;
grant execute on function public.apply_watchlist_entry(text,jsonb,uuid) to authenticated;

-- Legacy admin policies also granted access to other owners' personal rows.
drop policy if exists admin_portfolios_only on public.portfolios;
drop policy if exists owner_portfolios on public.portfolios;
create policy owner_portfolios on public.portfolios for all to authenticated
using(user_id=auth.uid() and public.is_prot_admin()) with check(user_id=auth.uid() and public.is_prot_admin());
drop policy if exists admin_rules_only on public.rules;
drop policy if exists owner_rules on public.rules;
create policy personal_rules_owner on public.rules for all to authenticated
using(user_id=auth.uid() and public.is_prot_admin()) with check(user_id=auth.uid() and public.is_prot_admin());
drop policy if exists admin_backtests_only on public.backtest_runs;
drop policy if exists owner_backtests on public.backtest_runs;
create policy owner_backtests on public.backtest_runs for all to authenticated
using(user_id=auth.uid() and public.is_prot_admin()) with check(user_id=auth.uid() and public.is_prot_admin());
drop policy if exists admin_journal_only on public.journal_entries;
drop policy if exists owner_journal on public.journal_entries;
create policy owner_journal on public.journal_entries for all to authenticated
using(user_id=auth.uid() and public.is_prot_admin()) with check(user_id=auth.uid() and public.is_prot_admin());

-- Ownership must agree with the referenced portfolio, not just the supplied user_id.
drop policy if exists owner_portfolio_capital_movements on public.portfolio_capital_movements;
create policy owner_portfolio_capital_movements on public.portfolio_capital_movements for all to authenticated
using (user_id = auth.uid() and exists(select 1 from public.portfolios p where p.id=portfolio_id and p.user_id=auth.uid()))
with check (user_id = auth.uid() and exists(select 1 from public.portfolios p where p.id=portfolio_id and p.user_id=auth.uid()));
revoke insert,update,delete on public.portfolio_capital_movements from authenticated;
drop policy if exists owner_portfolio_transactions on public.portfolio_transactions;
create policy owner_portfolio_transactions on public.portfolio_transactions for all to authenticated
using (user_id = auth.uid() and exists(select 1 from public.portfolios p where p.id=portfolio_id and p.user_id=auth.uid()))
with check (user_id = auth.uid() and exists(select 1 from public.portfolios p where p.id=portfolio_id and p.user_id=auth.uid()));

create or replace function public.record_portfolio_capital_movement(
 p_portfolio_id uuid, p_movement_type text, p_amount numeric, p_effective_date date,
 p_note text default null, p_request_id uuid default extensions.gen_random_uuid()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.portfolios%rowtype; movement public.portfolio_capital_movements%rowtype; next_capital numeric;
begin
 if auth.uid() is null or not public.is_prot_admin() then raise exception 'Active admin account required'; end if;
 select * into p from public.portfolios where id=p_portfolio_id and user_id=auth.uid() for update;
 if not found then raise exception 'Portfolio not found'; end if;
 if p_request_id is null then raise exception 'Request ID required'; end if;
 select * into movement from public.portfolio_capital_movements where user_id=auth.uid() and request_id=p_request_id;
 if found then
  if movement.portfolio_id<>p_portfolio_id or movement.movement_type<>p_movement_type or movement.amount<>p_amount or movement.effective_date<>p_effective_date then raise exception 'Request ID already used for a different movement'; end if;
  return jsonb_build_object('capital',p.capital,'movement_id',movement.id);
 end if;
 if p_movement_type not in ('DEPOSIT','WITHDRAWAL') or p_amount is null or p_amount<=0 or p_effective_date is null then raise exception 'Invalid capital movement'; end if;
 if p_effective_date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Future capital movements are not supported'; end if;
 next_capital:=p.capital+case when p_movement_type='DEPOSIT' then p_amount else -p_amount end;
 if next_capital<=0 then raise exception 'Managed capital must remain positive'; end if;
 insert into public.portfolio_capital_movements(portfolio_id,user_id,movement_type,amount,effective_date,note,request_id)
 values(p.id,auth.uid(),p_movement_type,p_amount,p_effective_date,nullif(trim(p_note),''),p_request_id) returning * into movement;
 perform set_config('protstock.capital_movement','atomic',true);
 update public.portfolios set capital=next_capital where id=p.id;
 return jsonb_build_object('capital',next_capital,'movement_id',movement.id);
end $$;
revoke all on function public.record_portfolio_capital_movement(uuid,text,numeric,date,text,uuid) from public,anon;
grant execute on function public.record_portfolio_capital_movement(uuid,text,numeric,date,text,uuid) to authenticated;
create or replace function public.guard_managed_capital() returns trigger language plpgsql set search_path='' as $$
begin
 if new.capital is distinct from old.capital and auth.role()='authenticated' and coalesce(current_setting('protstock.capital_movement',true),'')<>'atomic' then raise exception 'Use the capital movement action to change managed capital'; end if;
 return new;
end $$;
create trigger managed_capital_atomic before update on public.portfolios for each row execute function public.guard_managed_capital();

-- Keep the existing validated ledger/rebuild implementation inside one locked,
-- idempotent entry point. Direct calls to the internal implementation are removed.
alter function public.record_portfolio_transaction(uuid,bigint,text,bigint,numeric,numeric,text,date) rename to record_portfolio_transaction_internal;
revoke all on function public.record_portfolio_transaction_internal(uuid,bigint,text,bigint,numeric,numeric,text,date) from public,anon,authenticated;
create function public.record_portfolio_transaction(
 p_portfolio_id uuid,p_symbol_id bigint,p_action text,p_quantity bigint default 0,
 p_price numeric default null,p_stop_price numeric default null,p_note text default null,
 p_trading_date date default current_date,p_request_id uuid default extensions.gen_random_uuid()
) returns uuid language plpgsql security definer set search_path='' as $$
declare tx public.portfolio_transactions%rowtype; tx_id uuid;
begin
 if auth.uid() is null or not public.is_prot_admin() then raise exception 'Active admin account required'; end if;
 perform 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() for update;
 if not found then raise exception 'Portfolio not found'; end if;
 if p_request_id is null then raise exception 'Request ID required'; end if;
 if p_trading_date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Future trades are not supported'; end if;
 select * into tx from public.portfolio_transactions where user_id=auth.uid() and request_id=p_request_id;
 if found then
  if tx.portfolio_id<>p_portfolio_id or tx.symbol_id<>p_symbol_id or tx.action<>p_action or tx.quantity<>p_quantity or tx.price is distinct from p_price or tx.stop_price is distinct from p_stop_price or tx.trading_date<>p_trading_date then raise exception 'Request ID already used for a different transaction'; end if;
  return tx.id;
 end if;
 tx_id:=public.record_portfolio_transaction_internal(p_portfolio_id,p_symbol_id,p_action,p_quantity,p_price,p_stop_price,p_note,p_trading_date);
 update public.portfolio_transactions set request_id=p_request_id where id=tx_id;
 return tx_id;
end $$;
revoke all on function public.record_portfolio_transaction(uuid,bigint,text,bigint,numeric,numeric,text,date,uuid) from public,anon;
grant execute on function public.record_portfolio_transaction(uuid,bigint,text,bigint,numeric,numeric,text,date,uuid) to authenticated;
-- All ledger changes rebuild positions in a transaction; REST writes cannot
-- bypass the existing validated edit/delete routines.
alter function public.update_portfolio_transaction(uuid,text,bigint,numeric,numeric,text,date) security definer;
alter function public.delete_portfolio_transaction(uuid) security definer;
revoke insert,update,delete on public.portfolio_transactions from authenticated;

create or replace function public.lock_portfolio_ledger() returns trigger language plpgsql security definer set search_path='' as $$
declare portfolio_owner uuid;
begin
 select user_id into portfolio_owner from public.portfolios where id=coalesce(new.portfolio_id,old.portfolio_id) for update;
 if portfolio_owner is null then raise exception 'Portfolio not found'; end if;
 if tg_op<>'DELETE' and new.user_id<>portfolio_owner then raise exception 'Ledger owner must match portfolio owner'; end if;
 if tg_op<>'DELETE' then
  if tg_table_name='portfolio_transactions' and (to_jsonb(new)->>'trading_date')::date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Future trades are not supported'; end if;
  if tg_table_name='portfolio_capital_movements' and (to_jsonb(new)->>'effective_date')::date>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Future capital movements are not supported'; end if;
 end if;
 if auth.uid() is not null and (portfolio_owner<>auth.uid() or not public.is_prot_admin()) then raise exception 'Portfolio not found'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger portfolio_ledger_lock before insert or update or delete on public.portfolio_transactions for each row execute function public.lock_portfolio_ledger();
create trigger capital_ledger_lock before insert or update or delete on public.portfolio_capital_movements for each row execute function public.lock_portfolio_ledger();

-- Versions are append-only, including switches back to a previously used DSL.
alter table public.rule_versions drop constraint if exists rule_versions_rule_id_compiled_hash_key;
create or replace function public.guard_rule_version() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; last_version integer;
begin
 if tg_op<>'INSERT' then raise exception 'Rule versions are immutable; insert a new version'; end if;
 select user_id into owner_id from public.rules where id=new.rule_id for update;
 if owner_id is null or (auth.uid() is not null and (auth.uid()<>owner_id or not public.is_prot_admin())) then raise exception 'Rule not found'; end if;
 select coalesce(max(version),0) into last_version from public.rule_versions where rule_id=new.rule_id;
 if new.version<>last_version+1 then raise exception 'Rule version must follow the latest version'; end if;
 new.compiled_hash:=encode(extensions.digest(new.dsl::text,'sha256'),'hex');
 return new;
end $$;
create trigger rule_version_immutable before insert or update or delete on public.rule_versions for each row execute function public.guard_rule_version();
revoke update,delete on public.rule_versions from authenticated;

-- Preserve pack names, enabled state, overrides and every historical DSL.
-- The implementation revision is independent of the conceptual v0/v1/v2 pack.
do $$
declare pack record; latest public.rule_versions%rowtype;
begin
 for pack in select id from public.rules where kind='CORE_PACK' order by id for update loop
  select * into latest from public.rule_versions where rule_id=pack.id order by version desc limit 1;
  if found and coalesce(latest.dsl->>'implementation_version','')<>'core-rules-v4.0.0' then
   insert into public.rule_versions(rule_id,version,dsl,compiled_hash)
   values(pack.id,latest.version+1,latest.dsl||jsonb_build_object('implementation_version','core-rules-v4.0.0','policy_version','2026-10-02-v4'),'pending');
  end if;
 end loop;
end $$;

alter table public.backtest_runs add column if not exists rule_dsl jsonb;
alter table public.backtest_runs add column if not exists rule_hash text;
alter table public.backtest_runs add column if not exists algorithm_version text;
alter table public.backtest_runs add column if not exists data_revision text;
alter table public.backtest_runs add column if not exists started_at timestamptz;
create index if not exists backtest_queue_idx on public.backtest_runs(status,created_at);
create or replace function public.snapshot_backtest_rule() returns trigger language plpgsql security definer set search_path='' as $$
declare rv public.rule_versions%rowtype; rule_owner uuid;
begin
 select v.* into rv from public.rule_versions v where v.id=new.rule_version_id;
 select r.user_id into rule_owner from public.rules r where r.id=rv.rule_id;
 if rule_owner is null or rule_owner<>new.user_id or (auth.uid() is not null and (new.user_id<>auth.uid() or not public.is_prot_admin())) then raise exception 'Rule not found'; end if;
 new.rule_dsl:=rv.dsl; new.rule_hash:=rv.compiled_hash;
 new.algorithm_version:=coalesce(new.algorithm_version,'core-rules-v4.0.0');
 new.data_revision:=coalesce(new.data_revision,(select source_revision from public.job_runs where status='SUCCEEDED' and counts ? 'published_signals' order by trading_date desc,finished_at desc limit 1),'unpublished');
 return new;
end $$;
create trigger backtest_rule_snapshot before insert on public.backtest_runs for each row execute function public.snapshot_backtest_rule();
create or replace function public.guard_backtest_request() returns trigger language plpgsql set search_path='' as $$
begin
 if new.rule_version_id is distinct from old.rule_version_id or new.rule_dsl is distinct from old.rule_dsl or new.rule_hash is distinct from old.rule_hash
 or new.algorithm_version is distinct from old.algorithm_version or new.data_revision is distinct from old.data_revision
 or new.symbol_id is distinct from old.symbol_id or new.timeframe is distinct from old.timeframe
 or new.date_from is distinct from old.date_from or new.date_to is distinct from old.date_to or new.assumptions is distinct from old.assumptions or new.user_id is distinct from old.user_id then
  raise exception 'Backtest inputs are immutable; create a new run';
 end if; return new;
end $$;
create trigger backtest_request_immutable before update on public.backtest_runs for each row execute function public.guard_backtest_request();

create or replace function public.claim_backtest_jobs(p_limit integer default 3,p_lease_minutes integer default 30)
returns setof public.backtest_runs language plpgsql security definer set search_path='' as $$
begin
 return query with candidates as (
  select id from public.backtest_runs where status='QUEUED' or (status='RUNNING' and coalesce(started_at,created_at)<now()-make_interval(mins=>greatest(p_lease_minutes,5)))
  order by created_at,id for update skip locked limit least(greatest(p_limit,1),10)
 ) update public.backtest_runs b set status='RUNNING',started_at=now(),finished_at=null,error_message=null
 from candidates c where b.id=c.id returning b.*;
end $$;
revoke all on function public.claim_backtest_jobs(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_backtest_jobs(integer,integer) to service_role;

create or replace function public.replace_backtest_trades(p_run_id uuid,p_rows jsonb,p_started_at timestamptz default null)
returns integer language plpgsql security definer set search_path='' as $$
declare run public.backtest_runs%rowtype; written integer;
begin
 select * into run from public.backtest_runs where id=p_run_id for update;
 if not found or run.status<>'RUNNING' then raise exception 'Backtest is not running'; end if;
 if p_started_at is not null and run.started_at is distinct from p_started_at then raise exception 'Backtest lease expired'; end if;
 if jsonb_typeof(p_rows)<>'array' then raise exception 'Trades must be an array'; end if;
 delete from public.backtest_trades where backtest_run_id=p_run_id;
 insert into public.backtest_trades(backtest_run_id,symbol_id,entry_date,exit_date,entry_price,exit_price,quantity,pnl,return_pct,exit_reason,evidence)
 select p_run_id,run.symbol_id,t.entry_date,t.exit_date,t.entry_price,t.exit_price,t.quantity,t.pnl,t.return_pct,t.exit_reason,coalesce(t.evidence,'{}'::jsonb)
 from jsonb_to_recordset(p_rows) as t(entry_date date,exit_date date,entry_price numeric,exit_price numeric,quantity bigint,pnl numeric,return_pct numeric,exit_reason text,evidence jsonb);
 get diagnostics written=row_count; return written;
end $$;
revoke all on function public.replace_backtest_trades(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.replace_backtest_trades(uuid,jsonb,timestamptz) to service_role;

-- JSON aggregates bypass the REST row cap without hiding partial sets.
create or replace function public.recent_symbol_prices(p_symbol_ids bigint[],p_sessions integer default 20)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by r.symbol_id,r.trading_date),'[]'::jsonb)
 from (select s.id symbol_id,p.trading_date,p.close from public.symbols s
 cross join lateral (select trading_date,close from public.daily_prices d where d.symbol_id=s.id order by trading_date desc limit least(greatest(p_sessions,1),260)) p
 where s.id=any(p_symbol_ids)) r;
$$;
revoke all on function public.recent_symbol_prices(bigint[],integer) from public,anon;
grant execute on function public.recent_symbol_prices(bigint[],integer) to authenticated;

create or replace function public.portfolio_report_data(p_portfolio_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p jsonb; tx jsonb; movements jsonb; prices jsonb; start_date date; initial_capital numeric;
begin
 select to_jsonb(x) into p from public.portfolios x where id=p_portfolio_id and user_id=auth.uid();
 if p is null then raise exception 'Portfolio not found'; end if;
 select (p->>'capital')::numeric-coalesce(sum(case when movement_type='DEPOSIT' then amount else -amount end),0)
 into initial_capital from public.portfolio_capital_movements where portfolio_id=p_portfolio_id;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('symbols',jsonb_build_object('symbol',s.symbol,'sector',s.sector)) order by t.trading_date,t.created_at,t.id),'[]'::jsonb),min(t.trading_date)
 into tx,start_date from public.portfolio_transactions t join public.symbols s on s.id=t.symbol_id where t.portfolio_id=p_portfolio_id and t.trading_date<=p_as_of_date;
 select coalesce(jsonb_agg(to_jsonb(m) order by effective_date,created_at,id),'[]'::jsonb) into movements from public.portfolio_capital_movements m where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.trading_date,d.symbol_id),'[]'::jsonb) into prices from (
  select symbol_id,trading_date,close from public.daily_prices where symbol_id in(select distinct symbol_id from public.portfolio_transactions where portfolio_id=p_portfolio_id)
  and trading_date>=coalesce(start_date,p_as_of_date) and trading_date<=p_as_of_date and quality_status='VALID'
 ) d;
 p:=jsonb_set(p,'{capital}',to_jsonb(initial_capital+coalesce((select sum(case when movement_type='DEPOSIT' then amount else -amount end) from public.portfolio_capital_movements where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date),0)));
 return jsonb_build_object('portfolio',p,'initial_capital',initial_capital,'transactions',tx,'capital_movements',movements,'prices',prices,'as_of_date',p_as_of_date);
end $$;
revoke all on function public.portfolio_report_data(uuid,date) from public,anon;
grant execute on function public.portfolio_report_data(uuid,date) to authenticated;

create or replace function public.search_consolidated_signals(
 p_date date default null,p_revision text default null,p_symbol text default '',p_action text default 'ALL',p_min_score numeric default 0,
 p_timeframe text default 'ALL',p_engine text default 'ALL',p_date_from date default null,p_date_to date default null,
 p_page integer default 1,p_page_size integer default 25,p_descending boolean default true
) returns jsonb language sql stable security invoker set search_path='' as $$
 with matched as (
  select c.*,s.symbol,s.sector from public.consolidated_signals c join public.symbols s on s.id=c.symbol_id
  where (p_date is null or c.as_of_date=p_date) and (p_revision is null or c.source_revision=p_revision)
  and not ('Prot Core Pack · Phân kỳ Dương MACD'=any(c.consensus_engines))
  and (coalesce(p_symbol,'')='' or position(upper(p_symbol) in upper(s.symbol))>0)
  and c.confluence_score>=greatest(coalesce(p_min_score,0),0) and (p_timeframe='ALL' or c.timeframe=p_timeframe)
  and (p_engine='ALL' or exists(select 1 from unnest(c.consensus_engines) e(name)
   where case when e.name='Prot Core Pack · Phân kỳ RSI + xác nhận MACD' then 'Prot Core Pack · RSI MACD Divergence' else e.name end
   =case when p_engine='Prot Core Pack · Phân kỳ RSI + xác nhận MACD' then 'Prot Core Pack · RSI MACD Divergence' else p_engine end))
  and (p_date_from is null or c.as_of_date>=p_date_from) and (p_date_to is null or c.as_of_date<=p_date_to)
  and (p_action='ALL' or (p_action='CONFLUENCE' and c.confluence_count>=2) or (p_action='BUY' and c.composite_action in('PROBE_BUY','ADD')) or (p_action='SELL' and c.composite_action in('REDUCE','EXIT')) or (p_action='WATCH' and c.composite_action='WATCH'))
 ), page as (
  select * from matched order by as_of_date desc,case when p_descending then confluence_score end desc,case when not p_descending then confluence_score end asc,id
  offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),1000) limit least(greatest(p_page_size,1),1000)
 ) select jsonb_build_object('total',(select count(*) from matched),'rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb));
$$;
revoke all on function public.search_consolidated_signals(date,text,text,text,numeric,text,text,date,date,integer,integer,boolean) from public,anon;
grant execute on function public.search_consolidated_signals(date,text,text,text,numeric,text,text,date,date,integer,integer,boolean) to authenticated;

create or replace function public.stock_analysis_data(p_symbol text,p_timeframe text default 'D',p_as_of_date date default null,p_history_limit integer default 500,p_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare stock public.symbols%rowtype; technical jsonb; technical_date date; prices jsonb; patterns jsonb; zones jsonb; disclosures jsonb; fundamentals jsonb; decision jsonb;
begin
 if p_timeframe not in ('D','W','M') then raise exception 'Invalid timeframe'; end if;
 select * into stock from public.symbols where symbol=upper(p_symbol);
 if not found then raise exception 'Symbol not found'; end if;
 select to_jsonb(t),t.as_of_date into technical,technical_date from public.technical_snapshots t where symbol_id=stock.id and timeframe=p_timeframe and (p_as_of_date is null or as_of_date<=p_as_of_date) order by as_of_date desc limit 1;
 if p_timeframe='D' then
  select coalesce(jsonb_agg(to_jsonb(p) order by trading_date),'[]'::jsonb) into prices from (select trading_date,open,high,low,close,volume from public.daily_prices where symbol_id=stock.id and (p_as_of_date is null or trading_date<=p_as_of_date) order by trading_date desc limit least(greatest(p_history_limit,100),2600)) p;
 else
  select coalesce(jsonb_agg(to_jsonb(p) order by trading_date),'[]'::jsonb) into prices from (select source_last_date trading_date,open,high,low,close,volume,is_complete from public.derived_bars where symbol_id=stock.id and timeframe=p_timeframe and (p_as_of_date is null or source_last_date<=p_as_of_date) order by period_start desc limit case when p_timeframe='W' then 520 else 120 end) p;
 end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into patterns from (select * from public.pattern_instances where symbol_id=stock.id and timeframe=p_timeframe and as_of_date=technical_date order by quality_score desc,id limit 8) p;
 select coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) into zones from (select id,zone_type,lower_price,upper_price,touches,strength,as_of_date,evidence from public.support_resistance_zones where symbol_id=stock.id and timeframe=p_timeframe and active and as_of_date=technical_date order by strength desc,id limit 24) z;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into disclosures from (select id,title,category,published_at,available_from,source,source_url from public.disclosures where symbol_id=stock.id and available_from<=coalesce(p_as_of_date,current_date) order by published_at desc,id limit 6) d;
 select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into fundamentals from (
  select id,period_end,published_at,available_from,source,coalesce((select jsonb_build_array(jsonb_build_object('revenue',m.revenue,'eps',m.eps,'roe',m.roe,'debt_to_equity',m.debt_to_equity,'operating_cash_flow',m.operating_cash_flow)) from public.fundamental_metrics m where m.period_id=fp.id),'[]'::jsonb) fundamental_metrics
  from public.fundamental_periods fp where symbol_id=stock.id and source<>'VNSTOCK_VCI_PROVISIONAL' and available_from<=coalesce(p_as_of_date,current_date) order by period_end desc,id limit 4
 ) f;
 select jsonb_build_object('as_of_date',as_of_date,'timeframe',timeframe,'composite_action',composite_action,'reasons',reasons,'source_revision',source_revision)
 into decision from public.consolidated_signals where symbol_id=stock.id and timeframe=p_timeframe and as_of_date=technical_date and (p_revision is null or source_revision=p_revision)
 and not ('Prot Core Pack · Phân kỳ Dương MACD'=any(consensus_engines)) limit 1;
 return jsonb_build_object('symbol',jsonb_build_object('id',stock.id,'symbol',stock.symbol,'sector',stock.sector,'exchange',stock.exchange,'company_name',stock.company_name),'prices',prices,'technical',case when technical is null then '[]'::jsonb else jsonb_build_array(technical) end,'decision',decision,'patterns',patterns,'zones',zones,'disclosures',disclosures,'fundamentals',fundamentals);
end $$;
revoke all on function public.stock_analysis_data(text,text,date,integer,text) from public,anon;
grant execute on function public.stock_analysis_data(text,text,date,integer,text) to authenticated;

create or replace view public.data_health_summary with(security_invoker=true) as
select (select count(*) from public.symbols where active) active_symbols,
 (select max(trading_date) from public.daily_prices) latest_price_date,
 (select count(*) from public.daily_prices where quality_status='WARNING') price_warnings,
 (select max(collected_at) from public.disclosures) latest_disclosure_collection,
 (select max(started_at) from public.job_runs where status='SUCCEEDED') latest_successful_job,
 (select count(*) from public.job_runs where status='FAILED' and started_at>=now()-interval '7 days') failed_jobs_7d,
 (select max(trading_date) from public.job_runs where status='SUCCEEDED' and counts ? 'published_signals' and coalesce(counts->>'publication_status','COMPLETE')='COMPLETE') latest_complete_date,
 (select count(*) from public.job_runs where status='RUNNING' and coalesce(heartbeat_at,started_at)<now()-interval '30 minutes') stale_jobs;

commit;
