-- Independent research lanes. Champion publication and portfolio tables are untouched.
create table if not exists public.challenger_strategy_assessments (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  trading_date date not null,
  engine_version varchar(32) not null,
  strategy_code varchar(32) not null check (strategy_code in ('MACD_EARLY_ZONE','SIDEWAY_RANGE')),
  action varchar(16) not null check (action in ('EARLY_PROBE','PROBE_BUY','WATCH')),
  reasons text[] not null default '{}',
  base_price numeric(18,4),
  distance_to_base_pct numeric(8,3),
  invalidation_price numeric(18,4),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (symbol_id, trading_date, engine_version, strategy_code)
);
create index if not exists challenger_strategy_date_idx
  on public.challenger_strategy_assessments (trading_date desc, strategy_code, action);
alter table public.challenger_strategy_assessments enable row level security;
create policy authenticated_read_challenger_strategy_assessments
  on public.challenger_strategy_assessments for select to authenticated using (true);
grant select on public.challenger_strategy_assessments to authenticated;

create table if not exists public.challenger_strategy_tplus_outcomes (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  signal_date date not null,
  matured_date date not null,
  engine_version varchar(32) not null,
  strategy_code varchar(32) not null check (strategy_code in ('MACD_EARLY_ZONE','SIDEWAY_RANGE')),
  action varchar(16) not null check (action in ('EARLY_PROBE','PROBE_BUY')),
  net_return_pct numeric(12,5) not null,
  locked_drawdown_pct numeric(12,5) not null,
  size_multiplier numeric(5,2) not null default 1,
  price_basis text not null default 'EOD_OHLC_T2_LOW_PROXY',
  created_at timestamptz not null default now(),
  primary key (symbol_id, signal_date, engine_version, strategy_code)
);
create index if not exists challenger_strategy_outcome_date_idx
  on public.challenger_strategy_tplus_outcomes (matured_date desc, strategy_code);
alter table public.challenger_strategy_tplus_outcomes enable row level security;
create policy authenticated_read_challenger_strategy_tplus_outcomes
  on public.challenger_strategy_tplus_outcomes for select to authenticated using (true);
grant select on public.challenger_strategy_tplus_outcomes to authenticated;
