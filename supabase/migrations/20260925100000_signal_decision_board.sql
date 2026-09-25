-- v2.2.4: a quality WATCH has an explicit plan; passive context remains separate.
alter table public.consolidated_signals
  add column if not exists trigger_price numeric(18,4),
  add column if not exists invalidation_price numeric(18,4),
  add column if not exists expiry_date date;

create index if not exists consolidated_signals_decision_board_idx
  on public.consolidated_signals (as_of_date desc, signal_state, expiry_date, confluence_score desc);
