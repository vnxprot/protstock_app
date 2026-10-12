-- Prot Stock 0.0.0: retain the vendor observation and its comparable-share basis.
-- Historical numeric revisions remain archived by the existing price archive.
alter table public.daily_prices
  add column if not exists source_volume bigint check (source_volume is null or source_volume >= 0),
  add column if not exists volume_adjustment_factor numeric(20,10) not null default 1
    check (volume_adjustment_factor > 0),
  add column if not exists volume_basis text not null default 'LEGACY_UNVERIFIED',
  add column if not exists price_basis text not null default 'LEGACY_UNVERIFIED',
  add column if not exists data_revision text;

alter table public.corporate_actions
  add column if not exists verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('UNVERIFIED', 'SOURCE_REPORTED', 'VERIFIED', 'OFFICIAL', 'REJECTED'));

alter table public.derived_bars
  add column if not exists data_revision text;

-- This one event is independently documented by VSDC.  Do not confer this
-- status on other VCI-reported events merely because the vendor lists them.
update public.corporate_actions ca
set verification_status = 'OFFICIAL',
    metadata = ca.metadata || '{"volume_policy":"UNADJUSTED_PRE_EVENT","price_policy":"VENDOR_ALREADY_ADJUSTED"}'::jsonb
from public.symbols symbol
where ca.symbol_id = symbol.id and symbol.symbol = 'TRC'
  and ca.action_type = 'BONUS' and ca.ex_date = date '2026-09-15'
  and ca.ratio = 3 and ca.source_url = 'https://vsdc.vn/vi/ad/199296';

-- The active universe follows the approved 277-symbol manifest.  Retaining
-- this row preserves TLG's personal and historical references.
update public.symbols
set active = true,
    metadata = metadata - 'universe_status' - 'universe_removed_at' - 'universe_removal_reason'
where symbol = 'TLG';
