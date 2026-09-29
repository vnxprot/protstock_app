-- Trading eligibility (active) and exchange trading status are distinct.
-- Blank status in the supplied workbook is represented as UNKNOWN, never NORMAL.
alter table public.symbols
  add column if not exists trading_status text not null default 'UNKNOWN'
  check (trading_status in ('NORMAL', 'RESTRICTED', 'SUSPENDED', 'DELISTED', 'UNKNOWN'));
