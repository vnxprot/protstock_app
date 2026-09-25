-- Free market-depth metrics derived solely from the application's stored EOD OHLCV.
alter table public.technical_snapshots
  add column if not exists last_volume numeric(24,2),
  add column if not exists close_high20 numeric(24,4),
  add column if not exists close_low20 numeric(24,4);

alter table public.market_breadth_snapshots
  add column if not exists advance_count integer not null default 0,
  add column if not exists decline_count integer not null default 0,
  add column if not exists unchanged_count integer not null default 0,
  add column if not exists advance_decline_ratio numeric(12,4),
  add column if not exists new_high20_count integer not null default 0,
  add column if not exists new_low20_count integer not null default 0,
  add column if not exists up_volume numeric(28,2) not null default 0,
  add column if not exists down_volume numeric(28,2) not null default 0,
  add column if not exists up_down_volume_ratio numeric(12,4),
  add column if not exists sector_breadth jsonb not null default '[]'::jsonb;
