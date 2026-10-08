-- Research-only EOD event history. Published Champion signals are unchanged.
create table if not exists public.momentum_radar_assessments (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  as_of_date date not null,
  version text not null,
  event_id text,
  event_start_date date,
  breakout_date date,
  weekly_confirmed_date date,
  reacceleration_date date,
  breakout_level numeric(18,4),
  structural_stop numeric(18,4),
  stage text not null,
  entry_status text not null,
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (symbol_id, as_of_date, version),
  constraint momentum_radar_dates_check check (event_start_date is null or event_start_date <= as_of_date),
  constraint momentum_radar_prices_check check (
    (breakout_level is null or breakout_level > 0) and
    (structural_stop is null or structural_stop > 0)
  )
);
create index if not exists momentum_radar_date_stage_idx
  on public.momentum_radar_assessments (as_of_date desc, stage);
create index if not exists momentum_radar_event_idx
  on public.momentum_radar_assessments (symbol_id, event_id, as_of_date desc);
alter table public.momentum_radar_assessments enable row level security;
create policy authenticated_read_momentum_radar
  on public.momentum_radar_assessments for select to authenticated using (true);
grant select on public.momentum_radar_assessments to authenticated;
