-- LTG is deliberately retired from Prot's curated live universe.
-- Keep prices, signals and journal history intact; only future selection/EOD stops.
update public.symbols
set active = false,
    metadata = metadata || jsonb_build_object(
      'universe_status', 'REMOVED',
      'universe_removed_at', current_date,
      'universe_removal_reason', 'Removed by Prot from curated universe'
    )
where symbol = 'LTG';
