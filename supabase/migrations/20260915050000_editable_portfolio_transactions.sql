-- The transaction ledger is the source of truth. Positions are rebuilt after
-- each ledger mutation so editing/deleting history cannot leave stale holdings.

insert into public.portfolio_transactions
  (user_id, portfolio_id, symbol_id, trading_date, action, quantity, price, stop_price, note)
select portfolio.user_id, position.portfolio_id, position.symbol_id, position.opened_at,
  'BUY_NEW', position.quantity, position.average_cost, position.stop_price, 'Imported legacy position'
from public.positions position
join public.portfolios portfolio on portfolio.id = position.portfolio_id
where not exists (
  select 1 from public.portfolio_transactions transaction
  where transaction.portfolio_id = position.portfolio_id and transaction.symbol_id = position.symbol_id
);

create or replace function public.rebuild_portfolio_positions(p_portfolio_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  tx public.portfolio_transactions%rowtype;
  current_position public.positions%rowtype;
  new_quantity bigint;
  new_cost numeric(18,4);
begin
  if not exists (select 1 from public.portfolios where id = p_portfolio_id and user_id = auth.uid()) then
    raise exception 'Portfolio not found';
  end if;

  delete from public.positions where portfolio_id = p_portfolio_id;
  for tx in
    select * from public.portfolio_transactions
    where portfolio_id = p_portfolio_id
    order by trading_date asc, created_at asc, id asc
  loop
    select * into current_position from public.positions
    where portfolio_id = p_portfolio_id and symbol_id = tx.symbol_id for update;

    if tx.action = 'BUY_NEW' then
      if current_position.id is not null or tx.quantity <= 0 or tx.price is null or tx.price <= 0 then
        raise exception 'Invalid BUY_NEW ledger sequence';
      end if;
      insert into public.positions (portfolio_id, symbol_id, quantity, average_cost, stop_price, opened_at)
      values (p_portfolio_id, tx.symbol_id, tx.quantity, tx.price, tx.stop_price, tx.trading_date);
    elsif tx.action = 'BUY_ADD' then
      if current_position.id is null or tx.quantity <= 0 or tx.price is null or tx.price <= 0 then
        raise exception 'Invalid BUY_ADD ledger sequence';
      end if;
      new_quantity := current_position.quantity + tx.quantity;
      new_cost := (current_position.average_cost * current_position.quantity + tx.price * tx.quantity) / new_quantity;
      update public.positions set quantity = new_quantity, average_cost = new_cost,
        stop_price = coalesce(tx.stop_price, current_position.stop_price), updated_at = now()
      where id = current_position.id;
    elsif tx.action = 'SELL_REDUCE' then
      if current_position.id is null or tx.quantity <= 0 or tx.quantity >= current_position.quantity then
        raise exception 'Invalid SELL_REDUCE ledger sequence';
      end if;
      update public.positions set quantity = current_position.quantity - tx.quantity, updated_at = now()
      where id = current_position.id;
    elsif tx.action = 'SELL_CLOSE' then
      if current_position.id is null or tx.quantity <> current_position.quantity then
        raise exception 'Invalid SELL_CLOSE ledger sequence';
      end if;
      delete from public.positions where id = current_position.id;
    elsif tx.action = 'STOP_UPDATE' then
      if current_position.id is null or tx.stop_price is null or tx.stop_price <= 0 then
        raise exception 'Invalid STOP_UPDATE ledger sequence';
      end if;
      update public.positions set stop_price = tx.stop_price, updated_at = now()
      where id = current_position.id;
    else
      raise exception 'Unsupported transaction action';
    end if;
  end loop;
end;
$$;

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
  transaction_id uuid;
  v_decision text;
begin
  if auth.uid() is null or not exists (select 1 from public.portfolios where id = p_portfolio_id and user_id = auth.uid()) then
    raise exception 'Portfolio not found';
  end if;
  if p_action not in ('BUY_NEW', 'BUY_ADD', 'SELL_REDUCE', 'SELL_CLOSE', 'STOP_UPDATE') then
    raise exception 'Unsupported transaction action';
  end if;
  if p_action <> 'STOP_UPDATE' and (p_quantity <= 0 or p_price is null or p_price <= 0) then
    raise exception 'A trade requires positive quantity and VND price';
  end if;
  if p_action = 'STOP_UPDATE' and (p_stop_price is null or p_stop_price <= 0) then
    raise exception 'Stop update requires a positive VND stop';
  end if;

  insert into public.portfolio_transactions (portfolio_id, symbol_id, trading_date, action, quantity, price, stop_price, note)
  values (p_portfolio_id, p_symbol_id, p_trading_date, p_action, p_quantity, p_price, p_stop_price, nullif(trim(p_note), ''))
  returning id into transaction_id;
  perform public.rebuild_portfolio_positions(p_portfolio_id);
  v_decision := case when p_action in ('BUY_NEW', 'BUY_ADD') then 'BUY' when p_action in ('SELL_REDUCE', 'SELL_CLOSE') then 'SELL' else 'HOLD' end;
  insert into public.journal_entries (transaction_id, symbol_id, decision_date, decision, rationale, outcome)
  values (transaction_id, p_symbol_id, p_trading_date, v_decision, coalesce(nullif(trim(p_note), ''), 'Tự động từ giao dịch Danh mục'), 'OPEN');
  return transaction_id;
end;
$$;

create or replace function public.update_portfolio_transaction(
  p_transaction_id uuid,
  p_action text,
  p_quantity bigint,
  p_price numeric default null,
  p_stop_price numeric default null,
  p_note text default null,
  p_trading_date date default current_date
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  tx public.portfolio_transactions%rowtype;
  v_decision text;
begin
  select * into tx from public.portfolio_transactions where id = p_transaction_id and user_id = auth.uid() for update;
  if tx.id is null then raise exception 'Transaction not found'; end if;
  if p_action not in ('BUY_NEW', 'BUY_ADD', 'SELL_REDUCE', 'SELL_CLOSE', 'STOP_UPDATE') then raise exception 'Unsupported transaction action'; end if;
  if p_action <> 'STOP_UPDATE' and (p_quantity <= 0 or p_price is null or p_price <= 0) then raise exception 'A trade requires positive quantity and VND price'; end if;
  if p_action = 'STOP_UPDATE' and (p_stop_price is null or p_stop_price <= 0) then raise exception 'Stop update requires a positive VND stop'; end if;

  update public.portfolio_transactions set trading_date = p_trading_date, action = p_action,
    quantity = p_quantity, price = p_price, stop_price = p_stop_price, note = nullif(trim(p_note), '')
  where id = p_transaction_id;
  perform public.rebuild_portfolio_positions(tx.portfolio_id);
  v_decision := case when p_action in ('BUY_NEW', 'BUY_ADD') then 'BUY' when p_action in ('SELL_REDUCE', 'SELL_CLOSE') then 'SELL' else 'HOLD' end;
  update public.journal_entries set decision_date = p_trading_date, decision = v_decision,
    rationale = coalesce(nullif(trim(p_note), ''), 'Tự động từ giao dịch Danh mục')
  where transaction_id = p_transaction_id;
end;
$$;

create or replace function public.delete_portfolio_transaction(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  tx public.portfolio_transactions%rowtype;
begin
  select * into tx from public.portfolio_transactions where id = p_transaction_id and user_id = auth.uid() for update;
  if tx.id is null then raise exception 'Transaction not found'; end if;
  delete from public.journal_entries where transaction_id = p_transaction_id;
  delete from public.portfolio_transactions where id = p_transaction_id;
  perform public.rebuild_portfolio_positions(tx.portfolio_id);
end;
$$;

revoke all on function public.rebuild_portfolio_positions(uuid) from public;
grant execute on function public.record_portfolio_transaction(uuid, bigint, text, bigint, numeric, numeric, text, date) to authenticated;
grant execute on function public.update_portfolio_transaction(uuid, text, bigint, numeric, numeric, text, date) to authenticated;
grant execute on function public.delete_portfolio_transaction(uuid) to authenticated;
