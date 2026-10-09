create table public.intraday_minute_days (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  trading_date date not null,
  bars jsonb not null default '[]'::jsonb,
  bar_count integer not null default 0,
  minute_volume bigint not null default 0,
  daily_volume bigint,
  coverage_status text not null check (coverage_status in ('COMPLETE','PARTIAL','EMPTY')),
  source text not null,
  collected_at timestamptz not null default now(),
  primary key (symbol_id, trading_date)
);
create index intraday_minute_days_date_idx on public.intraday_minute_days (trading_date desc);

create table public.intraday_spike_events (
  id bigint generated always as identity primary key,
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  trading_date date not null,
  start_time text not null,
  end_time text not null,
  duration_minutes integer not null,
  volume bigint not null,
  value_vnd numeric(24,2) not null,
  volume_ratio numeric(12,3) not null,
  price_change_pct numeric(10,3) not null,
  close_hold_pct numeric(10,3),
  direction text not null check (direction in ('UP','DOWN','FLAT','REVERSED_UP','REVERSED_DOWN')),
  baseline_sessions integer not null,
  algorithm_version text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (symbol_id,trading_date,start_time,algorithm_version)
);
create index intraday_spike_events_date_idx on public.intraday_spike_events (trading_date desc, volume_ratio desc);
create index intraday_spike_events_symbol_date_idx on public.intraday_spike_events (symbol_id, trading_date desc);

alter table public.intraday_minute_days enable row level security;
alter table public.intraday_spike_events enable row level security;
create policy authenticated_read_intraday_minute_days on public.intraday_minute_days for select to authenticated using (true);
create policy authenticated_read_intraday_spike_events on public.intraday_spike_events for select to authenticated using (true);
grant select on public.intraday_minute_days, public.intraday_spike_events to authenticated;
