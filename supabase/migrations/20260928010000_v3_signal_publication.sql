-- v3.0.0: one published decision version per symbol/frame/session, with audit.
alter table public.consolidated_signals
  add column if not exists source_revision text not null default 'legacy';

alter table public.technical_snapshots
  add column if not exists classical_candidates jsonb not null default '[]'::jsonb;

create index if not exists consolidated_signals_publication_idx
  on public.consolidated_signals (as_of_date desc, source_revision, timeframe);

create table if not exists public.consolidated_signal_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  signal_id uuid not null,
  archived_at timestamptz not null default now(),
  previous_row jsonb not null
);

create index if not exists consolidated_signal_revisions_lookup_idx
  on public.consolidated_signal_revisions (signal_id, archived_at desc);

alter table public.consolidated_signal_revisions enable row level security;

create or replace function public.archive_consolidated_signal_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or to_jsonb(new) is distinct from to_jsonb(old) then
    insert into public.consolidated_signal_revisions (signal_id, previous_row)
    values (old.id, to_jsonb(old));
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists archive_consolidated_signal_revision on public.consolidated_signals;
create trigger archive_consolidated_signal_revision
before update or delete on public.consolidated_signals
for each row execute function public.archive_consolidated_signal_revision();

-- Legacy WATCH rows must never appear as an actionable order.
update public.consolidated_signals
set signal_state = case
  when exists (select 1 from jsonb_array_elements_text(to_jsonb(reasons)) as reason(code)
               where code like 'V0_NEAR_%' or code like 'NEAR_TRIGGER_%') then 'WATCH_SETUP'
  else 'WATCH_CONTEXT'
end
where composite_action = 'WATCH' and signal_state = 'ACTIONABLE';

alter table public.consolidated_signals
  add constraint consolidated_watch_not_actionable
  check (composite_action <> 'WATCH' or signal_state <> 'ACTIONABLE');
