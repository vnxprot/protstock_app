-- Remove the five retired tickers and every symbol-scoped record in one transaction.
begin;

create temporary table retired_symbol_ids on commit drop as
select id, symbol from public.symbols where symbol in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD');

delete from public.macd_divergence_outcomes where symbol_id in (select id from retired_symbol_ids);
delete from public.macd_divergence_assessments where symbol_id in (select id from retired_symbol_ids);
delete from public.research_price_sync_status where symbol_id in (select id from retired_symbol_ids);
delete from public.research_price_bars where symbol_id in (select id from retired_symbol_ids);
delete from public.price_revision_archive where symbol_id in (select id from retired_symbol_ids);
delete from public.signal_funnel_outcomes where symbol_id in (select id from retired_symbol_ids);
delete from public.signal_funnel_assessments where symbol_id in (select id from retired_symbol_ids);

delete from public.journal_entries where symbol_id in (select id from retired_symbol_ids);
delete from public.positions where symbol_id in (select id from retired_symbol_ids);
delete from public.portfolio_transactions where symbol_id in (select id from retired_symbol_ids);
delete from public.backtest_trades where symbol_id in (select id from retired_symbol_ids);
delete from public.backtest_runs where symbol_id in (select id from retired_symbol_ids);
delete from public.signal_evaluations where symbol_id in (select id from retired_symbol_ids);
delete from public.consolidated_signals where symbol_id in (select id from retired_symbol_ids);
-- Deleting consolidated signals archives their old rows; remove those revisions too.
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
where symbol in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD')
   or raw_row->>'symbol' in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD');

-- Existing browser sessions can still send stale watchlist items. Strip these
-- tickers on every watchlist write so they cannot reappear after the purge.
create or replace function public.strip_retired_watchlist_symbols()
returns trigger language plpgsql set search_path = '' as $$
begin
  select coalesce(jsonb_agg(item.value order by item.ordinal), '[]'::jsonb)
    into new.items
  from jsonb_array_elements(new.items) with ordinality as item(value, ordinal)
  where item.value->>'symbol' not in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD');
  return new;
end $$;

create trigger strip_retired_watchlist_symbols
before insert or update of items on public.user_watchlists
for each row execute function public.strip_retired_watchlist_symbols();

update public.user_watchlists set items = items, updated_at = now()
where exists (
  select 1 from jsonb_array_elements(items) as item(value)
  where item.value->>'symbol' in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD')
);

delete from public.symbols where id in (select id from retired_symbol_ids);

-- Catch any newly added symbol_id table that the explicit purge missed.
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
  if exists (select 1 from public.symbols where symbol in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD'))
     or exists (select 1 from public.universe_import_rows
       where symbol in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD')
          or raw_row->>'symbol' in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD'))
     or exists (select 1 from public.user_watchlists, jsonb_array_elements(items) as item(value)
       where item.value->>'symbol' in ('DPC', 'PXS', 'SP2', 'TAR', 'TCD'))
     or exists (select 1 from public.consolidated_signal_revisions
       where previous_row->>'symbol_id' in (select id::text from retired_symbol_ids)) then
    raise exception 'Retired universe symbol data remains';
  end if;
end $$;

commit;
