-- Published quotes remain visible even when portfolio entitlements need reconciliation.
-- Keep portfolio_report_data's NAV/return guards independent of this display endpoint.
create or replace function public.portfolio_market_quotes(p_portfolio_id uuid,p_as_of_date date default current_date)
returns table(symbol_id bigint,trading_date date,close numeric)
language sql stable security invoker set search_path='' as $$
 select q.symbol_id,q.trading_date,q.close
 from public.positions h
 join public.portfolios p on p.id=h.portfolio_id and p.user_id=auth.uid()
 cross join lateral (
  select d.symbol_id,d.trading_date,d.close
  from public.daily_prices d
  where d.symbol_id=h.symbol_id and d.trading_date<=p_as_of_date
   and d.quality_status='VALID' and d.data_revision is not null and d.close>0
  order by d.trading_date desc limit 2
 ) q
 where h.portfolio_id=p_portfolio_id and h.quantity>0;
$$;
revoke all on function public.portfolio_market_quotes(uuid,date) from public,anon;
grant execute on function public.portfolio_market_quotes(uuid,date) to authenticated;
notify pgrst,'reload schema';
