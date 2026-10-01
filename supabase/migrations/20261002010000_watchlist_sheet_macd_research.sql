-- MACD price-zone divergence remains a daily research assessment, not a signal rule.
update public.rules
set status = 'ARCHIVED', notification_mode = 'RECORD_ONLY', updated_at = now()
where name = 'Prot Core Pack · Phân kỳ Dương MACD' and kind = 'CORE_PACK'
  and user_id in (select id from auth.users where email = 'prot@protstock.local');

-- Preserve any spreadsheet fields when an older client changes a Tier.
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
  insert into public.user_watchlists (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select items into current_items from public.user_watchlists where user_id = auth.uid() for update;
  select value into original_item from jsonb_array_elements(current_items) as value
    where value->>'symbol' = p_symbol limit 1;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into next_items
    from jsonb_array_elements(current_items) as value where value->>'symbol' is distinct from p_symbol;
  if not p_remove then
    next_items := jsonb_build_array(coalesce(original_item, '{}'::jsonb) || jsonb_build_object(
      'symbol', p_symbol, 'tier', p_tier, 'status', 'On',
      'addedAt', coalesce(original_item->>'addedAt', now()::text)
    )) || next_items;
  end if;
  update public.user_watchlists set items = next_items, legacy_imported = true, updated_at = now()
    where user_id = auth.uid();
  return next_items;
end;
$$;

-- Atomic field edits avoid losing changes when two devices update different cells.
create or replace function public.apply_watchlist_entry(p_symbol text, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  current_items jsonb;
  next_items jsonb;
  original_item jsonb;
  next_item jsonb;
  field record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_symbol is null or p_symbol !~ '^[A-Z0-9]{2,8}$'
     or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Invalid watchlist entry';
  end if;
  for field in select key, value from jsonb_each(p_patch) loop
    if field.key not in ('tier', 'status', 'reason', 'investmentHorizon', 'buyZone', 'targetPrice', 'stopLoss')
       or jsonb_typeof(field.value) is distinct from 'string' then
      raise exception 'Invalid watchlist field';
    end if;
    if field.key = 'tier' and field.value #>> '{}' not in ('B', 'A', 'S') then
      raise exception 'Invalid Tier';
    end if;
    if field.key = 'status' and field.value #>> '{}' not in ('On', 'Off') then
      raise exception 'Invalid status';
    end if;
    if (field.key = 'reason' and length(field.value #>> '{}') > 500)
       or (field.key <> 'reason' and length(field.value #>> '{}') > 120) then
      raise exception 'Watchlist field too long';
    end if;
  end loop;
  insert into public.user_watchlists (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select items into current_items from public.user_watchlists where user_id = auth.uid() for update;
  select value into original_item from jsonb_array_elements(current_items) as value
    where value->>'symbol' = p_symbol limit 1;
  next_item := coalesce(original_item, jsonb_build_object(
    'symbol', p_symbol, 'tier', 'B', 'status', 'On', 'addedAt', now()::text
  )) || p_patch;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into next_items
    from jsonb_array_elements(current_items) as value where value->>'symbol' is distinct from p_symbol;
  next_items := jsonb_build_array(next_item) || next_items;
  update public.user_watchlists set items = next_items, legacy_imported = true, updated_at = now()
    where user_id = auth.uid();
  return next_items;
end;
$$;
revoke all on function public.apply_watchlist_entry(text, jsonb) from public;
grant execute on function public.apply_watchlist_entry(text, jsonb) to authenticated;
