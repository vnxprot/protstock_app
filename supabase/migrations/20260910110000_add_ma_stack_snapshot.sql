alter table public.technical_snapshots
  add column if not exists ma_stack boolean;
