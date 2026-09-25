alter table public.technical_snapshots
  add column if not exists flow_volume_ratio20 numeric(10,4),
  add column if not exists flow_clv numeric(10,4);
