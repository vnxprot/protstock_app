-- Complete only the independently verified TRC 1:3 bonus repair after a
-- matched, jump-free KBS research history has been synchronized.
alter table public.research_price_bars
  add column if not exists volume_basis text not null default 'VENDOR_REPORTED',
  add column if not exists volume_adjustment_factor numeric(18,6) not null default 1
    check (volume_adjustment_factor > 0);

do $$
declare
  trc_id bigint;
  stored_count integer;
  vendor_count integer;
  audit record;
begin
  select id into strict trc_id from public.symbols where symbol = 'TRC';
  select count(*) into stored_count from public.daily_prices where symbol_id = trc_id;
  select count(*) into vendor_count from public.research_price_bars where symbol_id = trc_id;
  select * into strict audit from public.research_price_sync_status where symbol_id = trc_id;
  if stored_count < 1000 or vendor_count < stored_count
      or audit.coverage_status <> 'MATCHED'
      or audit.unmatched_stored_dates <> 0 or audit.quarantined_bars <> 0
      or audit.source_version <> 'KBS_PUBLIC_V2_20260930'
      or audit.requested_start_date > date '2021-01-01'
      or audit.requested_end_date < date '2026-09-30' then
    raise exception 'TRC research history has not passed the guarded repair check';
  end if;
  if not exists (
    select 1 from public.corporate_actions
    where symbol_id = trc_id and action_type = 'BONUS'
      and ex_date = date '2026-09-15' and ratio = 3
      and source_url = 'https://vsdc.vn/vi/ad/199296'
  ) then
    raise exception 'Verified VSDC TRC bonus event is missing';
  end if;

  -- The KBS historical price was already divided by four before ex-rights,
  -- while its reported historical volume is in the original share count.
  update public.research_price_bars
  set volume = volume * 4,
      volume_basis = 'VSDC_BONUS_REBASED',
      volume_adjustment_factor = 4
  where symbol_id = trc_id and trading_date < date '2026-09-15'
    and volume_adjustment_factor = 1;

  insert into public.price_revision_archive
    (symbol_id, trading_date, reason, original_row)
  select symbol_id, trading_date, 'TRC_VSDC_KBS_REBASE_20261001', to_jsonb(price)
  from public.daily_prices price where symbol_id = trc_id
  on conflict do nothing;

  update public.daily_prices price
  set open = research.open, high = research.high, low = research.low,
      close = research.close, volume = research.volume,
      adjusted_close = research.close, adjustment_factor = 1,
      traded_value = null, source = 'KBS_PUBLIC',
      source_url = research.source_url,
      collected_at = research.collected_at,
      price_unit = 'THOUSAND_VND_PER_SHARE',
      source_version = 'KBS_PUBLIC_V2_20260930_TRC_VSDC_199296',
      quality_status = 'VALID', raw_payload = null
  from public.research_price_bars research
  where price.symbol_id = trc_id
    and research.symbol_id = price.symbol_id
    and research.trading_date = price.trading_date
    and research.quality_status = 'VALID';

  if (select count(*) from public.daily_prices
      where symbol_id = trc_id
        and source_version = 'KBS_PUBLIC_V2_20260930_TRC_VSDC_199296') <> stored_count then
    raise exception 'TRC repair did not cover every stored date';
  end if;
  raise notice 'TRC repair covered % stored bars against % KBS bars', stored_count, vendor_count;
end $$;
