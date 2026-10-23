create table public.canslim_vci_data (
 symbol_id bigint primary key references public.symbols(id) on delete cascade,
 financial jsonb not null default '[]', prices jsonb not null default '[]',
 fetched_at timestamptz, attempted_at timestamptz not null default now(),
 status text not null default 'PENDING', error text,
 source text not null default 'VCI_DIRECT' check(source='VCI_DIRECT')
);
alter table public.canslim_vci_data enable row level security;
create policy canslim_vci_read on public.canslim_vci_data for select to authenticated using(true);
grant select on public.canslim_vci_data to authenticated;
grant all on public.canslim_vci_data to service_role;
create table public.canslim_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null, updated_at timestamptz not null default now(),
 check(pg_column_size(settings)<150000)
);
alter table public.canslim_preferences enable row level security;
create policy canslim_preferences_owner on public.canslim_preferences for all to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update,delete on public.canslim_preferences to authenticated;
grant all on public.canslim_preferences to service_role;
