create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  full_name text not null,
  role text not null default 'CLIENT' check (role in ('ADMIN', 'CLIENT')),
  status text not null default 'INVITED' check (status in ('ACTIVE', 'SUSPENDED', 'INVITED', 'DISABLED')),
  last_login_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_login_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('LOGIN', 'FAILED_LOGIN', 'SIGNOUT', 'FORCED_SIGNOUT')),
  occurred_at timestamptz not null default now(), user_agent text
);
create table if not exists public.user_active_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null, last_seen_at timestamptz not null default now(), user_agent text,
  primary key (user_id, session_id)
);

create or replace function public.is_prot_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles where user_id = auth.uid() and role = 'ADMIN' and status = 'ACTIVE')
$$;
create or replace function public.is_active_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles where user_id = auth.uid() and status = 'ACTIVE')
$$;

insert into public.user_profiles (user_id, username, full_name, role, status)
select id, 'prot', 'Prot', 'ADMIN', 'ACTIVE' from auth.users where email = 'prot@protstock.local'
on conflict (user_id) do update set username = excluded.username, full_name = excluded.full_name, role = 'ADMIN', status = 'ACTIVE';

alter table public.user_profiles enable row level security;
alter table public.user_login_events enable row level security;
alter table public.user_active_sessions enable row level security;
create policy profiles_read_self_or_admin on public.user_profiles for select to authenticated using (user_id = auth.uid() or public.is_prot_admin());
create policy admin_manages_profiles on public.user_profiles for all to authenticated using (public.is_prot_admin()) with check (public.is_prot_admin());
create policy admin_reads_login_events on public.user_login_events for select to authenticated using (public.is_prot_admin());
create policy admin_reads_sessions on public.user_active_sessions for select to authenticated using (public.is_prot_admin());

create or replace function public.record_session_presence(p_session_id text, p_event text default 'LOGIN', p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then raise exception 'Inactive account'; end if;
  if not exists (select 1 from public.user_active_sessions where user_id = auth.uid() and session_id = p_session_id) then
    delete from public.user_active_sessions where user_id = auth.uid() and session_id in (
      select session_id from public.user_active_sessions where user_id = auth.uid() order by last_seen_at asc offset 2
    );
  end if;
  insert into public.user_active_sessions(user_id, session_id, last_seen_at, user_agent) values(auth.uid(), p_session_id, now(), p_user_agent)
  on conflict(user_id, session_id) do update set last_seen_at = excluded.last_seen_at, user_agent = excluded.user_agent;
  update public.user_profiles set last_seen_at = now(), last_login_at = case when p_event = 'LOGIN' then now() else last_login_at end where user_id = auth.uid();
  if p_event = 'LOGIN' then insert into public.user_login_events(user_id,event_type,user_agent) values(auth.uid(),'LOGIN',p_user_agent); end if;
end $$;
grant execute on function public.record_session_presence(text,text,text) to authenticated;
grant select on public.user_profiles to authenticated;

-- Client accounts can read market intelligence only. Operational/personal modules remain Admin-only.
drop policy if exists owner_rules_read on public.rules; drop policy if exists owner_user_rules_insert on public.rules; drop policy if exists owner_user_rules_update on public.rules; drop policy if exists owner_core_pack_status_update on public.rules; drop policy if exists owner_user_rules_delete on public.rules;
create policy admin_rules_only on public.rules for all to authenticated using (public.is_prot_admin()) with check (public.is_prot_admin());
drop policy if exists owner_backtests on public.backtest_runs; create policy admin_backtests_only on public.backtest_runs for all to authenticated using (public.is_prot_admin()) with check (public.is_prot_admin());
drop policy if exists owner_portfolios on public.portfolios; create policy admin_portfolios_only on public.portfolios for all to authenticated using (public.is_prot_admin()) with check (public.is_prot_admin());
drop policy if exists owner_journal on public.journal_entries; create policy admin_journal_only on public.journal_entries for all to authenticated using (public.is_prot_admin()) with check (public.is_prot_admin());
