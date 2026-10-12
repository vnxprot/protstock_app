-- Personal portfolio positions are a transaction ledger. Until bonus shares
-- and cash entitlements are entered as actual holdings/cash, an adjusted
-- market price must not be presented as an exact NAV for affected positions.
create or replace function public.portfolio_report_data(p_portfolio_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p jsonb; tx jsonb; movements jsonb; prices jsonb; blocked jsonb; start_date date; initial_capital numeric;
begin
 select to_jsonb(x) into p from public.portfolios x where id=p_portfolio_id and user_id=auth.uid();
 if p is null then raise exception 'Portfolio not found'; end if;
 select (p->>'capital')::numeric-coalesce(sum(case when movement_type='DEPOSIT' then amount else -amount end),0)
 into initial_capital from public.portfolio_capital_movements where portfolio_id=p_portfolio_id;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('symbols',jsonb_build_object('symbol',s.symbol,'sector',s.sector)) order by t.trading_date,t.created_at,t.id),'[]'::jsonb),min(t.trading_date)
 into tx,start_date from public.portfolio_transactions t join public.symbols s on s.id=t.symbol_id where t.portfolio_id=p_portfolio_id and t.trading_date<=p_as_of_date;
 select coalesce(jsonb_agg(to_jsonb(m) order by effective_date,created_at,id),'[]'::jsonb) into movements from public.portfolio_capital_movements m where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date;
 select coalesce(jsonb_agg(symbol_id),'[]'::jsonb) into blocked from (
  select ca.symbol_id from public.corporate_actions ca
  join public.portfolio_transactions t on t.symbol_id=ca.symbol_id and t.portfolio_id=p_portfolio_id
  where ca.ex_date>t.trading_date and ca.ex_date<=p_as_of_date and ca.verification_status<>'REJECTED'
  group by ca.symbol_id
 ) affected;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.trading_date,d.symbol_id),'[]'::jsonb) into prices from (
  select symbol_id,trading_date,close from public.daily_prices where symbol_id in(select distinct symbol_id from public.portfolio_transactions where portfolio_id=p_portfolio_id)
  and trading_date>=coalesce(start_date,p_as_of_date) and trading_date<=p_as_of_date
  and quality_status='VALID' and data_revision is not null
  and not (blocked @> jsonb_build_array(symbol_id))
 ) d;
 p:=jsonb_set(p,'{capital}',to_jsonb(initial_capital+coalesce((select sum(case when movement_type='DEPOSIT' then amount else -amount end) from public.portfolio_capital_movements where portfolio_id=p_portfolio_id and effective_date<=p_as_of_date),0)));
 return jsonb_build_object('portfolio',p,'initial_capital',initial_capital,'transactions',tx,'capital_movements',movements,'prices',prices,'valuation_blocked_symbols',blocked,'as_of_date',p_as_of_date);
end $$;
revoke all on function public.portfolio_report_data(uuid,date) from public,anon;
grant execute on function public.portfolio_report_data(uuid,date) to authenticated;
