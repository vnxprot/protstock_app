-- Retire TLG from the curated universe without deleting prices or history.
update public.symbols
set active = false,
    metadata = metadata || jsonb_build_object('universe_status', 'REMOVED', 'universe_removed_at', current_date, 'universe_removal_reason', 'Removed from Prot universe by user request')
where symbol = 'TLG';
