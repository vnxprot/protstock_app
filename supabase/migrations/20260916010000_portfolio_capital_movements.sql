create table if not exists public.portfolio_capital_movements (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  movement_type text not null check (movement_type in ('DEPOSIT', 'WITHDRAWAL')),
  amount numeric not null check (amount > 0),
  effective_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_capital_movements_portfolio_date_idx
  on public.portfolio_capital_movements (portfolio_id, effective_date desc, created_at desc);

alter table public.portfolio_capital_movements enable row level security;
create policy owner_portfolio_capital_movements on public.portfolio_capital_movements for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.portfolio_capital_movements to authenticated;
