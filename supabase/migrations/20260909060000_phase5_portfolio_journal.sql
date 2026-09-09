-- Prot Stock Phase 5: one-owner portfolio and decision journal.

create table public.portfolios (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Danh mục Prot',
  capital numeric(24,2) not null check (capital > 0),
  max_risk_per_trade_pct numeric(8,4) not null default 1 check (max_risk_per_trade_pct > 0),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.positions (
  id uuid primary key default extensions.gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  quantity bigint not null check (quantity > 0),
  average_cost numeric(18,4) not null check (average_cost > 0),
  stop_price numeric(18,4) check (stop_price is null or stop_price > 0),
  opened_at date not null,
  thesis text,
  updated_at timestamptz not null default now(),
  unique (portfolio_id, symbol_id)
);

create table public.journal_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  signal_id uuid references public.signals(id) on delete set null,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  decision_date date not null,
  decision text not null check (decision in ('BUY', 'SKIP', 'SELL', 'HOLD', 'STOP')),
  setup_type text,
  market_state text,
  rationale text not null,
  result_pct numeric(12,6),
  outcome text check (outcome in ('OPEN', 'WIN', 'LOSS', 'BREAKEVEN', 'CANCELLED')),
  lesson text,
  created_at timestamptz not null default now()
);

alter table public.portfolios enable row level security;
alter table public.positions enable row level security;
alter table public.journal_entries enable row level security;
create policy owner_portfolios on public.portfolios for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_positions on public.positions for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));
create policy owner_journal on public.journal_entries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.portfolios, public.positions, public.journal_entries to authenticated;

