-- 26 September 2026 was a Saturday. Remove only signal artifacts wrongly dated
-- to that non-trading day; retain price, market, and job history.
do $$
begin
  if extract(isodow from date '2026-09-26') <> 6 then
    raise exception 'Refusing to remove signals for a trading day';
  end if;

  raise notice '26/09 signal rows before cleanup: evaluations %, consolidated %, raw %',
    (select count(*) from public.signal_evaluations where as_of_date = date '2026-09-26'),
    (select count(*) from public.consolidated_signals where as_of_date = date '2026-09-26'),
    (select count(*) from public.signals where as_of_date = date '2026-09-26');

  delete from public.signal_evaluations where as_of_date = date '2026-09-26';
  delete from public.consolidated_signals where as_of_date = date '2026-09-26';
  delete from public.signals where as_of_date = date '2026-09-26';

  if exists (select 1 from public.signal_evaluations where as_of_date = date '2026-09-26')
    or exists (select 1 from public.consolidated_signals where as_of_date = date '2026-09-26')
    or exists (select 1 from public.signals where as_of_date = date '2026-09-26') then
    raise exception '26/09 signal cleanup did not finish';
  end if;
end $$;
