create policy authenticated_read_radar_live on storage.objects
  for select to authenticated using (
    bucket_id = 'market-radar-live' and name in ('HOSE.json.gz', 'HNX.json.gz', 'UPCOM.json.gz')
  );

create or replace function public.publish_market_radar_tape(p_rows jsonb, p_fill_only boolean)
returns void language sql set search_path = public as $$
insert into market_radar_daily as old
select r.* from jsonb_populate_recordset(null::market_radar_daily, p_rows) as r
where r.method in ('continuous', 'continuous_cluster', 'auction')
  and (not p_fill_only or (not r.partial and r.reference_volume is not null))
on conflict (trading_date, exchange, symbol, category, method) do update set
  source = excluded.source, partial = excluded.partial, tape_reason = excluded.tape_reason,
  reference_volume = excluded.reference_volume, tape_volume = excluded.tape_volume,
  buy_value = excluded.buy_value, sell_value = excluded.sell_value, unknown_value = excluded.unknown_value,
  buy_volume = excluded.buy_volume, sell_volume = excluded.sell_volume, unknown_volume = excluded.unknown_volume,
  buy_count = excluded.buy_count, sell_count = excluded.sell_count, unknown_count = excluded.unknown_count,
  trade_count = excluded.trade_count, market_value = excluded.market_value,
  auction_breakdown = excluded.auction_breakdown
where (old.reference_volume is null or old.partial or (not p_fill_only and not excluded.partial
        and (old.source not like 'SSI WebSocket%' or excluded.source like 'SSI WebSocket%')))
  and (old.auction_breakdown is null or excluded.auction_breakdown is not null);
$$;
