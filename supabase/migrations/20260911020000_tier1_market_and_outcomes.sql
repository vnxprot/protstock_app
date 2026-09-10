-- Tier 1: prior-day market breadth and read-only signal outcome research.

create table if not exists public.market_breadth_snapshots (
  trading_date date primary key,
  pct_above_sma50 numeric(7,4),
  sample_size integer not null default 0 check (sample_size >= 0),
  vnindex_trend_state text not null default 'UNKNOWN'
    check (vnindex_trend_state in ('UP', 'DOWN', 'SIDEWAYS', 'UNKNOWN')),
  calculated_at timestamptz not null default now()
);

create table if not exists public.signal_outcomes (
  id uuid primary key default extensions.gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  horizon_days integer not null check (horizon_days in (5, 10, 20)),
  forward_return_pct numeric(12,6) not null,
  max_drawdown_pct numeric(12,6) not null,
  hit_invalidation boolean not null default false,
  evaluated_at timestamptz not null default now(),
  unique (signal_id, horizon_days)
);

create index if not exists signal_outcomes_signal_idx on public.signal_outcomes (signal_id, horizon_days);

alter table public.market_breadth_snapshots enable row level security;
alter table public.signal_outcomes enable row level security;
drop policy if exists authenticated_read_market_breadth on public.market_breadth_snapshots;
drop policy if exists authenticated_read_signal_outcomes on public.signal_outcomes;
create policy authenticated_read_market_breadth on public.market_breadth_snapshots for select to authenticated using (true);
create policy authenticated_read_signal_outcomes on public.signal_outcomes for select to authenticated using (true);
grant select on public.market_breadth_snapshots, public.signal_outcomes to authenticated;

create or replace view public.pattern_precision_stats as
select
  coalesce(pattern.pattern_type, 'UNKNOWN') as pattern_type,
  case
    when pattern.quality_score is null then 'UNKNOWN'
    when pattern.quality_score < 60 then '0-59'
    when pattern.quality_score < 70 then '60-69'
    when pattern.quality_score < 80 then '70-79'
    else '80-100'
  end as quality_score_band,
  count(distinct signal.id) as signal_count,
  count(outcome.id) as evaluated_outcome_count,
  avg(outcome.forward_return_pct) as avg_forward_return_pct,
  avg(outcome.hit_invalidation::integer) as invalidation_rate
from public.signals signal
left join lateral (
  select instance.pattern_type, instance.quality_score
  from public.pattern_instances instance
  where instance.symbol_id = signal.symbol_id
    and instance.timeframe = signal.timeframe
    and instance.as_of_date = signal.as_of_date
    and instance.state = 'CONFIRMED'
  order by instance.quality_score desc
  limit 1
) pattern on true
left join public.signal_outcomes outcome on outcome.signal_id = signal.id
group by 1, 2;

grant select on public.pattern_precision_stats to authenticated;
