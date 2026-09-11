-- Prot explicitly removed BTD and DAG from the private universe. This is a
-- permanent purge: retain neither market data nor analytical/decision history.

begin;

delete from public.journal_entries where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.positions where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.backtest_trades where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.backtest_runs where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.signals where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.pattern_instances where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.support_resistance_zones where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.technical_snapshots where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.fundamental_periods where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.corporate_actions where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.disclosures where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.derived_bars where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.daily_prices where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.job_run_items where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));
delete from public.symbol_sector_history where symbol_id in (select id from public.symbols where symbol in ('BTD', 'DAG'));

-- Raw universe import rows are audit copies of symbols and must not retain them.
delete from public.universe_import_rows where symbol in ('BTD', 'DAG');
delete from public.symbols where symbol in ('BTD', 'DAG');

do $$
begin
  if exists (select 1 from public.symbols where symbol in ('BTD', 'DAG')) then
    raise exception 'BTD/DAG purge incomplete';
  end if;
end;
$$;

commit;
