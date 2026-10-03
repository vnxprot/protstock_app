-- Rotate the HNX universe atomically. The six removals are explicitly requested
-- for every symbol-scoped store, including private portfolio and thesis data.
begin;

create temporary table retired_symbol_ids on commit drop as
select id, symbol from public.symbols
where symbol in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF');

delete from public.macd_divergence_outcomes where symbol_id in (select id from retired_symbol_ids);
delete from public.macd_divergence_assessments where symbol_id in (select id from retired_symbol_ids);
delete from public.research_price_sync_status where symbol_id in (select id from retired_symbol_ids);
delete from public.research_price_bars where symbol_id in (select id from retired_symbol_ids);
delete from public.price_revision_archive where symbol_id in (select id from retired_symbol_ids);
delete from public.signal_funnel_outcomes where symbol_id in (select id from retired_symbol_ids);
delete from public.signal_funnel_assessments where symbol_id in (select id from retired_symbol_ids);
delete from public.journal_entries where symbol_id in (select id from retired_symbol_ids);
delete from public.investment_thesis_versions
where thesis_id in (select id from public.investment_theses
                    where symbol_id in (select id from retired_symbol_ids));
delete from public.investment_theses where symbol_id in (select id from retired_symbol_ids);
delete from public.positions where symbol_id in (select id from retired_symbol_ids);
delete from public.portfolio_transactions where symbol_id in (select id from retired_symbol_ids);
delete from public.backtest_trades where symbol_id in (select id from retired_symbol_ids);
delete from public.backtest_runs where symbol_id in (select id from retired_symbol_ids);
delete from public.signal_evaluations where symbol_id in (select id from retired_symbol_ids);
delete from public.consolidated_signals where symbol_id in (select id from retired_symbol_ids);
-- The consolidated-signals delete can itself append revision rows.
delete from public.consolidated_signal_revisions
where previous_row->>'symbol_id' in (select id::text from retired_symbol_ids);
delete from public.signals where symbol_id in (select id from retired_symbol_ids);
delete from public.pattern_instances where symbol_id in (select id from retired_symbol_ids);
delete from public.support_resistance_zones where symbol_id in (select id from retired_symbol_ids);
delete from public.technical_snapshots where symbol_id in (select id from retired_symbol_ids);
delete from public.fundamental_periods where symbol_id in (select id from retired_symbol_ids);
delete from public.corporate_actions where symbol_id in (select id from retired_symbol_ids);
delete from public.disclosures where symbol_id in (select id from retired_symbol_ids);
delete from public.derived_bars where symbol_id in (select id from retired_symbol_ids);
delete from public.daily_prices where symbol_id in (select id from retired_symbol_ids);
delete from public.job_run_items where symbol_id in (select id from retired_symbol_ids);
delete from public.symbol_sector_history where symbol_id in (select id from retired_symbol_ids);
delete from public.breadth_universe_memberships where symbol_id in (select id from retired_symbol_ids);
delete from public.universe_import_rows
where symbol in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF')
   or raw_row->>'symbol' in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF');

-- Keep all previously retired tickers blocked on future watchlist writes.
create or replace function public.strip_retired_watchlist_symbols()
returns trigger language plpgsql set search_path = '' as $$
begin
  select coalesce(jsonb_agg(item.value order by item.ordinal), '[]'::jsonb)
    into new.items
  from jsonb_array_elements(new.items) with ordinality as item(value, ordinal)
  where item.value->>'symbol' not in
    ('DHM', 'LTG', 'DMC', 'POS', 'MTA', 'AMC', 'DHD', 'DPC', 'PXS', 'SP2', 'TAR', 'TCD',
     'DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF');
  return new;
end $$;

update public.user_watchlists set items = items, updated_at = now()
where exists (
  select 1 from jsonb_array_elements(items) as item(value)
  where item.value->>'symbol' in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF')
);

delete from public.symbols where id in (select id from retired_symbol_ids);

-- Seed these rows in the same migration so sector history starts in 2021.
insert into public.symbols(symbol, company_name, sector, exchange, trading_status, active)
values
  ('NVB', 'Ngân hàng TMCP Quốc Dân', 'NGAN HANG', 'HNX', 'UNKNOWN', true),
  ('HUT', 'CTCP Tasco', 'XAY DUNG', 'HNX', 'UNKNOWN', true),
  ('VC3', 'CTCP Tập đoàn Nam Mê Kông', 'BDS', 'HNX', 'UNKNOWN', true),
  ('BVS', 'CTCP Chứng khoán Bảo Việt', 'CHUNG KHOAN', 'HNX', 'UNKNOWN', true),
  ('DXP', 'CTCP Cảng Đoạn Xá', 'VAN TAI CONG NGHIEP', 'HNX', 'UNKNOWN', true),
  ('HDA', 'CTCP Hãng sơn Đông Á', 'XAY DUNG', 'HNX', 'UNKNOWN', true),
  ('APS', 'CTCP Chứng khoán Châu Á - Thái Bình Dương', 'CHUNG KHOAN', 'HNX', 'UNKNOWN', true),
  ('NRC', 'CTCP Tập đoàn Bất Động Sản Quốc Gia', 'BDS', 'HNX', 'UNKNOWN', true),
  ('EVS', 'CTCP Chứng khoán EVS', 'CHUNG KHOAN', 'HNX', 'UNKNOWN', true),
  ('CTP', 'CTCP Tập đoàn CTP Group', 'THUC PHAM', 'HNX', 'UNKNOWN', true),
  ('VFS', 'CTCP Chứng khoán Nhất Việt', 'CHUNG KHOAN', 'HNX', 'UNKNOWN', true),
  ('API', 'CTCP Đầu tư Châu Á - Thái Bình Dương', 'BDS', 'HNX', 'UNKNOWN', true),
  ('PSD', 'CTCP Dịch vụ Phân phối Tổng hợp Dầu khí', 'BAN LE', 'HNX', 'UNKNOWN', true),
  ('VC7', 'CTCP Tập đoàn BGI', 'XAY DUNG', 'HNX', 'UNKNOWN', true),
  ('SVN', 'CTCP Tập đoàn VEXILLA Việt Nam', 'XAY DUNG', 'HNX', 'UNKNOWN', true),
  ('DST', 'CTCP Đầu tư Sao Thăng Long', 'XAY DUNG', 'HNX', 'UNKNOWN', true),
  ('C69', 'CTCP Xây dựng 1369', 'XAY DUNG', 'HNX', 'UNKNOWN', true),
  ('KSV', 'Tổng Công ty Khoáng sản TKV - CTCP', 'KHOANG SAN', 'HNX', 'UNKNOWN', true),
  ('DVM', 'CTCP Dược liệu Việt Nam', 'DUOC', 'HNX', 'UNKNOWN', true),
  ('KSF', 'CTCP Tập đoàn Sunshine', 'BDS', 'HNX', 'UNKNOWN', true),
  ('BKC', 'CTCP Khoáng sản Bắc Kạn', 'KHOANG SAN', 'HNX', 'UNKNOWN', true)
on conflict (symbol) do nothing;

update public.symbol_sector_history h set valid_from = date '2021-01-01'
from public.symbols s
where h.symbol_id = s.id
  and s.symbol in ('NVB', 'HUT', 'VC3', 'BVS', 'DXP', 'HDA', 'APS', 'NRC', 'EVS', 'CTP',
                   'VFS', 'API', 'PSD', 'VC7', 'SVN', 'DST', 'C69', 'KSV', 'DVM', 'KSF', 'BKC')
  and h.valid_from = current_date
  and not exists (select 1 from public.symbol_sector_history older
                  where older.symbol_id = s.id and older.valid_from = date '2021-01-01');

-- Catch any new symbol_id table omitted by the explicit purge.
do $$
declare relation record; remaining bigint;
begin
  for relation in
    select table_schema, table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'symbol_id'
      and table_name not in ('consolidated_signal_revisions')
  loop
    execute format('select count(*) from %I.%I where symbol_id in (select id from retired_symbol_ids)',
      relation.table_schema, relation.table_name) into remaining;
    if remaining > 0 then
      raise exception 'Retired symbol data remains in %.%: %', relation.table_schema, relation.table_name, remaining;
    end if;
  end loop;
  if exists (select 1 from public.symbols where symbol in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF'))
     or exists (select 1 from public.universe_import_rows
       where symbol in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF')
          or raw_row->>'symbol' in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF'))
     or exists (select 1 from public.user_watchlists, jsonb_array_elements(items) as item(value)
       where item.value->>'symbol' in ('DNP', 'MVB', 'NSH', 'SLS', 'THT', 'VIF'))
     or exists (select 1 from public.consolidated_signal_revisions
       where previous_row->>'symbol_id' in (select id::text from retired_symbol_ids)) then
    raise exception 'Retired universe symbol data remains';
  end if;
end $$;

commit;
