-- Trading-session metadata is required to decide whether weekly/monthly bars are complete.

create table public.data_sources (
  code text primary key check (code = upper(code)),
  name text not null,
  source_type text not null check (source_type in ('MARKET_DATA', 'DISCLOSURE', 'CORPORATE_ACTION', 'CALENDAR')),
  official boolean not null default false,
  base_url text,
  terms_url text,
  active boolean not null default true,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger data_sources_set_updated_at
before update on public.data_sources
for each row execute function public.set_updated_at();

create table public.trading_sessions (
  exchange text not null check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  trading_date date not null,
  is_open boolean not null,
  session_close_at timestamptz,
  source text not null,
  collected_at timestamptz not null default now(),
  notes text,
  primary key (exchange, trading_date),
  check (not is_open or session_close_at is not null)
);

create index trading_sessions_open_date_idx
  on public.trading_sessions (trading_date desc) where is_open;

create view public.data_health_summary
with (security_invoker = true)
as
select
  (select count(*) from public.symbols where active) as active_symbols,
  (select max(trading_date) from public.daily_prices) as latest_price_date,
  (select count(*) from public.daily_prices where quality_status = 'WARNING') as price_warnings,
  (select max(collected_at) from public.disclosures) as latest_disclosure_collection,
  (select max(started_at) from public.job_runs where status = 'SUCCEEDED') as latest_successful_job,
  (select count(*) from public.job_runs where status = 'FAILED' and started_at >= now() - interval '7 days') as failed_jobs_7d;

alter table public.data_sources enable row level security;
alter table public.trading_sessions enable row level security;

create policy authenticated_read_data_sources on public.data_sources for select to authenticated using (true);
create policy authenticated_read_trading_sessions on public.trading_sessions for select to authenticated using (true);

grant select on public.data_sources, public.trading_sessions, public.data_health_summary to authenticated;
