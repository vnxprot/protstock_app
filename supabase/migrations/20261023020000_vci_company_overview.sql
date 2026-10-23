-- Shared VCI snapshot, with independent error tracking so a failed refresh
-- preserves the last successfully fetched company overview.
alter table public.canslim_vci_data
  add column if not exists overview jsonb not null default '{}',
  add column if not exists overview_attempted_at timestamptz,
  add column if not exists overview_error text;
