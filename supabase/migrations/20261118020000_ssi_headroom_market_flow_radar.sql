create or replace function public.publish_ssi_price_series(p_symbol_id bigint, p_rows jsonb)
returns integer language plpgsql set search_path = public as $$
declare written integer;
begin
  if jsonb_array_length(p_rows) not between 1 and 2500
    or exists (select 1 from jsonb_populate_recordset(null::daily_prices, p_rows) r
               where r.symbol_id is distinct from p_symbol_id or r.source is distinct from 'SSI_FASTCONNECT') then
    raise exception 'Invalid SSI cutover series';
  end if;
  perform pg_advisory_xact_lock(hashtext('protstock.ssi_cutover'));
  if pg_database_size(current_database()) >= 480000000 then
    raise exception 'SSI cutover deferred at the PostgreSQL operating limit';
  end if;
  perform set_config('protstock.ssi_cutover', 'on', true);
  insert into daily_prices (symbol_id,trading_date,open,high,low,close,volume,source_volume,
    volume_adjustment_factor,volume_basis,price_basis,source,source_version,price_unit,
    collected_at,quality_status,data_revision)
  select r.symbol_id,r.trading_date,r.open,r.high,r.low,r.close,r.volume,r.source_volume,
    r.volume_adjustment_factor,r.volume_basis,r.price_basis,r.source,r.source_version,r.price_unit,
    r.collected_at,r.quality_status,r.data_revision
  from jsonb_populate_recordset(null::daily_prices, p_rows) r
  order by r.trading_date
  on conflict (symbol_id,trading_date) do update set open=excluded.open, high=excluded.high, low=excluded.low,
    close=excluded.close, volume=excluded.volume, source_volume=excluded.source_volume,
    volume_adjustment_factor=excluded.volume_adjustment_factor, volume_basis=excluded.volume_basis,
    price_basis=excluded.price_basis, source=excluded.source, source_version=excluded.source_version,
    price_unit=excluded.price_unit, collected_at=excluded.collected_at, quality_status=excluded.quality_status,
    data_revision=excluded.data_revision, traded_value=null, adjusted_close=null, adjustment_factor=1,
    source_url=null, raw_payload=null;
  get diagnostics written = row_count;
  return written;
end $$;
revoke all on function public.publish_ssi_price_series(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.publish_ssi_price_series(bigint,jsonb) to service_role;
