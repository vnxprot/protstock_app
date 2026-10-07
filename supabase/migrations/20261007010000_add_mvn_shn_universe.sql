-- Seed both workbook additions before backfill so sector history is point-in-time complete.
begin;

insert into public.symbols
  (symbol, company_name, sector, exchange, trading_status, active, listed_from)
values
  ('MVN', 'Tổng công ty Hàng hải Việt Nam - CTCP', 'CANG BIEN', 'UPCOM', 'NORMAL', true, date '2018-10-08'),
  ('SHN', 'CTCP Đầu tư Tổng hợp Hà Nội', 'XAY DUNG', 'HNX', 'NORMAL', true, date '2009-12-16')
on conflict (symbol) do update set
  company_name = excluded.company_name,
  sector = excluded.sector,
  exchange = excluded.exchange,
  trading_status = excluded.trading_status,
  active = excluded.active,
  listed_from = excluded.listed_from;

-- The insert trigger starts a sector at current_date. Move it back to the requested
-- history start; avoid touching a pre-existing historical sector assignment.
update public.symbol_sector_history h
set valid_from = date '2021-01-01'
from public.symbols s
where h.symbol_id = s.id
  and s.symbol in ('MVN', 'SHN')
  and h.valid_from = current_date
  and not exists (
    select 1 from public.symbol_sector_history older
    where older.symbol_id = s.id and older.valid_from = date '2021-01-01'
  );

commit;
