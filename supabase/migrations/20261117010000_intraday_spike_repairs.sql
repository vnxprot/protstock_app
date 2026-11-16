alter table public.intraday_minute_days
  add column reference_source text,
  add column session_close text;

create function public.save_intraday_spike_result(
  p_day date, p_symbol_id bigint, p_version text, p_status text, p_baseline integer,
  p_source text, p_error text, p_retryable boolean, p_minute_day jsonb, p_events jsonb
) returns void language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_day::text || ':' || p_symbol_id::text, 0));
  if p_status = 'FAILED' and exists (
    select 1 from public.intraday_radar_symbol_status
    where trading_date = p_day and symbol_id = p_symbol_id and status = 'COMPLETE'
  ) then
    return;
  end if;

  if p_status <> 'FAILED' then
    if jsonb_typeof(p_minute_day) = 'object' then
      insert into public.intraday_minute_days (
        symbol_id, trading_date, bars, bar_count, minute_volume, daily_volume, coverage_status,
        source, data_revision, reference_source, session_close, collected_at
      )
      select p_symbol_id, p_day, r.bars, r.bar_count, r.minute_volume, r.daily_volume, r.coverage_status,
        r.source, r.data_revision, r.reference_source, r.session_close, r.collected_at
      from jsonb_populate_record(null::public.intraday_minute_days, p_minute_day) r
      on conflict (symbol_id, trading_date) do update set
        bars = excluded.bars, bar_count = excluded.bar_count, minute_volume = excluded.minute_volume,
        daily_volume = excluded.daily_volume, coverage_status = excluded.coverage_status,
        source = excluded.source, data_revision = excluded.data_revision, reference_source = excluded.reference_source,
        session_close = excluded.session_close, collected_at = excluded.collected_at;
    else
      delete from public.intraday_minute_days where symbol_id = p_symbol_id and trading_date = p_day;
    end if;

    delete from public.intraday_spike_events e
    where e.symbol_id = p_symbol_id and e.trading_date = p_day and e.algorithm_version = p_version
      and not exists (select 1 from jsonb_array_elements(p_events) item where item->>'start_time' = e.start_time);

    insert into public.intraday_spike_events (
      symbol_id, trading_date, start_time, end_time, duration_minutes, volume, value_vnd, volume_ratio,
      price_change_pct, close_hold_pct, direction, baseline_sessions, algorithm_version, source
    )
    select p_symbol_id, p_day, r.start_time, r.end_time, r.duration_minutes, r.volume, r.value_vnd, r.volume_ratio,
      r.price_change_pct, r.close_hold_pct, r.direction, r.baseline_sessions, p_version, p_source
    from jsonb_populate_recordset(null::public.intraday_spike_events, p_events) r
    on conflict (symbol_id, trading_date, start_time, algorithm_version) do update set
      end_time = excluded.end_time, duration_minutes = excluded.duration_minutes, volume = excluded.volume,
      value_vnd = excluded.value_vnd, volume_ratio = excluded.volume_ratio, price_change_pct = excluded.price_change_pct,
      close_hold_pct = excluded.close_hold_pct, direction = excluded.direction, baseline_sessions = excluded.baseline_sessions,
      source = excluded.source;
  end if;

  insert into public.intraday_radar_symbol_status
    (trading_date, symbol_id, status, baseline_sessions, source, error, retryable)
  values (p_day, p_symbol_id, p_status, p_baseline, p_source, p_error, p_retryable)
  on conflict (trading_date, symbol_id) do update set
    status = excluded.status, baseline_sessions = excluded.baseline_sessions, source = excluded.source,
    error = excluded.error, retryable = excluded.retryable, updated_at = now();
end $$;

revoke all on function public.save_intraday_spike_result(date,bigint,text,text,integer,text,text,boolean,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_intraday_spike_result(date,bigint,text,text,integer,text,text,boolean,jsonb,jsonb)
  to service_role;
notify pgrst, 'reload schema';
