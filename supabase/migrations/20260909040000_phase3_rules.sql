-- Prot Stock Phase 3: versioned rules and explainable signals.

create table if not exists public.rules (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  input_text text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rule_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  version integer not null check (version > 0),
  dsl jsonb not null,
  compiled_hash text not null,
  created_at timestamptz not null default now(),
  unique (rule_id, version),
  unique (rule_id, compiled_hash)
);

create table if not exists public.signals (
  id uuid primary key default extensions.gen_random_uuid(),
  rule_version_id uuid not null references public.rule_versions(id) on delete restrict,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  timeframe text not null check (timeframe in ('D', 'W', 'M')),
  as_of_date date not null,
  action text not null check (action in ('WATCH', 'BUY', 'SELL', 'STOP', 'EXIT')),
  score numeric(10,4) not null default 0 check (score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (rule_version_id, symbol_id, timeframe, as_of_date, action)
);

create index if not exists signals_screener_idx on public.signals (as_of_date desc, score desc);

alter table public.rules enable row level security;
alter table public.rule_versions enable row level security;
alter table public.signals enable row level security;

drop policy if exists owner_rules on public.rules;
drop policy if exists owner_rule_versions on public.rule_versions;
drop policy if exists owner_signals_read on public.signals;
create policy owner_rules on public.rules for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_rule_versions on public.rule_versions for all to authenticated
  using (exists (select 1 from public.rules r where r.id = rule_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.rules r where r.id = rule_id and r.user_id = auth.uid()));
create policy owner_signals_read on public.signals for select to authenticated
  using (exists (select 1 from public.rule_versions rv join public.rules r on r.id = rv.rule_id where rv.id = rule_version_id and r.user_id = auth.uid()));

grant select, insert, update, delete on public.rules, public.rule_versions to authenticated;
grant select on public.signals to authenticated;
