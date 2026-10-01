-- Prot's 01/10/2026 universe decision. Delete the seven retired symbols and
-- their data in one transaction; restore TLG without losing its prior history.
begin;

-- Research and archived price rows were introduced immediately before this migration.
delete from public.macd_divergence_outcomes where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.macd_divergence_assessments where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.research_price_sync_status where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.research_price_bars where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.price_revision_archive where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.signal_funnel_outcomes where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.signal_funnel_assessments where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));

delete from public.journal_entries where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.positions where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.portfolio_transactions where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.backtest_trades where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.backtest_runs where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.signal_evaluations where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.consolidated_signals where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
-- The DELETE trigger archives consolidated rows; remove both earlier and
-- freshly archived revisions while the symbol IDs still exist.
delete from public.consolidated_signal_revisions
where previous_row->>'symbol_id' in (select id::text from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.signals where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.pattern_instances where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.support_resistance_zones where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.technical_snapshots where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.fundamental_periods where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.corporate_actions where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.disclosures where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.derived_bars where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.daily_prices where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.job_run_items where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.symbol_sector_history where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.breadth_universe_memberships where symbol_id in (select id from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'));
delete from public.universe_import_rows where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD')
  or raw_row->>'symbol' in ('DHM','LTG','DMC','POS','MTA','AMC','DHD');
update public.user_watchlists
set items = coalesce((select jsonb_agg(element.value) from jsonb_array_elements(items) as element(value)
  where element.value->>'symbol' not in ('DHM','LTG','DMC','POS','MTA','AMC','DHD')), '[]'::jsonb),
  updated_at = now()
where items @> '[{"symbol":"DHM"}]'::jsonb or items @> '[{"symbol":"LTG"}]'::jsonb
   or items @> '[{"symbol":"DMC"}]'::jsonb or items @> '[{"symbol":"POS"}]'::jsonb
   or items @> '[{"symbol":"MTA"}]'::jsonb or items @> '[{"symbol":"AMC"}]'::jsonb
   or items @> '[{"symbol":"DHD"}]'::jsonb;
delete from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD');

insert into public.symbols (symbol, company_name, sector, exchange, active, metadata)
values ('TLG', 'CTCP Tập đoàn Thiên Long', 'BAN LE', 'HOSE', true,
  jsonb_build_object('source', 'data/universe.csv', 'universe_updated_on', '2026-10-01'))
on conflict (symbol) do update set company_name = excluded.company_name,
  sector = excluded.sector, exchange = excluded.exchange, active = true,
  metadata = (public.symbols.metadata - 'universe_status' - 'universe_removed_at' - 'universe_removal_reason') || excluded.metadata;

do $$ begin
  if exists (select 1 from public.symbols where symbol in ('DHM','LTG','DMC','POS','MTA','AMC','DHD'))
     or not exists (select 1 from public.symbols where symbol = 'TLG' and active and sector = 'BAN LE') then
    raise exception 'Universe update incomplete';
  end if;
end $$;
commit;
