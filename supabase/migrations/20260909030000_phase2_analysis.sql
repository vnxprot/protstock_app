-- Prot Stock Phase 2: point-in-time technical snapshots and explainable patterns.

create table public.technical_snapshots (
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  timeframe text not null check (timeframe in ('D', 'W', 'M')),
  as_of_date date not null,
  close numeric(18,4) not null,
  sma20 numeric(18,4),
  sma50 numeric(18,4),
  sma200 numeric(18,4),
  ema20 numeric(18,4),
  ema50 numeric(18,4),
  rsi14 numeric(10,4),
  macd numeric(18,6),
  macd_signal numeric(18,6),
  macd_histogram numeric(18,6),
  bollinger_upper numeric(18,4),
  bollinger_middle numeric(18,4),
  bollinger_lower numeric(18,4),
  atr14 numeric(18,4),
  volume_avg20 numeric(24,2),
  volume_ratio20 numeric(12,4),
  relative_strength_market numeric(18,6),
  relative_strength_sector numeric(18,6),
  trend_state text not null default 'UNKNOWN'
    check (trend_state in ('UP', 'DOWN', 'SIDEWAYS', 'UNKNOWN')),
  input_last_date date not null,
  algorithm_version text not null,
  calculated_at timestamptz not null default now(),
  primary key (symbol_id, timeframe, as_of_date)
);

create index technical_snapshots_lookup_idx
  on public.technical_snapshots (symbol_id, timeframe, as_of_date desc);

create table public.support_resistance_zones (
  id uuid primary key default extensions.gen_random_uuid(),
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  timeframe text not null check (timeframe in ('D', 'W', 'M')),
  zone_type text not null check (zone_type in ('SUPPORT', 'RESISTANCE')),
  start_date date not null,
  as_of_date date not null,
  lower_price numeric(18,4) not null check (lower_price > 0),
  upper_price numeric(18,4) not null check (upper_price >= lower_price),
  touches integer not null default 1 check (touches > 0),
  strength numeric(10,4) not null default 0 check (strength between 0 and 100),
  active boolean not null default true,
  evidence jsonb not null default '{}'::jsonb,
  algorithm_version text not null,
  calculated_at timestamptz not null default now(),
  unique (symbol_id, timeframe, as_of_date, zone_type, lower_price, upper_price)
);

create table public.pattern_instances (
  id uuid primary key default extensions.gen_random_uuid(),
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  timeframe text not null check (timeframe in ('D', 'W', 'M')),
  pattern_type text not null check (pattern_type in (
    'ACCUMULATION_BASE', 'DOUBLE_BOTTOM', 'DOUBLE_TOP',
    'ASCENDING_TRIANGLE', 'DESCENDING_TRIANGLE', 'SYMMETRICAL_TRIANGLE',
    'BULL_FLAG', 'BEAR_FLAG', 'CANDLE_SUPPORT'
  )),
  state text not null check (state in ('FORMING', 'READY', 'CONFIRMED', 'FAILED', 'EXPIRED', 'SUPERSEDED')),
  start_date date not null,
  end_date date not null,
  as_of_date date not null,
  confirmed_at date,
  trigger_price numeric(18,4),
  invalidation_price numeric(18,4),
  quality_score numeric(10,4) not null check (quality_score between 0 and 100),
  direction text not null check (direction in ('BULLISH', 'BEARISH', 'NEUTRAL')),
  evidence jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  algorithm_version text not null,
  calculated_at timestamptz not null default now(),
  unique (symbol_id, timeframe, pattern_type, start_date, as_of_date, algorithm_version),
  check (end_date >= start_date),
  check (confirmed_at is null or confirmed_at between start_date and as_of_date)
);

create index pattern_instances_lookup_idx
  on public.pattern_instances (symbol_id, timeframe, as_of_date desc, quality_score desc);

create table public.pattern_points (
  id bigint generated always as identity primary key,
  pattern_id uuid not null references public.pattern_instances(id) on delete cascade,
  point_type text not null,
  point_date date not null,
  price numeric(18,4) not null check (price > 0),
  sequence integer not null default 1 check (sequence > 0),
  metadata jsonb not null default '{}'::jsonb,
  unique (pattern_id, point_type, sequence)
);

create table public.fundamental_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  period_type text not null check (period_type in ('QUARTER', 'YEAR')),
  fiscal_year integer not null,
  fiscal_quarter integer check (fiscal_quarter between 1 and 4),
  period_end date not null,
  published_at timestamptz not null,
  available_from date not null,
  source text not null,
  source_url text,
  collected_at timestamptz not null default now(),
  content_hash text,
  unique nulls not distinct (symbol_id, period_type, fiscal_year, fiscal_quarter, content_hash)
);

create table public.fundamental_metrics (
  period_id uuid primary key references public.fundamental_periods(id) on delete cascade,
  revenue numeric(24,2),
  revenue_growth numeric(12,4),
  eps numeric(18,4),
  eps_growth numeric(12,4),
  gross_margin numeric(12,4),
  net_margin numeric(12,4),
  roe numeric(12,4),
  debt_to_equity numeric(12,4),
  operating_cash_flow numeric(24,2),
  free_cash_flow numeric(24,2),
  raw_metrics jsonb not null default '{}'::jsonb
);

create view public.latest_technical_snapshots
with (security_invoker = true)
as
select distinct on (t.symbol_id, t.timeframe)
  t.*, s.symbol, s.sector
from public.technical_snapshots t
join public.symbols s on s.id = t.symbol_id
where s.active
order by t.symbol_id, t.timeframe, t.as_of_date desc;

alter table public.technical_snapshots enable row level security;
alter table public.support_resistance_zones enable row level security;
alter table public.pattern_instances enable row level security;
alter table public.pattern_points enable row level security;
alter table public.fundamental_periods enable row level security;
alter table public.fundamental_metrics enable row level security;

create policy authenticated_read_technical on public.technical_snapshots for select to authenticated using (true);
create policy authenticated_read_zones on public.support_resistance_zones for select to authenticated using (true);
create policy authenticated_read_patterns on public.pattern_instances for select to authenticated using (true);
create policy authenticated_read_pattern_points on public.pattern_points for select to authenticated using (true);
create policy authenticated_read_fundamental_periods on public.fundamental_periods for select to authenticated using (true);
create policy authenticated_read_fundamental_metrics on public.fundamental_metrics for select to authenticated using (true);

grant select on public.technical_snapshots, public.support_resistance_zones,
  public.pattern_instances, public.pattern_points, public.fundamental_periods,
  public.fundamental_metrics, public.latest_technical_snapshots to authenticated;

