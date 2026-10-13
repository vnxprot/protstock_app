-- Accept vendor-adjusted price rows labelled WARNING only for unresolved volume events.
create or replace function public.stock_analysis_data(p_symbol text,p_timeframe text default 'D',p_as_of_date date default null,p_history_limit integer default 500,p_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare stock public.symbols%rowtype; technical jsonb; technical_date date; prices jsonb; patterns jsonb; zones jsonb; disclosures jsonb; fundamentals jsonb; decision jsonb; basis_revision text;
begin
 if p_timeframe not in ('D','W','M') then raise exception 'Invalid timeframe'; end if;
 select * into stock from public.symbols where symbol=upper(p_symbol);
 if not found then raise exception 'Symbol not found'; end if;
 select to_jsonb(t),t.as_of_date into technical,technical_date from public.technical_snapshots t
 where symbol_id=stock.id and timeframe=p_timeframe and algorithm_version='core-rules-v0.0.0'
   and (p_as_of_date is null or as_of_date<=p_as_of_date)
 order by as_of_date desc limit 1;
 select d.data_revision into basis_revision from public.daily_prices d
 where d.symbol_id=stock.id and (d.quality_status='VALID' or (d.quality_status='WARNING' and d.price_basis='VENDOR_CORPORATE_ACTION_ADJUSTED')) and d.data_revision is not null
   and (p_as_of_date is null or d.trading_date<=p_as_of_date)
 order by d.trading_date desc limit 1;
 if p_timeframe='D' then
  select coalesce(jsonb_agg(to_jsonb(p) order by trading_date),'[]'::jsonb) into prices from (
   select trading_date,open,high,low,close,volume,source,price_basis,volume_basis,volume_adjustment_factor
   from public.daily_prices where symbol_id=stock.id and data_revision=basis_revision and (quality_status='VALID' or (quality_status='WARNING' and price_basis='VENDOR_CORPORATE_ACTION_ADJUSTED'))
     and (p_as_of_date is null or trading_date<=p_as_of_date)
   order by trading_date desc limit least(greatest(p_history_limit,100),2600)) p;
 else
  select coalesce(jsonb_agg(to_jsonb(p) order by trading_date),'[]'::jsonb) into prices from (
   select source_last_date trading_date,open,high,low,close,volume,is_complete
   from public.derived_bars where symbol_id=stock.id and timeframe=p_timeframe and data_revision=basis_revision
     and (p_as_of_date is null or source_last_date<=p_as_of_date)
   order by period_start desc limit case when p_timeframe='W' then 520 else 120 end) p;
 end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into patterns from (select * from public.pattern_instances where symbol_id=stock.id and timeframe=p_timeframe and as_of_date=technical_date order by quality_score desc,id limit 8) p;
 select coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) into zones from (select id,zone_type,lower_price,upper_price,touches,strength,as_of_date,evidence from public.support_resistance_zones where symbol_id=stock.id and timeframe=p_timeframe and active and as_of_date=technical_date order by strength desc,id limit 24) z;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into disclosures from (select id,title,category,published_at,available_from,source,source_url from public.disclosures where symbol_id=stock.id and available_from<=coalesce(p_as_of_date,current_date) order by published_at desc,id limit 6) d;
 select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into fundamentals from (
  select id,period_end,published_at,available_from,source,coalesce((select jsonb_build_array(jsonb_build_object('revenue',m.revenue,'eps',m.eps,'roe',m.roe,'debt_to_equity',m.debt_to_equity,'operating_cash_flow',m.operating_cash_flow)) from public.fundamental_metrics m where m.period_id=fp.id),'[]'::jsonb) fundamental_metrics
  from public.fundamental_periods fp where symbol_id=stock.id and source<>'VNSTOCK_VCI_PROVISIONAL' and available_from<=coalesce(p_as_of_date,current_date) order by period_end desc,id limit 4
 ) f;
 select jsonb_build_object('as_of_date',as_of_date,'timeframe',timeframe,'composite_action',composite_action,'reasons',reasons,'source_revision',source_revision)
 into decision from public.consolidated_signals where symbol_id=stock.id and timeframe=p_timeframe and as_of_date=technical_date and source_revision='core-rules-v0.0.0'
 and (p_revision is null or source_revision=p_revision)
 and not ('Prot Core Pack · Phân kỳ Dương MACD'=any(consensus_engines)) limit 1;
 return jsonb_build_object('symbol',jsonb_build_object('id',stock.id,'symbol',stock.symbol,'sector',stock.sector,'exchange',stock.exchange,'company_name',stock.company_name),'prices',prices,'technical',case when technical is null then '[]'::jsonb else jsonb_build_array(technical) end,'decision',decision,'patterns',patterns,'zones',zones,'disclosures',disclosures,'fundamentals',fundamentals);
end $$;
revoke all on function public.stock_analysis_data(text,text,date,integer,text) from public,anon;
grant execute on function public.stock_analysis_data(text,text,date,integer,text) to authenticated;
