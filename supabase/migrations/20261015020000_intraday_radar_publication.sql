create table public.intraday_radar_sessions (
  trading_date date primary key,
  status text not null check (status in ('PROCESSING', 'INCOMPLETE', 'PUBLISHED')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  expected_symbols integer not null default 0,
  complete_symbols integer not null default 0,
  baseline_ready_symbols integer not null default 0,
  coverage_threshold numeric(4,3) not null default 0.950,
  source_errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.intraday_radar_symbol_status (
  trading_date date not null references public.intraday_radar_sessions(trading_date) on delete cascade,
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  status text not null check (status in ('COMPLETE', 'PARTIAL', 'EMPTY', 'BASELINE_SHORT', 'FAILED')),
  baseline_sessions integer not null default 0,
  source text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (trading_date, symbol_id)
);

create index intraday_radar_symbol_status_date_status_idx
  on public.intraday_radar_symbol_status (trading_date, status);

alter table public.intraday_radar_sessions enable row level security;
alter table public.intraday_radar_symbol_status enable row level security;
create policy authenticated_read_intraday_radar_sessions on public.intraday_radar_sessions
  for select to authenticated using (true);
create policy authenticated_read_intraday_radar_symbol_status on public.intraday_radar_symbol_status
  for select to authenticated using (true);
grant select on public.intraday_radar_sessions, public.intraday_radar_symbol_status to authenticated;

drop policy if exists authenticated_read_intraday_spike_events on public.intraday_spike_events;
create policy authenticated_read_intraday_spike_events on public.intraday_spike_events
  for select to authenticated using (
    exists (select 1 from public.intraday_radar_sessions r
      where r.trading_date = intraday_spike_events.trading_date and r.status = 'PUBLISHED')
  );

create or replace function public.intraday_spike_history(
  p_exact_date date default null, p_from_date date default null, p_to_date date default null,
  p_symbol text default '', p_session text default 'ALL', p_direction text default 'ALL',
  p_min_ratio numeric default 3, p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select e.id, e.symbol_id, e.trading_date, e.start_time, e.end_time,
      e.duration_minutes, e.volume, e.value_vnd, e.volume_ratio,
      e.price_change_pct, e.close_hold_pct, e.direction,
      e.baseline_sessions, e.source, s.symbol, s.sector, s.exchange
    from public.intraday_spike_events e
    join public.intraday_radar_sessions r on r.trading_date = e.trading_date and r.status = 'PUBLISHED'
    join public.symbols s on s.id = e.symbol_id
    where e.algorithm_version = 'INTRADAY_SPIKE_V0.0.0'
      and (p_exact_date is null or e.trading_date = p_exact_date)
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
    'total', totals.event_count, 'symbols', totals.symbol_count,
    'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by trading_date desc, volume_ratio desc, start_time asc, id asc) from page_rows), '[]'::jsonb)
  ) from totals;
$$;
