drop function if exists public.publish_ssi_price_series(bigint, jsonb);

create table public.daily_price_archives (
  symbol_id bigint primary key references public.symbols(id),
  first_day date not null,
  last_day date not null check (last_day >= first_day),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$')
);

alter table public.daily_price_archives enable row level security;
create policy authenticated_read_daily_price_archives on public.daily_price_archives
  for select to authenticated using (true);
grant select on public.daily_price_archives to authenticated;
grant select, insert, update, delete on public.daily_price_archives to service_role;

create policy authenticated_read_vci_price_objects on storage.objects
  for select to authenticated using (
    bucket_id = 'database-archives' and name ~ '^ohlcv/vci/([0-9]+)/[0-9a-f]{64}\.json\.gz$'
    and exists (select 1 from public.daily_price_archives a
      where name = 'ohlcv/vci/' || a.symbol_id || '/' || a.checksum || '.json.gz')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('database-archives', 'database-archives', false, null, null)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-radar-live', 'market-radar-live', false, 512000, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.opportunity_input_batch(p_day date,p_ids bigint[],p_revision text,p_minutes boolean default true) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare output jsonb;
begin
 if coalesce(cardinality(p_ids),0) not between 1 and 25 then raise exception 'Batch must contain 1 to 25 symbols'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('symbol_id',s.id,'symbol',s.symbol,'sector',s.sector,
   'technical',t.payload,'prices',d.payload,'signals',c.payload,'bursts',b.payload,
   'minute_status',ms.payload,'momentum',m.payload,'funnel',f.payload,'macd',mc.payload) order by s.id),'[]') into output
 from public.symbols s
 cross join lateral(select jsonb_agg(to_jsonb(q) order by q.as_of_date) payload from
   (select as_of_date,close,ema20,rsi14,macd_histogram,volume_avg20,volume_ratio20,cmf20,atr14,
     jsonb_build_object('state',monthly_context->>'state') monthly_context
    from public.technical_snapshots where symbol_id=s.id and timeframe='D' and as_of_date<=p_day
    order by as_of_date desc limit 4) q) t
 cross join lateral(select jsonb_agg(to_jsonb(q) order by q.trading_date) payload from
   (select trading_date,open,high,low,close,volume,quality_status from public.daily_prices
    where symbol_id=s.id and trading_date<=p_day order by trading_date desc limit 25) q) d
 cross join lateral(select coalesce(jsonb_agg(to_jsonb(q)),'[]') payload from
   (select timeframe,composite_action,signal_state,trigger_price,invalidation_price
    from public.consolidated_signals where symbol_id=s.id and as_of_date=p_day and source_revision=p_revision) q) c
 cross join lateral(select coalesce(jsonb_agg(to_jsonb(q)),'[]') payload from
   (select id,start_time,end_time,volume,value_vnd,price_change_pct,direction,baseline_sessions
    from public.intraday_spike_events where p_minutes and symbol_id=s.id and trading_date=p_day and source='VCI_DIRECT_1M'
    order by start_time,id) q) b
 left join lateral(select jsonb_build_object('status',status,'baseline_sessions',baseline_sessions) payload
   from public.intraday_radar_symbol_status where p_minutes and symbol_id=s.id and trading_date=p_day limit 1) ms on true
 left join lateral(select jsonb_build_object('stage',stage,'entry_status',entry_status,
     'evidence',jsonb_build_object('monthly_state',evidence->>'monthly_state')) payload
   from public.momentum_radar_assessments where symbol_id=s.id and as_of_date=p_day
   and version='MOMENTUM_RADAR_V0_0_0_TREND1' limit 1) m on true
 left join lateral(select jsonb_build_object('stage',stage) payload from public.signal_funnel_assessments
   where symbol_id=s.id and as_of_date=p_day and version='MTF_FUNNEL_SHADOW_V0_0_0_TREND1' limit 1) f on true
 -- Aggregate variants inside one stock; never multiply the stock by swing count.
 left join lateral(select jsonb_build_object('stage',stage,'swings',swings,'trigger_date',trigger_date) payload
   from public.macd_divergence_assessments where symbol_id=s.id and as_of_date=p_day
   and version='MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0' and oscillator='MACD_LINE'
   order by case when stage='CONFIRMED' and trigger_date=p_day then 0 when stage='WATCH_PRICE_CONFIRMATION' then 1
     when stage='WATCH_PIVOT_CONFIRMATION' then 2 when stage='CONFIRMED' then 3 else 4 end,swings desc limit 1) mc on true
 where s.active and s.id=any(p_ids);
 return output;
end $$;

create or replace function public.invalidate_outcomes_after_price_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.open, old.high, old.low, old.close, old.volume, old.quality_status,
      old.price_unit, old.source_version) is distinct from
     (new.open, new.high, new.low, new.close, new.volume, new.quality_status,
      new.price_unit, new.source_version) then
    update public.signal_outcomes outcome set status = 'STALE'
    from public.signals signal
    where outcome.signal_id = signal.id
      and signal.symbol_id = new.symbol_id
      and signal.as_of_date <= new.trading_date;
  end if;
  return new;
end $$;

create or replace function public.stock_analysis_data(p_symbol text,p_timeframe text default 'D',p_as_of_date date default null,p_history_limit integer default 500,p_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare stock public.symbols%rowtype; technical jsonb; technical_date date; prices jsonb; patterns jsonb; zones jsonb; disclosures jsonb; fundamentals jsonb; decision jsonb; basis_revision text;
begin
 if p_timeframe not in ('D','W','M') then raise exception 'Invalid timeframe'; end if;
 select * into stock from public.symbols where symbol=upper(p_symbol);
 if not found then raise exception 'Symbol not found'; end if;
 select to_jsonb(t),t.as_of_date into technical,technical_date from public.technical_snapshots t
 where symbol_id=stock.id and timeframe=p_timeframe and algorithm_version in ('core-rules-v0.0.0-trend1','core-rules-v0.0.0')
   and (p_as_of_date is null or as_of_date<=p_as_of_date)
 order by as_of_date desc, (algorithm_version='core-rules-v0.0.0-trend1') desc limit 1;
 select d.data_revision into basis_revision from public.daily_prices d
 where d.symbol_id=stock.id and (d.quality_status='VALID' or (d.quality_status='WARNING' and d.price_basis='VENDOR_CORPORATE_ACTION_ADJUSTED')) and d.data_revision is not null
   and (p_as_of_date is null or d.trading_date<=p_as_of_date)
 order by d.trading_date desc limit 1;
 if p_timeframe='D' then
  select coalesce(jsonb_agg(to_jsonb(p) order by trading_date),'[]'::jsonb) into prices from (
   select trading_date,open,high,low,close,volume,source,price_basis,volume_basis,volume_adjustment_factor,data_revision
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
 select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into patterns from (select * from public.pattern_instances where symbol_id=stock.id and timeframe=p_timeframe and as_of_date=technical_date and algorithm_version=technical->>'algorithm_version' order by quality_score desc,id limit 8) p;
 select coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) into zones from (select id,zone_type,lower_price,upper_price,touches,strength,as_of_date,evidence from public.support_resistance_zones where symbol_id=stock.id and timeframe=p_timeframe and active and as_of_date=technical_date and algorithm_version=technical->>'algorithm_version' order by strength desc,id limit 24) z;
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into disclosures from (select id,title,category,published_at,available_from,source,source_url from public.disclosures where symbol_id=stock.id and available_from<=coalesce(p_as_of_date,current_date) order by published_at desc,id limit 6) d;
 select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into fundamentals from (
  select id,period_end,published_at,available_from,source,coalesce((select jsonb_build_array(jsonb_build_object('revenue',m.revenue,'eps',m.eps,'roe',m.roe,'debt_to_equity',m.debt_to_equity,'operating_cash_flow',m.operating_cash_flow)) from public.fundamental_metrics m where m.period_id=fp.id),'[]'::jsonb) fundamental_metrics
  from public.fundamental_periods fp where symbol_id=stock.id and source<>'VNSTOCK_VCI_PROVISIONAL' and available_from<=coalesce(p_as_of_date,current_date) order by period_end desc,id limit 4
 ) f;
 select jsonb_build_object('as_of_date',as_of_date,'timeframe',timeframe,'composite_action',composite_action,'reasons',reasons,'source_revision',source_revision)
 into decision from public.consolidated_signals where symbol_id=stock.id and timeframe=p_timeframe and as_of_date=technical_date and source_revision=technical->>'algorithm_version'
 and (p_revision is null or source_revision=p_revision)
 and not ('Prot Core Pack · Phân kỳ Dương MACD'=any(consensus_engines)) limit 1;
 return jsonb_build_object('symbol',jsonb_build_object('id',stock.id,'symbol',stock.symbol,'sector',stock.sector,'exchange',stock.exchange,'company_name',stock.company_name),'prices',prices,'technical',case when technical is null then '[]'::jsonb else jsonb_build_array(technical) end,'decision',decision,'patterns',patterns,'zones',zones,'disclosures',disclosures,'fundamentals',fundamentals);
end $$;

create or replace function public.publish_market_radar_tape(p_rows jsonb, p_fill_only boolean)
returns void language sql set search_path = public as $$
insert into market_radar_daily as old
select r.* from jsonb_populate_recordset(null::market_radar_daily, p_rows) as r
where r.method in ('continuous', 'continuous_cluster', 'auction')
  and (not p_fill_only or (not r.partial and r.reference_volume is not null))
on conflict (trading_date, exchange, symbol, category, method) do update set
  source = excluded.source, partial = excluded.partial, tape_reason = excluded.tape_reason,
  reference_volume = excluded.reference_volume, tape_volume = excluded.tape_volume,
  buy_value = excluded.buy_value, sell_value = excluded.sell_value, unknown_value = excluded.unknown_value,
  buy_volume = excluded.buy_volume, sell_volume = excluded.sell_volume, unknown_volume = excluded.unknown_volume,
  buy_count = excluded.buy_count, sell_count = excluded.sell_count, unknown_count = excluded.unknown_count,
  trade_count = excluded.trade_count, market_value = excluded.market_value,
  auction_breakdown = excluded.auction_breakdown
where (old.reference_volume is null or old.partial or (not p_fill_only and not excluded.partial))
  and (old.auction_breakdown is null or excluded.auction_breakdown is not null);
$$;
