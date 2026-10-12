-- An active symbol with today's OHLCV but an unverified calculation window
-- remains in the Market Health denominator. The missing technical snapshot
-- is a data-quality gap, not a retired or unlisted security.
alter table public.breadth_universe_memberships
  drop constraint if exists breadth_universe_memberships_status_check;
alter table public.breadth_universe_memberships
  add constraint breadth_universe_memberships_status_check
  check (status in ('ELIGIBLE', 'DATA_MISSING_OR_HALTED', 'DATA_QUALITY_BLOCKED',
                   'INSUFFICIENT_HISTORY', 'NOT_ELIGIBLE'));
