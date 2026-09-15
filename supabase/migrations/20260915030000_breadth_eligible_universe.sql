-- Keep data completeness separate from the investable breadth sample.
-- A daily membership row makes exclusions auditable and point-in-time safe.

alter table public.market_breadth_snapshots
  add column if not exists universe_size integer not null default 0 check (universe_size >= 0),
  add column if not exists eligible_count integer not null default 0 check (eligible_count >= 0),
  add column if not exists observed_count integer not null default 0 check (observed_count >= 0),
  add column if not exists coverage_ratio numeric(7,4),
  add column if not exists coverage_status text not null default 'LEGACY'
    check (coverage_status in ('LEGACY', 'BOOTSTRAP', 'COMPLETE', 'DEGRADED', 'INCOMPLETE'));

update public.market_breadth_snapshots
set universe_size = case when universe_size = 0 then sample_size else universe_size end,
    eligible_count = case when eligible_count = 0 then sample_size else eligible_count end,
    observed_count = case when observed_count = 0 then sample_size else observed_count end,
    coverage_ratio = coalesce(coverage_ratio, case when sample_size > 0 then 1 else null end)
where coverage_status = 'LEGACY';

create table if not exists public.breadth_universe_memberships (
  trading_date date not null,
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  status text not null check (status in ('ELIGIBLE', 'DATA_MISSING_OR_HALTED', 'INSUFFICIENT_HISTORY', 'NOT_ELIGIBLE')),
  is_eligible boolean not null,
  is_observed boolean not null,
  created_at timestamptz not null default now(),
  primary key (trading_date, symbol_id)
);

create index if not exists breadth_universe_memberships_status_idx
  on public.breadth_universe_memberships (trading_date desc, status);

alter table public.breadth_universe_memberships enable row level security;
drop policy if exists authenticated_read_breadth_universe_memberships on public.breadth_universe_memberships;
create policy authenticated_read_breadth_universe_memberships
  on public.breadth_universe_memberships for select to authenticated using (true);
grant select on public.breadth_universe_memberships to authenticated;
