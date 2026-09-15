-- One transaction is the source of truth for both the open position and its journal trail.

create table if not exists public.portfolio_transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  trading_date date not null,
  action text not null check (action in ('BUY_NEW', 'BUY_ADD', 'SELL_REDUCE', 'SELL_CLOSE', 'STOP_UPDATE')),
  quantity bigint not null default 0 check (quantity >= 0),
  price numeric(18,4),
  stop_price numeric(18,4),
  note text,
  created_at timestamptz not null default now()
);

alter table public.journal_entries
  add column if not exists transaction_id uuid references public.portfolio_transactions(id) on delete set null;

create index if not exists portfolio_transactions_portfolio_date_idx
  on public.portfolio_transactions (portfolio_id, trading_date desc, created_at desc);

alter table public.portfolio_transactions enable row level security;
drop policy if exists owner_portfolio_transactions on public.portfolio_transactions;
create policy owner_portfolio_transactions on public.portfolio_transactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.portfolio_transactions to authenticated;

create or replace function public.record_portfolio_transaction(
  p_portfolio_id uuid,
  p_symbol_id bigint,
  p_action text,
  p_quantity bigint default 0,
  p_price numeric default null,
  p_stop_price numeric default null,
  p_note text default null,
  p_trading_date date default current_date
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_position public.positions%rowtype;
  v_transaction_id uuid;
  v_new_quantity bigint;
  v_new_cost numeric(18,4);
  v_decision text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.portfolios where id = p_portfolio_id and user_id = auth.uid()) then
    raise exception 'Portfolio not found';
  end if;
  if p_action not in ('BUY_NEW', 'BUY_ADD', 'SELL_REDUCE', 'SELL_CLOSE', 'STOP_UPDATE') then
    raise exception 'Unsupported transaction action';
  end if;

  select * into v_position from public.positions
  where portfolio_id = p_portfolio_id and symbol_id = p_symbol_id for update;

  if p_action in ('BUY_NEW', 'BUY_ADD') then
    if p_quantity <= 0 or p_price is null or p_price <= 0 then raise exception 'Buy requires positive quantity and VND price'; end if;
    if p_action = 'BUY_NEW' and v_position.id is not null then raise exception 'Position already exists; use BUY_ADD'; end if;
    if p_action = 'BUY_ADD' and v_position.id is null then raise exception 'Position does not exist; use BUY_NEW'; end if;
    if v_position.id is null then
      insert into public.positions (portfolio_id, symbol_id, quantity, average_cost, stop_price, opened_at)
      values (p_portfolio_id, p_symbol_id, p_quantity, p_price, p_stop_price, p_trading_date);
    else
      v_new_quantity := v_position.quantity + p_quantity;
      v_new_cost := (v_position.average_cost * v_position.quantity + p_price * p_quantity) / v_new_quantity;
      update public.positions set quantity = v_new_quantity, average_cost = v_new_cost,
        stop_price = coalesce(p_stop_price, v_position.stop_price), updated_at = now()
      where id = v_position.id;
    end if;
    v_decision := 'BUY';
  elsif p_action in ('SELL_REDUCE', 'SELL_CLOSE') then
    if v_position.id is null then raise exception 'No open position to sell'; end if;
    if p_quantity <= 0 or p_price is null or p_price <= 0 then raise exception 'Sell requires positive quantity and VND price'; end if;
    if p_action = 'SELL_REDUCE' and p_quantity >= v_position.quantity then raise exception 'Use SELL_CLOSE to close the full position'; end if;
    if p_action = 'SELL_CLOSE' and p_quantity <> v_position.quantity then raise exception 'Close quantity must equal the open position'; end if;
    if p_action = 'SELL_CLOSE' then
      delete from public.positions where id = v_position.id;
    else
      update public.positions set quantity = v_position.quantity - p_quantity, updated_at = now() where id = v_position.id;
    end if;
    v_decision := 'SELL';
  else
    if v_position.id is null or p_stop_price is null or p_stop_price <= 0 then raise exception 'Stop update requires an open position and positive VND stop'; end if;
    update public.positions set stop_price = p_stop_price, updated_at = now() where id = v_position.id;
    v_decision := 'HOLD';
  end if;

  insert into public.portfolio_transactions (portfolio_id, symbol_id, trading_date, action, quantity, price, stop_price, note)
  values (p_portfolio_id, p_symbol_id, p_trading_date, p_action, p_quantity, p_price, p_stop_price, nullif(trim(p_note), ''))
  returning id into v_transaction_id;

  insert into public.journal_entries (transaction_id, symbol_id, decision_date, decision, rationale, outcome)
  values (v_transaction_id, p_symbol_id, p_trading_date, v_decision,
    coalesce(nullif(trim(p_note), ''), 'Tự động từ giao dịch Danh mục'), 'OPEN');
  return v_transaction_id;
end;
$$;

revoke all on function public.record_portfolio_transaction(uuid, bigint, text, bigint, numeric, numeric, text, date) from public;
grant execute on function public.record_portfolio_transaction(uuid, bigint, text, bigint, numeric, numeric, text, date) to authenticated;
