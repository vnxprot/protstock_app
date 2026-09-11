alter table public.notification_deliveries alter column signal_id drop not null;
alter table public.notification_deliveries add column if not exists consolidated_signal_id uuid references public.consolidated_signals(id) on delete cascade;
alter table public.notification_deliveries add constraint notification_delivery_signal_source_check check (num_nonnulls(signal_id, consolidated_signal_id) = 1);
alter table public.notification_deliveries add constraint notification_deliveries_consolidated_unique unique (consolidated_signal_id, channel);
