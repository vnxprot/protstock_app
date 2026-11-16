alter table public.market_radar_daily
  add column auction_breakdown jsonb check (auction_breakdown is null or (method = 'auction' and jsonb_typeof(auction_breakdown) = 'object'));

create or replace function public.publish_market_radar_tape(p_rows jsonb)
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
  trade_count = excluded.trade_count, market_value = excluded.market_value,
  auction_breakdown = excluded.auction_breakdown
where (old.reference_volume is null or old.partial or not excluded.partial)
  and (old.auction_breakdown is null or excluded.auction_breakdown is not null);
$$;

create function public.market_radar_auction(p_start date, p_end date, p_exchange text, p_category text, p_search text)
returns jsonb language sql stable security invoker set search_path = public as $$
with base as (
  select market_radar_dashboard_v2(p_start, p_end, p_exchange, p_category, 'size', p_search, 'auction') as dashboard
), rows as (
  select r.entry, r.ordinality from base cross join lateral jsonb_array_elements(dashboard->'rows') with ordinality r(entry, ordinality)
), enriched as (
  select r.ordinality, r.entry || jsonb_build_object('auction_breakdown', case when breakdown.complete then breakdown.batches end) as entry
  from rows r left join lateral (
    with verified as (
      select d.auction_breakdown, d.trade_count from market_radar_daily d
      where d.symbol = r.entry->>'symbol' and d.exchange = r.entry->>'exchange'
        and d.category = p_category and d.method = 'auction' and d.trading_date between p_start and p_end
        and not d.partial and d.reference_volume is not null
        and exists (select 1 from market_index_prices ip join market_indices i on i.id = ip.index_id
          where i.code = 'VNINDEX' and ip.trading_date = d.trading_date)
    ), phases as (
      select batch.key, jsonb_build_object(
        'count', sum((batch.value->>'count')::bigint),
        'volume', sum((batch.value->>'volume')::bigint),
        'value', sum((batch.value->>'value')::bigint)) as totals
      from verified v cross join lateral jsonb_each(v.auction_breakdown) batch
      group by batch.key
    )
    select (select bool_and(auction_breakdown is not null or trade_count = 0) from verified) as complete,
      (select coalesce(jsonb_object_agg(key, totals), '{}'::jsonb) from phases) as batches
  ) breakdown on r.entry->>'partial' = 'false'
)
select jsonb_set(dashboard, '{rows}', coalesce((select jsonb_agg(entry order by ordinality) from enriched), '[]'::jsonb)) from base;
$$;

revoke all on function public.market_radar_auction(date, date, text, text, text) from public, anon;
grant execute on function public.market_radar_auction(date, date, text, text, text) to authenticated;
