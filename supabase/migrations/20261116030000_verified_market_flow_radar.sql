do $$
declare rule_name text;
begin
  select conname into strict rule_name from pg_constraint
  where conrelid = 'public.market_radar_daily'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%category%' and pg_get_constraintdef(oid) like '%method%';
  execute format('alter table public.market_radar_daily drop constraint %I', rule_name);
end;
$$;

alter table public.market_radar_daily
  drop constraint market_radar_daily_method_check,
  add constraint market_radar_daily_method_check check (method in ('total', 'matched', 'negotiated', 'continuous', 'continuous_cluster', 'auction')),
  add constraint market_radar_daily_category_method_check check ((category in ('large', 'medium', 'small')) = (method in ('continuous', 'continuous_cluster', 'auction'))),
  add column buy_count integer check (buy_count >= 0),
  add column sell_count integer check (sell_count >= 0),
  add column unknown_count integer check (unknown_count >= 0),
  add column unknown_volume bigint check (unknown_volume >= 0),
  add column tape_volume bigint check (tape_volume >= 0),
  add column reference_volume bigint check (reference_volume >= 0),
  add column tape_reason text;

create function public.publish_market_radar_tape(p_rows jsonb)
returns void language sql set search_path = public as $$
insert into market_radar_daily as old
select r.* from jsonb_populate_recordset(null::market_radar_daily, p_rows) as r
where r.method in ('continuous', 'continuous_cluster', 'auction')
on conflict (trading_date, exchange, symbol, category, method) do update set
  source = excluded.source, partial = excluded.partial, tape_reason = excluded.tape_reason,
  reference_volume = excluded.reference_volume, tape_volume = excluded.tape_volume,
  buy_value = excluded.buy_value, sell_value = excluded.sell_value, unknown_value = excluded.unknown_value,
  buy_volume = excluded.buy_volume, sell_volume = excluded.sell_volume, unknown_volume = excluded.unknown_volume,
  buy_count = excluded.buy_count, sell_count = excluded.sell_count, unknown_count = excluded.unknown_count,
  trade_count = excluded.trade_count, market_value = excluded.market_value
where old.reference_volume is null or old.partial or not excluded.partial;
$$;
revoke all on function public.publish_market_radar_tape(jsonb) from public, anon, authenticated;
grant execute on function public.publish_market_radar_tape(jsonb) to service_role;

create function public.market_radar_dashboard_v2(
  p_start date, p_end date, p_exchange text, p_category text, p_order text, p_search text, p_mode text
) returns jsonb language sql stable security invoker set search_path = public as $$
with settings as (
  select p_category in ('large', 'medium', 'small') as tape,
    coalesce(trim(p_search), '') as search
), calendar as (
  select ip.trading_date from market_index_prices ip
  join market_indices i on i.id = ip.index_id and i.code = 'VNINDEX'
  where ip.trading_date between p_start and p_end and (select tape from settings)
), flow_days as (
  select f.* from market_radar_daily f cross join settings cfg
  where f.trading_date between p_start and p_end and f.category = p_category
    and f.method = case when cfg.tape then p_mode else 'total' end
    and (p_exchange = 'all' or f.exchange = p_exchange)
), symbol_coverage as (
  select s.exchange, s.symbol, count(*) as expected,
    count(*) filter (where f.reference_volume is not null and not f.partial) as verified,
    string_agg(distinct f.source, ', ' order by f.source) as source
  from symbols s join calendar c on c.trading_date between coalesce(s.listed_from, p_start) and coalesce(s.delisted_on, p_end)
  left join flow_days f on f.exchange = s.exchange and f.symbol = s.symbol and f.trading_date = c.trading_date
  where s.active and s.exchange in ('HOSE', 'HNX', 'UPCOM') and (p_exchange = 'all' or s.exchange = p_exchange)
  group by s.exchange, s.symbol
), totals as (
  select f.exchange, f.symbol, sum(f.buy_value) as buy_value, sum(f.sell_value) as sell_value,
    sum(f.buy_volume) as buy_volume, sum(f.sell_volume) as sell_volume,
    sum(f.buy_value - f.sell_value) as net_value, sum(f.buy_volume - f.sell_volume) as net_volume,
    sum(coalesce(f.buy_value, 0) + coalesce(f.sell_value, 0) + coalesce(f.unknown_value, 0)) as matched_value,
    sum(f.unknown_value) as unknown_value, sum(f.unknown_volume) as unknown_volume, sum(f.trade_count) as trade_count,
    sum(f.buy_count) as buy_count, sum(f.sell_count) as sell_count, sum(f.unknown_count) as unknown_count,
    sum(f.buy_value) filter (where f.buy_value > 0 and f.buy_volume > 0)
      / nullif(sum(f.buy_volume) filter (where f.buy_value > 0 and f.buy_volume > 0), 0) as avg_buy_price,
    (array_agg(f.holdings order by f.trading_date desc) filter (where f.holdings is not null))[1] as holdings,
    (array_agg(f.ownership_pct order by f.trading_date desc) filter (where f.ownership_pct is not null))[1] as ownership_pct,
    (array_agg(f.room_remaining order by f.trading_date desc) filter (where f.room_remaining is not null))[1] as room_remaining,
    max(f.trading_date) filter (where f.holdings is not null) as holdings_date,
    max(f.trading_date) filter (where f.ownership_pct is not null) as ownership_date,
    max(f.trading_date) filter (where f.room_remaining is not null) as room_date,
    count(*) as observed, bool_or(f.partial) as partial,
    string_agg(distinct f.source, ', ' order by f.source) as source
  from flow_days f cross join settings cfg
  left join symbol_coverage sc on sc.exchange = f.exchange and sc.symbol = f.symbol
  where not cfg.tape or (sc.verified = sc.expected and f.reference_volume is not null and not f.partial
    and exists (select 1 from calendar c where c.trading_date = f.trading_date))
  group by f.exchange, f.symbol
), candidates as (
  select t.*, s.id as symbol_id, s.company_name, sc.expected,
    case p_order when 'sell' then -t.net_value when 'size' then t.matched_value
      when 'ownership' then t.ownership_pct when 'holdings' then t.holdings else t.net_value end as rank_metric
  from totals t left join symbols s on s.symbol = t.symbol and s.exchange = t.exchange
  left join symbol_coverage sc on sc.exchange = t.exchange and sc.symbol = t.symbol
  where (select search from settings) = '' or strpos(t.symbol, upper((select search from settings))) > 0
), ranked as (
  select * from candidates
  where rank_metric > 0 or (p_order in ('ownership', 'holdings') and rank_metric = 0)
    or (select search from settings) <> ''
  order by rank_metric desc nulls last, symbol, exchange limit 20
), search_missing as (
  select sc.* from symbol_coverage sc cross join settings cfg
  where cfg.search <> '' and strpos(sc.symbol, upper(cfg.search)) > 0 and sc.verified < sc.expected
  order by sc.symbol, sc.exchange limit 20
), result_rows as (
  select r.symbol, r.exchange, r.rank_metric, to_jsonb(r) || jsonb_build_object('last_close_vnd', d.close * 1000) as row
  from ranked r left join daily_prices d on d.symbol_id = r.symbol_id and d.trading_date = p_end and d.quality_status = 'VALID'
  union all
  select sc.symbol, sc.exchange, null::numeric, jsonb_build_object(
    'symbol', sc.symbol, 'exchange', sc.exchange, 'company_name', s.company_name, 'source', sc.source,
    'observed', sc.verified, 'expected', sc.expected, 'partial', true, 'last_close_vnd', d.close * 1000)
  from search_missing sc join symbols s on s.symbol = sc.symbol and s.exchange = sc.exchange
  left join daily_prices d on d.symbol_id = s.id and d.trading_date = p_end and d.quality_status = 'VALID'
), coverage_days as (
  select exchange, trading_date, partial from flow_days
  where not (select tape from settings) or (reference_volume is not null and not partial)
  union all
  select exchange, trading_date, false from market_radar_publications
  where not (select tape from settings) and trading_date between p_start and p_end and category = p_category and method = 'total'
    and (p_exchange = 'all' or exchange = p_exchange)
), coverage as (
  select exchange, count(distinct trading_date) as observed, max(trading_date) as latest, bool_or(partial) as partial
  from coverage_days group by exchange
), universe_coverage as (
  select exchange, count(*) as universe, count(*) filter (where verified = expected) as ready
  from symbol_coverage group by exchange
)
select jsonb_build_object(
  'coverage', coalesce((select jsonb_agg(jsonb_build_object('exchange', exchange, 'observed', coalesce(c.observed, 0),
    'latest', c.latest, 'partial', coalesce(c.partial, false) or coalesce(u.ready < u.universe, false), 'ready', u.ready, 'universe', u.universe) order by exchange)
    from coverage c full join universe_coverage u using (exchange)), '[]'::jsonb),
  'rows', coalesce((select jsonb_agg(r.row order by r.rank_metric desc nulls last, r.symbol, r.exchange)
    from (select * from result_rows order by rank_metric desc nulls last, symbol, exchange limit 20) r), '[]'::jsonb),
  'net_value', (select sum(net_value) from totals),
  'net_volume', (select sum(net_volume) from totals),
  'strongest_buy', (select jsonb_build_object('symbol', symbol, 'exchange', exchange, 'net_value', net_value, 'net_volume', net_volume)
    from totals where net_value > 0 order by net_value desc, symbol, exchange limit 1),
  'strongest_sell', (select jsonb_build_object('symbol', symbol, 'exchange', exchange, 'net_value', net_value, 'net_volume', net_volume)
    from totals where net_value < 0 order by net_value, symbol, exchange limit 1)
);
$$;

revoke all on function public.market_radar_dashboard_v2(date, date, text, text, text, text, text) from public, anon;
grant execute on function public.market_radar_dashboard_v2(date, date, text, text, text, text, text) to authenticated;

create or replace function public.market_radar_dashboard(
  p_start date, p_end date, p_exchange text, p_category text, p_order text, p_search text default ''
) returns jsonb language sql stable security invoker set search_path = public as $$
select market_radar_dashboard_v2(p_start, p_end, p_exchange, p_category, p_order, p_search, 'continuous');
$$;
