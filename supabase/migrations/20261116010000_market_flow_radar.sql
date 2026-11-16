create table public.market_radar_daily (
  trading_date date not null,
  exchange text not null check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  symbol text not null check (symbol ~ '^[A-Z0-9]{3,10}$'),
  category text not null check (category in ('foreign', 'proprietary', 'large', 'medium', 'small')),
  method text not null check (method in ('total', 'matched', 'negotiated', 'continuous')),
  source text not null check (length(source) between 1 and 100),
  buy_value bigint check (buy_value >= 0),
  sell_value bigint check (sell_value >= 0),
  buy_volume bigint check (buy_volume >= 0),
  sell_volume bigint check (sell_volume >= 0),
  unknown_value bigint check (unknown_value >= 0),
  trade_count integer check (trade_count >= 0),
  market_value bigint check (market_value >= 0),
  holdings bigint check (holdings >= 0),
  ownership_pct numeric(8,4) check (ownership_pct between 0 and 100),
  room_remaining bigint,
  partial boolean not null default false,
  primary key (trading_date, exchange, symbol, category, method),
  check ((buy_value is null) = (sell_value is null)),
  check ((buy_volume is null) = (sell_volume is null)),
  check ((category in ('large', 'medium', 'small')) = (method = 'continuous'))
);

alter table public.market_radar_daily enable row level security;
revoke all on public.market_radar_daily from public, anon, authenticated;
grant select on public.market_radar_daily to authenticated;
grant all on public.market_radar_daily to service_role;
create policy authenticated_read_market_radar on public.market_radar_daily
  for select to authenticated using (true);

create table public.market_radar_publications (
  trading_date date not null,
  exchange text not null check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  category text not null check (category in ('foreign', 'proprietary')),
  method text not null check (method in ('total', 'matched', 'negotiated')),
  primary key (trading_date, exchange, category, method)
);
alter table public.market_radar_publications enable row level security;
revoke all on public.market_radar_publications from public, anon, authenticated;
grant select on public.market_radar_publications to authenticated;
grant all on public.market_radar_publications to service_role;
create policy authenticated_read_market_radar_publications on public.market_radar_publications
  for select to authenticated using (true);

create or replace function public.replace_market_radar_report(
  p_day date, p_exchange text, p_category text, p_method text, p_rows jsonb
) returns void language plpgsql set search_path = public as $$
begin
  insert into market_radar_publications values (p_day, p_exchange, p_category, p_method)
  on conflict (trading_date, exchange, category, method) do update set method = excluded.method;
  delete from market_radar_daily
  where trading_date = p_day and exchange = p_exchange and category = p_category and method = p_method;
  insert into market_radar_daily (trading_date, exchange, category, method, symbol, source,
    buy_value, sell_value, buy_volume, sell_volume, market_value, holdings, ownership_pct, room_remaining)
  select p_day, p_exchange, p_category, p_method, r.symbol, r.source,
    r.buy_value, r.sell_value, r.buy_volume, r.sell_volume, r.market_value, r.holdings, r.ownership_pct, r.room_remaining
  from jsonb_populate_recordset(null::market_radar_daily, p_rows) r;
end;
$$;
revoke all on function public.replace_market_radar_report(date, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_market_radar_report(date, text, text, text, jsonb) to service_role;

create or replace function public.market_radar_rank(
  p_dates date[], p_exchange text, p_category text, p_method text, p_order text
) returns jsonb language sql stable security invoker set search_path = public as $$
with sessions as (
  select distinct day from unnest(p_dates) as d(day) order by day desc limit 260
), bounds as (
  select min(day) as first_day, max(day) as last_day, count(*) as expected from sessions
), price_days as (
  select d.symbol_id, s.symbol, s.company_name, s.exchange, d.trading_date, d.close, d.volume, d.source
  from sessions join daily_prices d on d.trading_date = sessions.day
  join symbols s on s.id = d.symbol_id
  where p_category = 'price' and s.active and s.exchange in ('HOSE', 'HNX', 'UPCOM')
    and (p_exchange = 'all' or s.exchange = p_exchange) and d.quality_status = 'VALID'
), prices as (
  select symbol_id, symbol, company_name, exchange, sum(volume) as volume, count(*) as observed,
    (array_agg(close order by trading_date desc))[1] as last_close,
    string_agg(distinct source, ', ' order by source) as source
  from price_days group by symbol_id, symbol, company_name, exchange
), price_ranks as (
  select p.*, case when p.observed = b.expected and previous.trading_date = prior_session.trading_date
      and p.source = previous.source then 100 * (p.last_close / nullif(previous.close, 0) - 1) end as change_pct
  from prices p cross join bounds b
  cross join lateral (
    select max(ip.trading_date) as trading_date from market_index_prices ip
    join market_indices i on i.id = ip.index_id and i.code = 'VNINDEX'
    where ip.trading_date < b.first_day
  ) prior_session
  left join daily_prices previous on previous.symbol_id = p.symbol_id
    and previous.trading_date = prior_session.trading_date and previous.quality_status = 'VALID'
), flow_days as (
  select f.* from sessions join market_radar_daily f on f.trading_date = sessions.day
  where f.category = p_category and f.method = p_method
    and (p_exchange = 'all' or f.exchange = p_exchange)
), summed as (
  select exchange, symbol, sum(buy_value) as buy_value, sum(sell_value) as sell_value,
    sum(buy_volume) as buy_volume, sum(sell_volume) as sell_volume,
    sum(buy_value - sell_value) as net_value, sum(buy_volume - sell_volume) as net_volume,
    sum(coalesce(buy_value, 0) + coalesce(sell_value, 0) + coalesce(unknown_value, 0))
      filter (where buy_value is not null or unknown_value is not null) as total_value,
    sum(unknown_value) as unknown_value, sum(trade_count) as trade_count,
    (array_agg(holdings order by trading_date desc) filter (where holdings is not null))[1] as holdings,
    (array_agg(room_remaining order by trading_date desc) filter (where room_remaining is not null))[1] as room_remaining,
    (array_agg(ownership_pct order by trading_date desc) filter (where ownership_pct is not null))[1] as ownership_pct,
    max(trading_date) filter (where holdings is not null) as holdings_date,
    max(trading_date) filter (where room_remaining is not null) as room_date,
    max(trading_date) filter (where ownership_pct is not null) as ownership_date,
    count(*) filter (where buy_value is not null) as net_sessions,
    count(*) filter (where buy_value > sell_value) as positive_sessions,
    count(*) as observed, bool_or(partial) as partial,
    string_agg(distinct source, ', ' order by source) as source,
    case when count(market_value) = count(buy_value) and count(buy_value) > 0
      then 100 * sum(buy_value - sell_value) / nullif(sum(market_value) filter (where buy_value is not null), 0) end as liquidity_pct
  from flow_days group by exchange, symbol
), ranked as (
  select s.*, n.company_name, s.buy_value / nullif(s.buy_volume, 0) as avg_buy_price,
    case p_order when 'sell' then -s.net_value when 'holdings' then s.holdings
      when 'ownership' then s.ownership_pct when 'room' then -s.room_remaining
      when 'size' then s.total_value else s.net_value end as rank_metric
  from summed s left join symbols n on n.symbol = s.symbol and n.exchange = s.exchange
), price_top as (
  select p.*, case p_order when 'down' then -p.change_pct when 'volume' then p.volume else p.change_pct end as rank_metric
  from price_ranks p
  where case p_order when 'down' then p.change_pct < 0 when 'volume' then p.volume > 0 else p.change_pct > 0 end
  order by rank_metric desc, symbol limit 20
), flow_top as (
  select * from ranked where rank_metric > 0 or (p_order in ('holdings', 'ownership', 'room') and rank_metric is not null)
  order by rank_metric desc, symbol, exchange limit 20
), coverage_days as (
  select exchange, trading_date, false as partial from price_days
  union all select exchange, trading_date, partial from flow_days
  union all
  select p.exchange, p.trading_date, false from sessions join market_radar_publications p on p.trading_date = sessions.day
  where p.category = p_category and p.method = p_method and (p_exchange = 'all' or p.exchange = p_exchange)
), coverage as (
  select exchange, count(distinct trading_date) as observed, max(trading_date) as latest, bool_or(partial) as partial
  from coverage_days group by exchange
)
select jsonb_build_object('expected', (select expected from bounds),
  'coverage', coalesce((select jsonb_agg(to_jsonb(c) order by exchange) from coverage c), '[]'::jsonb),
  'rows', coalesce(case when p_category = 'price' then
    (select jsonb_agg(to_jsonb(t) order by rank_metric desc, symbol) from price_top t) else
    (select jsonb_agg(to_jsonb(t) order by rank_metric desc, symbol, exchange) from flow_top t) end, '[]'::jsonb),
  'top_net', (select sum(net_value) from flow_top));
$$;

revoke all on function public.market_radar_rank(date[], text, text, text, text) from public, anon;
grant execute on function public.market_radar_rank(date[], text, text, text, text) to authenticated;
