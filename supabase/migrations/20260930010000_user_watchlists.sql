-- A single per-user row distinguishes an intentionally empty watchlist from
-- one that has never been migrated from browser storage.
create table public.user_watchlists (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  legacy_imported boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_watchlists enable row level security;
create policy owner_user_watchlists on public.user_watchlists
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_watchlists to authenticated;

-- Row locking prevents two devices editing different symbols from overwriting
-- one another. The function also creates the row on first use.
create or replace function public.apply_watchlist_change(
  p_symbol text, p_tier text, p_remove boolean default false
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  current_items jsonb;
  next_items jsonb;
  original_item jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_symbol is null or p_tier is null or p_symbol !~ '^[A-Z0-9]{2,8}$' or p_tier not in ('B', 'A', 'S') then
    raise exception 'Invalid watchlist change';
  end if;
  insert into public.user_watchlists (user_id) values (auth.uid())
    on conflict (user_id) do nothing;
  select items into current_items from public.user_watchlists
    where user_id = auth.uid() for update;
  select value into original_item from jsonb_array_elements(current_items) as value
    where value->>'symbol' = p_symbol limit 1;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into next_items
    from jsonb_array_elements(current_items) as value
    where value->>'symbol' is distinct from p_symbol;
  if not p_remove then
    next_items := jsonb_build_array(jsonb_build_object(
      'symbol', p_symbol, 'tier', p_tier,
      'addedAt', coalesce(original_item->>'addedAt', now()::text)
    )) || next_items;
  end if;
  update public.user_watchlists set items = next_items, legacy_imported = true, updated_at = now()
    where user_id = auth.uid();
  return next_items;
end;
$$;
revoke all on function public.apply_watchlist_change(text, text, boolean) from public;
grant execute on function public.apply_watchlist_change(text, text, boolean) to authenticated;
