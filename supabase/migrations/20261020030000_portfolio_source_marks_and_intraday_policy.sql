-- Trust valid vendor prices. Corporate rights are a separate receivable/cash ledger.
-- Nothing in this migration credits cash merely because a scheduled payment date passed.
alter table public.intraday_radar_sessions add column if not exists source_policy text not null default 'LEGACY';

create table if not exists public.portfolio_dividend_receipts (
 id uuid primary key default extensions.gen_random_uuid(),
 portfolio_id uuid not null references public.portfolios(id) on delete cascade,
 symbol_id bigint not null references public.symbols(id),
 ex_date date not null,
 received_date date not null check (received_date>=ex_date),
 net_cash numeric(24,2) not null check (net_cash>=0),
 updated_at timestamptz not null default now(),
 unique(portfolio_id,symbol_id,ex_date)
);
alter table public.portfolio_dividend_receipts enable row level security;
create policy owner_read_dividend_receipts on public.portfolio_dividend_receipts for select to authenticated
 using (exists(select 1 from public.portfolios p where p.id=portfolio_id and p.user_id=auth.uid()));
grant select on public.portfolio_dividend_receipts to authenticated;

create or replace function public.record_portfolio_dividend_receipt(
 p_portfolio_id uuid,p_symbol_id bigint,p_ex_date date,p_received_date date,p_net_cash numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_prot_admin() then raise exception 'Active admin account required'; end if;
 perform 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() for update;
 if not found then raise exception 'Portfolio not found'; end if;
 if p_received_date is null or p_received_date<p_ex_date or p_received_date>(now() at time zone 'Asia/Ho_Chi_Minh')::date
    or p_net_cash is null or p_net_cash<0 then raise exception 'Invalid dividend receipt'; end if;
 if not exists(select 1 from public.corporate_actions where symbol_id=p_symbol_id and ex_date=p_ex_date
     and action_type='CASH_DIVIDEND' and verification_status<>'REJECTED') then
   raise exception 'Cash dividend event not found';
 end if;
 if coalesce((select sum(case when action in ('BUY_NEW','BUY_ADD') then quantity
     when action in ('SELL_REDUCE','SELL_CLOSE') then -quantity else 0 end)
     from public.portfolio_transactions where portfolio_id=p_portfolio_id and symbol_id=p_symbol_id and trading_date<p_ex_date),0)<=0
     then raise exception 'No holding entering ex-date'; end if;
 insert into public.portfolio_dividend_receipts(portfolio_id,symbol_id,ex_date,received_date,net_cash)
 values(p_portfolio_id,p_symbol_id,p_ex_date,p_received_date,p_net_cash)
 on conflict(portfolio_id,symbol_id,ex_date) do update set received_date=excluded.received_date,net_cash=excluded.net_cash,updated_at=now();
end $$;
revoke all on function public.record_portfolio_dividend_receipt(uuid,bigint,date,date,numeric) from public,anon;
grant execute on function public.record_portfolio_dividend_receipt(uuid,bigint,date,date,numeric) to authenticated;

create or replace function public.portfolio_report_data(p_portfolio_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p jsonb; tx jsonb; movements jsonb; prices jsonb; entitlements jsonb; receipts jsonb; sessions jsonb;
 start_date date; initial_capital numeric;
begin
 select to_jsonb(x) into p from public.portfolios x where id=p_portfolio_id and user_id=auth.uid();
 if p is null then raise exception 'Portfolio not found'; end if;
 select (p->>'capital')::numeric-coalesce(sum(case when movement_type='DEPOSIT' then amount else -amount end),0)
 into initial_capital from public.portfolio_capital_movements where portfolio_id=p_portfolio_id;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('symbols',jsonb_build_object('symbol',s.symbol,'sector',s.sector)) order by t.trading_date,t.created_at,t.id),'[]'::jsonb),min(t.trading_date)
 into tx,start_date from public.portfolio_transactions t join public.symbols s on s.id=t.symbol_id where t.portfolio_id=p_portfolio_id and t.trading_date<=p_as_of_date;
 start_date:=least(coalesce(start_date,p_as_of_date),coalesce(((p->>'created_at')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date,p_as_of_date));
 select coalesce(jsonb_agg(to_jsonb(m) order by effective_date,created_at,id),'[]'::jsonb) into movements from public.portfolio_capital_movements m where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date;
 select least(start_date,coalesce(min(effective_date),start_date)) into start_date from public.portfolio_capital_movements where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date;
 with events as (
   select distinct on (ca.symbol_id,ca.ex_date,ca.action_type) ca.*
   from public.corporate_actions ca where ca.ex_date<=p_as_of_date and ca.verification_status<>'REJECTED'
   and ca.action_type in ('CASH_DIVIDEND','STOCK_DIVIDEND','SPLIT','RIGHTS_ISSUE','BONUS')
   and coalesce(ca.metadata->>'entitlement_policy','')<>'NO_EXISTING_HOLDER_ENTITLEMENT'
   order by ca.symbol_id,ca.ex_date,ca.action_type,
     (ca.verification_status in ('OFFICIAL','VERIFIED')) desc, ca.collected_at desc, ca.id
 ), owned as (
   select ca.*,coalesce((select sum(case when t.action in ('BUY_NEW','BUY_ADD') then t.quantity
     when t.action in ('SELL_REDUCE','SELL_CLOSE') then -t.quantity else 0 end)
     from public.portfolio_transactions t where t.portfolio_id=p_portfolio_id
     and t.symbol_id=ca.symbol_id and t.trading_date<ca.ex_date),0) entitled_quantity from events ca
 )
 select coalesce(jsonb_agg(jsonb_build_object('symbol_id',ca.symbol_id,'symbol',s.symbol,
   'ex_date',ca.ex_date,'action_type',ca.action_type,'payment_date',ca.payment_date,
   'quantity',ca.entitled_quantity,'cash_per_share',ca.cash_amount,'ratio',ca.ratio,'source',ca.source,
   'expected_cash',case when ca.action_type='CASH_DIVIDEND' then ca.entitled_quantity*ca.cash_amount else null end)
   order by ca.ex_date,s.symbol),'[]'::jsonb) into entitlements
 from owned ca join public.symbols s on s.id=ca.symbol_id where ca.entitled_quantity>0;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.received_date,r.id),'[]'::jsonb) into receipts
 from public.portfolio_dividend_receipts r where r.portfolio_id=p_portfolio_id and r.received_date<=p_as_of_date;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.trading_date,d.symbol_id),'[]'::jsonb) into prices from (
   select d.symbol_id,d.trading_date,d.close,true valuation_usable from public.daily_prices d
   where d.symbol_id in(select distinct symbol_id from public.portfolio_transactions
     where portfolio_id=p_portfolio_id and trading_date<=p_as_of_date)
   and d.trading_date>=start_date and d.trading_date<=p_as_of_date
   and d.quality_status='VALID' and d.data_revision is not null
 ) d;
 select coalesce(jsonb_agg(d.trading_date order by d.trading_date),'[]'::jsonb) into sessions
 from public.market_index_prices d join public.market_indices i on i.id=d.index_id and i.code='VNINDEX'
 where d.trading_date>=start_date and d.trading_date<=p_as_of_date;
 p:=jsonb_set(p,'{capital}',to_jsonb(initial_capital+coalesce((select sum(case when movement_type='DEPOSIT' then amount else -amount end) from public.portfolio_capital_movements where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date),0)));
 return jsonb_build_object('portfolio',p,'initial_capital',initial_capital,'transactions',tx,'capital_movements',movements,'prices',prices,
  'valuation_blocked_symbols','[]'::jsonb,'valuation_issues','[]'::jsonb,'entitlements',entitlements,
  'dividend_receipts',receipts,'valuation_basis','VENDOR_MARKED_LEDGER','market_sessions',sessions,'as_of_date',p_as_of_date);
end $$;
revoke all on function public.portfolio_report_data(uuid,date) from public,anon;
grant execute on function public.portfolio_report_data(uuid,date) to authenticated;
notify pgrst,'reload schema';
