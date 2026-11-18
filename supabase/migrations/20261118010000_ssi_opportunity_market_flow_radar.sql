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
    from public.intraday_spike_events
    where p_minutes and symbol_id=s.id and trading_date=p_day and source =
      case when exists (select 1 from public.daily_prices dp
        where dp.symbol_id=s.id and dp.trading_date=p_day and dp.source='SSI_FASTCONNECT')
      then 'SSI_FASTCONNECT_1M' else 'VCI_DIRECT_1M' end
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
  if current_setting('protstock.ssi_cutover', true) = 'on'
    and old.source <> 'SSI_FASTCONNECT' and new.source = 'SSI_FASTCONNECT' then
    return new;
  end if;
  if (old.open, old.high, old.low, old.close, old.volume, old.quality_status,
      old.price_unit, old.source_version) is distinct from
     (new.open, new.high, new.low, new.close, new.volume, new.quality_status,
      new.price_unit, new.source_version) then
    update public.signal_outcomes outcome set status = 'STALE'
    from public.signals signal
    where outcome.signal_id = signal.id and signal.symbol_id = new.symbol_id
      and signal.as_of_date <= new.trading_date;
  end if;
  return new;
end $$;

create function public.publish_ssi_price_series(p_symbol_id bigint, p_rows jsonb)
returns integer language plpgsql set search_path = public as $$
declare written integer;
begin
  if jsonb_array_length(p_rows) not between 1 and 2500
    or exists (select 1 from jsonb_populate_recordset(null::daily_prices, p_rows) r
               where r.symbol_id is distinct from p_symbol_id or r.source is distinct from 'SSI_FASTCONNECT') then
    raise exception 'Invalid SSI cutover series';
  end if;
  if pg_database_size(current_database()) >= 400000000 then
    raise exception 'SSI cutover deferred at the PostgreSQL operating limit';
  end if;
  perform set_config('protstock.ssi_cutover', 'on', true);
  insert into daily_prices (symbol_id,trading_date,open,high,low,close,volume,source_volume,
    volume_adjustment_factor,volume_basis,price_basis,source,source_version,price_unit,
    collected_at,quality_status,data_revision)
  select r.symbol_id,r.trading_date,r.open,r.high,r.low,r.close,r.volume,r.source_volume,
    r.volume_adjustment_factor,r.volume_basis,r.price_basis,r.source,r.source_version,r.price_unit,
    r.collected_at,r.quality_status,r.data_revision
  from jsonb_populate_recordset(null::daily_prices, p_rows) r
  order by r.trading_date
  on conflict (symbol_id,trading_date) do update set open=excluded.open, high=excluded.high, low=excluded.low,
    close=excluded.close, volume=excluded.volume, source_volume=excluded.source_volume,
    volume_adjustment_factor=excluded.volume_adjustment_factor, volume_basis=excluded.volume_basis,
    price_basis=excluded.price_basis, source=excluded.source, source_version=excluded.source_version,
    price_unit=excluded.price_unit, collected_at=excluded.collected_at, quality_status=excluded.quality_status,
    data_revision=excluded.data_revision, traded_value=null, adjusted_close=null, adjustment_factor=1,
    source_url=null, raw_payload=null;
  get diagnostics written = row_count;
  return written;
end $$;
revoke all on function public.publish_ssi_price_series(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.publish_ssi_price_series(bigint,jsonb) to service_role;
