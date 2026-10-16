-- Gate only events with an actual holding entering ex-date, not every past buy.
create or replace function public.portfolio_report_data(p_portfolio_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p jsonb; tx jsonb; movements jsonb; prices jsonb; blocked jsonb; issues jsonb; sessions jsonb;
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
 select coalesce(jsonb_agg(jsonb_build_object('symbol_id',ca.symbol_id,'symbol',s.symbol,'ex_date',ca.ex_date,'action_type',ca.action_type) order by ca.ex_date,s.symbol),'[]'::jsonb)
 into issues from public.corporate_actions ca join public.symbols s on s.id=ca.symbol_id
 where ca.ex_date<=p_as_of_date and ca.verification_status<>'REJECTED'
 and coalesce(ca.metadata->>'entitlement_policy','')<>'NO_EXISTING_HOLDER_ENTITLEMENT'
 and coalesce((select sum(case when t.action in ('BUY_NEW','BUY_ADD') then t.quantity when t.action in ('SELL_REDUCE','SELL_CLOSE') then -t.quantity else 0 end)
   from public.portfolio_transactions t where t.portfolio_id=p_portfolio_id and t.symbol_id=ca.symbol_id and t.trading_date<ca.ex_date),0)>0;
 select coalesce(jsonb_agg(distinct (x->>'symbol_id')::bigint),'[]'::jsonb) into blocked from jsonb_array_elements(issues) x;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.trading_date,d.symbol_id),'[]'::jsonb) into prices from (
  select d.symbol_id,d.trading_date,d.close,not exists(
   select 1 from public.corporate_actions ca where ca.symbol_id=d.symbol_id and ca.ex_date>d.trading_date and ca.ex_date<=p_as_of_date
   and ca.verification_status<>'REJECTED' and ca.action_type in ('CASH_DIVIDEND','STOCK_DIVIDEND','SPLIT','RIGHTS_ISSUE','BONUS')
   and coalesce(ca.metadata->>'entitlement_policy','')<>'NO_EXISTING_HOLDER_ENTITLEMENT'
   and d.price_basis='VENDOR_CORPORATE_ACTION_ADJUSTED'
  ) valuation_usable from public.daily_prices d where symbol_id in(select distinct symbol_id from public.portfolio_transactions where portfolio_id=p_portfolio_id and trading_date<=p_as_of_date)
  and trading_date>=start_date and trading_date<=p_as_of_date and quality_status='VALID' and data_revision is not null
  and not (blocked @> jsonb_build_array(symbol_id))
 ) d;
 select coalesce(jsonb_agg(trading_date order by trading_date),'[]'::jsonb) into sessions from public.daily_prices d
 join public.symbols s on s.id=d.symbol_id and s.symbol='VNINDEX'
 where d.trading_date>=start_date and d.trading_date<=p_as_of_date and d.quality_status='VALID' and d.data_revision is not null;
 p:=jsonb_set(p,'{capital}',to_jsonb(initial_capital+coalesce((select sum(case when movement_type='DEPOSIT' then amount else -amount end) from public.portfolio_capital_movements where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date),0)));
 return jsonb_build_object('portfolio',p,'initial_capital',initial_capital,'transactions',tx,'capital_movements',movements,'prices',prices,
  'valuation_blocked_symbols',blocked,'valuation_issues',issues,'market_sessions',sessions,'as_of_date',p_as_of_date);
end $$;
revoke all on function public.portfolio_report_data(uuid,date) from public,anon;
grant execute on function public.portfolio_report_data(uuid,date) to authenticated;
notify pgrst,'reload schema';
