create or replace function public.intraday_spike_history(
  p_exact_date date default null,
  p_from_date date default null,
  p_to_date date default null,
  p_symbol text default '',
  p_session text default 'ALL',
  p_direction text default 'ALL',
  p_min_ratio numeric default 3,
  p_page integer default 1,
  p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select e.id, e.symbol_id, e.trading_date, e.start_time, e.end_time,
      e.duration_minutes, e.volume, e.value_vnd, e.volume_ratio,
      e.price_change_pct, e.close_hold_pct, e.direction,
      e.baseline_sessions, e.source, s.symbol, s.sector, s.exchange
    from public.intraday_spike_events e
    join public.symbols s on s.id = e.symbol_id
    where (p_exact_date is null or e.trading_date = p_exact_date)
      and (p_from_date is null or e.trading_date >= p_from_date)
      and (p_to_date is null or e.trading_date <= p_to_date)
      and (coalesce(p_symbol, '') = '' or s.symbol ilike '%' || p_symbol || '%')
      and (p_session = 'ALL' or p_session = 'AM' and e.start_time < '12:00'
        or p_session = 'PM' and e.start_time >= '12:00')
      and (p_direction = 'ALL' or e.direction = p_direction)
      and e.volume_ratio >= greatest(coalesce(p_min_ratio, 3), 0)
  ), totals as (
    select count(*) as event_count, count(distinct symbol_id) as symbol_count from filtered
  ), page_rows as (
    select * from filtered
    order by trading_date desc, volume_ratio desc, start_time asc, id asc
    limit least(greatest(coalesce(p_page_size, 25), 1), 100)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 25), 1), 100)
  )
  select jsonb_build_object(
    'total', totals.event_count,
    'symbols', totals.symbol_count,
    'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by trading_date desc, volume_ratio desc, start_time asc, id asc) from page_rows), '[]'::jsonb)
  ) from totals;
$$;

revoke all on function public.intraday_spike_history(date,date,date,text,text,text,numeric,integer,integer) from public;
grant execute on function public.intraday_spike_history(date,date,date,text,text,text,numeric,integer,integer) to authenticated;
