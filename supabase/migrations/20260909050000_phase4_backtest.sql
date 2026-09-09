-- Prot Stock Phase 4: reproducible backtests pinned to immutable rule versions.

create table public.backtest_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rule_version_id uuid not null references public.rule_versions(id) on delete restrict,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  timeframe text not null default 'D' check (timeframe in ('D', 'W', 'M')),
  name text not null,
  date_from date not null,
  date_to date not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  assumptions jsonb not null,
  metrics jsonb not null default '{}'::jsonb,
  benchmark_metrics jsonb not null default '{}'::jsonb,
  equity_curve jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (date_to >= date_from)
);

create table public.backtest_trades (
  id bigint generated always as identity primary key,
  backtest_run_id uuid not null references public.backtest_runs(id) on delete cascade,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  entry_date date not null,
  exit_date date not null,
  entry_price numeric(18,4) not null,
  exit_price numeric(18,4) not null,
  quantity bigint not null check (quantity > 0),
  pnl numeric(24,2) not null,
  return_pct numeric(12,6) not null,
  exit_reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  check (exit_date >= entry_date)
);

alter table public.backtest_runs enable row level security;
alter table public.backtest_trades enable row level security;
create policy owner_backtests on public.backtest_runs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_backtest_trades on public.backtest_trades for select to authenticated
  using (exists (select 1 from public.backtest_runs b where b.id = backtest_run_id and b.user_id = auth.uid()));
grant select, insert, update, delete on public.backtest_runs to authenticated;
grant select on public.backtest_trades to authenticated;
