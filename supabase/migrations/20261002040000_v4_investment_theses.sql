-- Personal investment theses are immutable versions, separate from system signals.
create table public.investment_theses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  current_version_id uuid,
  updated_at timestamptz not null default now(),
  unique(user_id, symbol_id)
);
create table public.investment_thesis_versions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.investment_theses(id) on delete cascade,
  version integer not null check(version > 0),
  thesis text not null check(length(btrim(thesis)) between 1 and 10000),
  catalysts text not null default '',
  invalidation_conditions text not null default '',
  risk_notes text not null default '',
  review_status text not null default 'OBSERVATION' check(review_status in ('OBSERVATION','MAINTAIN','REVIEW','INVALIDATED')),
  created_at timestamptz not null default now(),
  unique(thesis_id,version)
);
alter table public.investment_theses add constraint investment_theses_current_version_fk
  foreign key(current_version_id) references public.investment_thesis_versions(id) on delete set null;
create index investment_thesis_versions_history on public.investment_thesis_versions(thesis_id,version desc);
alter table public.investment_theses enable row level security;
alter table public.investment_thesis_versions enable row level security;
create policy thesis_owner_read on public.investment_theses for select to authenticated
  using(user_id = auth.uid() and public.is_active_member());
create policy thesis_version_owner_read on public.investment_thesis_versions for select to authenticated
  using(exists(select 1 from public.investment_theses t where t.id = thesis_id and t.user_id = auth.uid()) and public.is_active_member());
grant select on public.investment_theses,public.investment_thesis_versions to authenticated;
revoke insert,update,delete on public.investment_theses,public.investment_thesis_versions from anon,authenticated;

create or replace function public.save_investment_thesis(
  p_symbol_id bigint, p_thesis text, p_catalysts text default '',
  p_invalidation_conditions text default '', p_risk_notes text default '',
  p_review_status text default 'OBSERVATION', p_expected_version_id uuid default null, p_expected_user_id uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.investment_theses; version_id uuid; next_version integer;
begin
  if auth.uid() is null or not public.is_active_member() then raise exception 'Unauthorized'; end if;
  if p_expected_user_id is not null and p_expected_user_id <> auth.uid() then raise exception 'Thesis account changed; reload before saving'; end if;
  if length(btrim(coalesce(p_thesis,''))) not between 1 and 10000 then raise exception 'Investment thesis is required (maximum 10000 characters)'; end if;
  if p_review_status not in ('OBSERVATION','MAINTAIN','REVIEW','INVALIDATED') then raise exception 'Invalid review status'; end if;
  insert into public.investment_theses(user_id,symbol_id) values(auth.uid(),p_symbol_id)
    on conflict(user_id,symbol_id) do nothing;
  select * into t from public.investment_theses where user_id = auth.uid() and symbol_id = p_symbol_id for update;
  if t.current_version_id is distinct from p_expected_version_id then
    raise exception 'THESIS_CONFLICT: Thesis changed on another device. Reload before saving.';
  end if;
  select coalesce(max(version),0)+1 into next_version from public.investment_thesis_versions where thesis_id=t.id;
  insert into public.investment_thesis_versions(thesis_id,version,thesis,catalysts,invalidation_conditions,risk_notes,review_status)
    values(t.id,next_version,btrim(p_thesis),coalesce(p_catalysts,''),coalesce(p_invalidation_conditions,''),coalesce(p_risk_notes,''),p_review_status)
    returning id into version_id;
  update public.investment_theses set current_version_id=version_id,updated_at=now() where id=t.id;
  return version_id;
end $$;
revoke all on function public.save_investment_thesis(bigint,text,text,text,text,text,uuid,uuid) from public;
grant execute on function public.save_investment_thesis(bigint,text,text,text,text,text,uuid,uuid) to authenticated;

alter table public.journal_entries add column if not exists evidence_snapshot jsonb;
alter table public.journal_entries add column if not exists thesis_version_id uuid references public.investment_thesis_versions(id) on delete set null;
alter table public.journal_entries add column if not exists review_status text check(review_status in ('OBSERVATION','MAINTAIN','REVIEW','INVALIDATED'));
create index if not exists journal_thesis_version_idx on public.journal_entries(thesis_version_id) where thesis_version_id is not null;
create or replace function public.guard_journal_evidence() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then raise exception 'Journal owner does not match account'; end if;
  if tg_op = 'UPDATE' and (
    new.evidence_snapshot is distinct from old.evidence_snapshot or new.thesis_version_id is distinct from old.thesis_version_id
    or (auth.uid() is not null and new.signal_id is distinct from old.signal_id)
    or ((old.evidence_snapshot is not null or old.thesis_version_id is not null or old.signal_id is not null)
      and (new.symbol_id is distinct from old.symbol_id or new.decision_date is distinct from old.decision_date))
    or new.user_id is distinct from old.user_id
  ) then raise exception 'Historical journal evidence is immutable; create a new entry'; end if;
  if new.thesis_version_id is not null and not exists(
    select 1 from public.investment_thesis_versions v join public.investment_theses t on t.id = v.thesis_id
    where v.id = new.thesis_version_id and t.user_id = new.user_id and t.symbol_id = new.symbol_id
  ) then raise exception 'Thesis version must belong to the journal owner and symbol'; end if;
  return new;
end $$;
create trigger journal_evidence_immutable before insert or update on public.journal_entries
for each row execute function public.guard_journal_evidence();
notify pgrst, 'reload schema';
