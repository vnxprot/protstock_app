-- The primary key already serves equality(symbol_id,timeframe) + reverse date scans.
drop index if exists public.derived_bars_lookup_idx;
