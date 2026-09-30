-- Existing rows retain an explicit unverified provenance until audited.
alter table public.daily_prices
  add column if not exists price_unit text not null default 'LEGACY_UNVERIFIED',
  add column if not exists source_version text not null default 'LEGACY_UNVERIFIED';

alter table public.market_index_prices
  add column if not exists price_unit text not null default 'LEGACY_UNVERIFIED',
  add column if not exists source_version text not null default 'LEGACY_UNVERIFIED';

create table if not exists public.price_revision_archive (
  symbol_id bigint not null,
  trading_date date not null,
  reason text not null,
  original_row jsonb not null,
  archived_at timestamptz not null default now(),
  primary key (symbol_id, trading_date, reason)
);
alter table public.price_revision_archive enable row level security;

-- Only the six verified KBS histories changed units on 2026-09-15.
do $$
declare affected integer;
begin
  select count(*) into affected from public.daily_prices
  where symbol_id in (616,617,618,619,620,621)
    and trading_date < date '2026-09-15' and source = 'KBS_PUBLIC'
    and close >= 1000;
  if affected not in (0, 7252) then
    raise exception 'Unexpected KBS raw-VND repair cohort: %', affected;
  end if;
end $$;

insert into public.price_revision_archive (symbol_id, trading_date, reason, original_row)
select symbol_id, trading_date, 'KBS_RAW_VND_TO_THOUSAND_20260930', to_jsonb(price)
from public.daily_prices price
where symbol_id in (616,617,618,619,620,621)
  and trading_date < date '2026-09-15' and source = 'KBS_PUBLIC'
  and close >= 1000
on conflict do nothing;

update public.daily_prices
set open = open / 1000, high = high / 1000, low = low / 1000,
    close = close / 1000, source = 'KBS_PUBLIC_REPAIRED',
    price_unit = 'THOUSAND_VND_PER_SHARE',
    source_version = 'KBS_HISTORY_UNIT_REPAIR_20260930'
where symbol_id in (616,617,618,619,620,621)
  and trading_date < date '2026-09-15' and source = 'KBS_PUBLIC'
  and close >= 1000;

alter table public.signal_outcomes
  add column if not exists status text not null default 'STALE'
    check (status in ('VALID', 'STALE')),
  add column if not exists calculation_version text not null default 'LEGACY_UNVERIFIED',
  add column if not exists price_fingerprint text;

-- Outcomes computed before price-unit repairs cannot be used as precision evidence.
update public.signal_outcomes set status = 'STALE'
where status <> 'STALE' or calculation_version = 'LEGACY_UNVERIFIED';

create or replace function public.invalidate_outcomes_after_price_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.open, old.high, old.low, old.close, old.volume, old.quality_status,
      old.price_unit, old.source_version) is distinct from
     (new.open, new.high, new.low, new.close, new.volume, new.quality_status,
      new.price_unit, new.source_version) then
    update public.signal_outcomes outcome set status = 'STALE'
    from public.signals signal
    where outcome.signal_id = signal.id
      and signal.symbol_id = new.symbol_id
      and signal.as_of_date <= new.trading_date;
  end if;
  return new;
end $$;

drop trigger if exists invalidate_outcomes_after_price_revision on public.daily_prices;
create trigger invalidate_outcomes_after_price_revision
after update on public.daily_prices for each row
execute function public.invalidate_outcomes_after_price_revision();

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
left join public.signal_outcomes outcome on outcome.signal_id = signal.id and outcome.status = 'VALID'
group by 1, 2;

create or replace view public.engine_outcome_stats with (security_invoker=true) as
select r.name as engine_name, s.timeframe, s.action, o.horizon_days,
  count(*) as sample_size, avg(o.forward_return_pct) as average_forward_return,
  avg(o.max_drawdown_pct) as average_drawdown,
  avg(o.hit_invalidation::int) as invalidation_rate
from public.signal_outcomes o join public.signals s on s.id=o.signal_id
left join public.rule_versions rv on rv.id=s.rule_version_id
left join public.rules r on r.id=rv.rule_id
where o.status = 'VALID'
group by r.name,s.timeframe,s.action,o.horizon_days;

create table if not exists public.signal_funnel_assessments (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  as_of_date date not null,
  version text not null,
  monthly_state text not null,
  stage text not null,
  setup_id text,
  setup_kind text,
  setup_date date,
  trigger_date date,
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (symbol_id, as_of_date, version)
);

create index if not exists signal_funnel_assessments_date_idx
  on public.signal_funnel_assessments (as_of_date desc, stage);
alter table public.signal_funnel_assessments enable row level security;
create policy authenticated_read_signal_funnel_assessments
  on public.signal_funnel_assessments for select to authenticated using (true);
grant select on public.signal_funnel_assessments to authenticated;

create table if not exists public.signal_funnel_outcomes (
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  as_of_date date not null,
  version text not null,
  horizon_days integer not null check (horizon_days in (5, 10, 20)),
  setup_id text not null,
  forward_return_pct numeric(12,6) not null,
  max_drawdown_pct numeric(12,6) not null,
  hit_invalidation boolean not null,
  calculation_version text not null,
  price_fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key (symbol_id, as_of_date, version, horizon_days)
);
alter table public.signal_funnel_outcomes enable row level security;
create policy authenticated_read_signal_funnel_outcomes
  on public.signal_funnel_outcomes for select to authenticated using (true);
grant select on public.signal_funnel_outcomes to authenticated;
