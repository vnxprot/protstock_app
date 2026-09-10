create table if not exists public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  signal_id uuid not null references public.signals(id) on delete cascade,
  channel text not null check (channel in ('TELEGRAM', 'EMAIL')),
  delivered_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique (signal_id, channel)
);
alter table public.notification_deliveries enable row level security;
grant select on public.notification_deliveries to authenticated;
