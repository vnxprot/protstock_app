-- Separate read-only-to-users shadow lane; Champion tables and publication pointers are unchanged.
create table if not exists public.challenger_signal_assessments (
  id bigserial primary key,
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  trading_date date not null,
  engine_version varchar(32) not null default 'v2.0-challenger',
  action varchar(16) not null check (action in ('PROBE_BUY','ADD','EARLY_PROBE','WATCH','REDUCE','EXIT')),
  reasons text[] not null default '{}',
  base_price numeric(18,4),
  distance_to_base_pct numeric(8,3),
  invalidation_price numeric(18,4),
  confidence_score numeric(5,2),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint uq_challenger_signal unique (symbol_id, trading_date, engine_version)
);
create index if not exists idx_challenger_date_action on public.challenger_signal_assessments (trading_date desc, action);
alter table public.challenger_signal_assessments enable row level security;
create policy authenticated_read_challenger_signal_assessments
  on public.challenger_signal_assessments for select to authenticated using (true);
grant select on public.challenger_signal_assessments to authenticated;

create table if not exists public.dual_engine_tplus_outcomes (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  signal_date date not null,
  matured_date date not null,
  engine varchar(16) not null check (engine in ('CHAMPION','CHALLENGER')),
  action varchar(16) not null,
  net_return_pct numeric(12,5) not null,
  locked_drawdown_pct numeric(12,5) not null,
  price_basis text not null default 'EOD_OHLC_T2_LOW_PROXY',
  created_at timestamptz not null default now(),
  primary key (symbol_id, signal_date, engine)
);
create index if not exists idx_dual_engine_outcomes_matured on public.dual_engine_tplus_outcomes (matured_date desc, engine);
alter table public.dual_engine_tplus_outcomes enable row level security;
create policy authenticated_read_dual_engine_tplus_outcomes
  on public.dual_engine_tplus_outcomes for select to authenticated using (true);
grant select on public.dual_engine_tplus_outcomes to authenticated;
