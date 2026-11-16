create function public.market_radar_dashboard(
  p_start date, p_end date, p_exchange text, p_category text, p_order text, p_search text default ''
) returns jsonb language sql stable security invoker set search_path = public as $$
with flow_days as (
  select f.* from market_radar_daily f
  where f.trading_date between p_start and p_end and f.category = p_category
    and f.method = case when p_category in ('large', 'medium', 'small') then 'continuous' else 'total' end
    and (p_exchange = 'all' or f.exchange = p_exchange)
), totals as (
  select exchange, symbol, sum(buy_value) as buy_value, sum(sell_value) as sell_value,
    sum(buy_volume) as buy_volume, sum(sell_volume) as sell_volume,
    sum(buy_value - sell_value) as net_value, sum(buy_volume - sell_volume) as net_volume,
    sum(coalesce(buy_value, 0) + coalesce(sell_value, 0) + coalesce(unknown_value, 0)) as matched_value,
    sum(unknown_value) as unknown_value, sum(trade_count) as trade_count,
    sum(buy_value) filter (where buy_value > 0 and buy_volume > 0)
      / nullif(sum(buy_volume) filter (where buy_value > 0 and buy_volume > 0), 0) as avg_buy_price,
    (array_agg(holdings order by trading_date desc) filter (where holdings is not null))[1] as holdings,
    (array_agg(ownership_pct order by trading_date desc) filter (where ownership_pct is not null))[1] as ownership_pct,
    (array_agg(room_remaining order by trading_date desc) filter (where room_remaining is not null))[1] as room_remaining,
    max(trading_date) filter (where holdings is not null) as holdings_date,
    max(trading_date) filter (where ownership_pct is not null) as ownership_date,
    max(trading_date) filter (where room_remaining is not null) as room_date,
    count(*) as observed, bool_or(partial) as partial,
    string_agg(distinct source, ', ' order by source) as source
  from flow_days group by exchange, symbol
), candidates as (
  select t.*, s.id as symbol_id, s.company_name,
    case p_order when 'sell' then -t.net_value when 'size' then t.matched_value
      when 'ownership' then t.ownership_pct when 'holdings' then t.holdings else t.net_value end as rank_metric
  from totals t left join symbols s on s.symbol = t.symbol and s.exchange = t.exchange
  where coalesce(trim(p_search), '') = '' or strpos(upper(t.symbol), upper(trim(p_search))) > 0
), ranked as (
  select * from candidates
  where rank_metric > 0 or (p_order in ('ownership', 'holdings') and rank_metric = 0)
    or trim(p_search) <> ''
  order by rank_metric desc nulls last, symbol, exchange limit 20
), top_rows as (
  select r.*, d.close * 1000 as last_close_vnd
  from ranked r left join daily_prices d on d.symbol_id = r.symbol_id
    and d.trading_date = p_end and d.quality_status = 'VALID'
), coverage_days as (
  select exchange, trading_date, partial from flow_days
  union all
  select exchange, trading_date, false from market_radar_publications
  where trading_date between p_start and p_end and category = p_category and method = 'total'
    and (p_exchange = 'all' or exchange = p_exchange)
), coverage as (
  select exchange, count(distinct trading_date) as observed, max(trading_date) as latest, bool_or(partial) as partial
  from coverage_days group by exchange
)
select jsonb_build_object(
  'coverage', coalesce((select jsonb_agg(to_jsonb(c) order by exchange) from coverage c), '[]'::jsonb),
  'rows', coalesce((select jsonb_agg(to_jsonb(t) order by rank_metric desc nulls last, symbol, exchange) from top_rows t), '[]'::jsonb),
  'net_value', (select sum(net_value) from totals),
  'net_volume', (select sum(net_volume) from totals),
  'strongest_buy', (select jsonb_build_object('symbol', symbol, 'exchange', exchange, 'net_value', net_value, 'net_volume', net_volume)
    from totals where net_value > 0 order by net_value desc, symbol, exchange limit 1),
  'strongest_sell', (select jsonb_build_object('symbol', symbol, 'exchange', exchange, 'net_value', net_value, 'net_volume', net_volume)
    from totals where net_value < 0 order by net_value, symbol, exchange limit 1)
);
$$;

revoke all on function public.market_radar_dashboard(date, date, text, text, text, text) from public, anon;
grant execute on function public.market_radar_dashboard(date, date, text, text, text, text) to authenticated;
