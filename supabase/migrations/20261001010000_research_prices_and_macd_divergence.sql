-- A versioned, independently sourced research price series.  These values
-- never overwrite the exchange/vendor observations in daily_prices.
create table if not exists public.research_price_bars (
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  trading_date date not null,
  open numeric(18,4) not null check (open > 0),
  high numeric(18,4) not null check (high >= greatest(open, close, low)),
  low numeric(18,4) not null check (low <= least(open, close, high)),
  close numeric(18,4) not null check (close > 0),
  volume bigint not null check (volume >= 0),
  price_unit text not null check (price_unit = 'THOUSAND_VND_PER_SHARE'),
  basis text not null check (basis = 'KBS_VENDOR_REBASED'),
  source text not null check (source = 'KBS_PUBLIC'),
  source_version text not null,
  source_url text not null,
  collected_at timestamptz not null,
  quality_status text not null check (quality_status in ('VALID', 'QUARANTINED')),
  primary key (symbol_id, trading_date)
);
create index if not exists research_price_bars_date_idx
  on public.research_price_bars (trading_date desc);
alter table public.research_price_bars enable row level security;
create policy authenticated_read_research_price_bars
  on public.research_price_bars for select to authenticated using (true);
grant select on public.research_price_bars to authenticated;

create table if not exists public.research_price_sync_status (
  symbol_id bigint primary key references public.symbols(id) on delete restrict,
  requested_start_date date not null,
  requested_end_date date not null,
  first_date date,
  last_date date,
  vendor_bars integer not null,
  stored_bars integer not null,
  unmatched_stored_dates integer not null,
  quarantined_bars integer not null,
  coverage_status text not null check (coverage_status in ('MATCHED', 'INCOMPLETE', 'QUARANTINED')),
  source_version text not null,
  collected_at timestamptz not null default now()
);
alter table public.research_price_sync_status enable row level security;
create policy authenticated_read_research_price_sync_status
  on public.research_price_sync_status for select to authenticated using (true);
grant select on public.research_price_sync_status to authenticated;

alter table public.signal_funnel_outcomes
  add column if not exists entry_date date,
  add column if not exists entry_price numeric(18,4),
  add column if not exists exit_date date,
  add column if not exists exit_price numeric(18,4),
  add column if not exists net_return numeric(12,6),
  add column if not exists assumption_version text;

alter table public.signal_outcomes
  add column if not exists price_basis text not null default 'STORED_LEGACY',
  add column if not exists entry_date date,
  add column if not exists entry_price numeric(18,4),
  add column if not exists exit_date date,
  add column if not exists exit_price numeric(18,4),
  add column if not exists net_return numeric(12,6),
  add column if not exists assumption_version text;
update public.signal_outcomes set status = 'STALE'
where price_basis = 'STORED_LEGACY';

create or replace function public.invalidate_research_outcomes_after_price_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.open, old.high, old.low, old.close, old.volume,
      old.quality_status, old.source_version) is distinct from
     (new.open, new.high, new.low, new.close, new.volume,
      new.quality_status, new.source_version) then
    update public.signal_outcomes outcome set status = 'STALE'
    from public.signals signal
    where outcome.signal_id = signal.id and signal.symbol_id = new.symbol_id
      and signal.as_of_date <= new.trading_date;
  end if;
  return new;
end $$;
create trigger invalidate_research_outcomes_after_price_revision
after update on public.research_price_bars for each row
execute function public.invalidate_research_outcomes_after_price_revision();

create table if not exists public.macd_divergence_assessments (
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  as_of_date date not null,
  version text not null,
  oscillator text not null check (oscillator in ('MACD_LINE', 'MACD_HISTOGRAM')),
  swings integer not null check (swings in (2, 3)),
  setup_id text not null,
  stage text not null check (stage in ('WATCH_PRICE_CONFIRMATION', 'CONFIRMED', 'INVALIDATED', 'EXPIRED')),
  confirmed_on date not null,
  trigger_date date,
  trigger_price numeric(18,4) not null,
  invalidation_price numeric(18,4) not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (symbol_id, as_of_date, version, oscillator)
);
create index if not exists macd_divergence_assessments_date_idx
  on public.macd_divergence_assessments (as_of_date desc, stage);
alter table public.macd_divergence_assessments enable row level security;
create policy authenticated_read_macd_divergence_assessments
  on public.macd_divergence_assessments for select to authenticated using (true);
grant select on public.macd_divergence_assessments to authenticated;

create table if not exists public.macd_divergence_outcomes (
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  setup_id text not null,
  oscillator text not null,
  trigger_date date not null,
  horizon_days integer not null check (horizon_days in (5, 10, 20)),
  entry_date date not null,
  entry_price numeric(18,4) not null,
  exit_date date not null,
  exit_price numeric(18,4) not null,
  net_return numeric(12,6) not null,
  max_drawdown numeric(12,6) not null,
  source_version text not null,
  assumption_version text not null,
  created_at timestamptz not null default now(),
  primary key (symbol_id, setup_id, oscillator, horizon_days)
);
alter table public.macd_divergence_outcomes enable row level security;
create policy authenticated_read_macd_divergence_outcomes
  on public.macd_divergence_outcomes for select to authenticated using (true);
grant select on public.macd_divergence_outcomes to authenticated;

-- Independently verified VSDC event explains the TRC 4:1 price-basis change.
-- The vendor series remains separately versioned; this single event is not
-- represented as a complete corporate-action ledger for the universe.
insert into public.corporate_actions
  (symbol_id, action_type, ex_date, record_date, ratio, published_at,
   source, source_url, metadata)
select id, 'BONUS', date '2026-09-15', date '2026-09-16', 3,
       timestamptz '2026-08-14 08:22:35+00', 'VSDC',
       'https://vsdc.vn/vi/ad/199296',
       '{"ratio_definition":"additional_shares_per_existing_share","source_event":"199296"}'::jsonb
from public.symbols where symbol = 'TRC'
on conflict (symbol_id, action_type, ex_date, content_hash) do nothing;
