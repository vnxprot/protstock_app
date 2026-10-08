-- SSI public self-directed online tariff is the initial estimate. Rates are
-- portfolio-specific and dated; actual amounts on a trade take precedence.
create table public.portfolio_cost_rates (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  effective_date date not null check (effective_date >= date '2026-09-01'),
  buy_fee_pct numeric(8,5) not null check (buy_fee_pct between 0 and 100),
  sell_fee_pct numeric(8,5) not null check (sell_fee_pct between 0 and 100),
  sell_tax_pct numeric(8,5) not null check (sell_tax_pct between 0 and 100),
  source_note text,
  updated_at timestamptz not null default now(),
  primary key (portfolio_id, effective_date)
);
alter table public.portfolio_cost_rates enable row level security;
create policy owner_portfolio_cost_rates on public.portfolio_cost_rates for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));
grant select, insert, update, delete on public.portfolio_cost_rates to authenticated;

alter table public.portfolio_transactions
  add column broker_fee_override numeric(18,2) check (broker_fee_override >= 0),
  add column sell_tax_override numeric(18,2) check (sell_tax_override >= 0);

-- Keep the existing atomic/idempotent trade entry point, then attach overrides
-- in the same database transaction. Retries must use identical overrides.
alter function public.record_portfolio_transaction(uuid,bigint,text,bigint,numeric,numeric,text,date,uuid)
  rename to record_portfolio_transaction_before_costs;
revoke all on function public.record_portfolio_transaction_before_costs(uuid,bigint,text,bigint,numeric,numeric,text,date,uuid) from public,anon,authenticated;
create function public.record_portfolio_transaction(
  p_portfolio_id uuid,p_symbol_id bigint,p_action text,p_quantity bigint default 0,
  p_price numeric default null,p_stop_price numeric default null,p_note text default null,
  p_trading_date date default current_date,p_request_id uuid default extensions.gen_random_uuid(),
  p_broker_fee_override numeric default null,p_sell_tax_override numeric default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare tx public.portfolio_transactions%rowtype; tx_id uuid;
begin
  if p_broker_fee_override < 0 or p_sell_tax_override < 0 then raise exception 'Costs must be nonnegative'; end if;
  if p_action not in ('SELL_REDUCE','SELL_CLOSE') and p_sell_tax_override is not null then raise exception 'Sale tax applies only to a sale'; end if;
  if p_action = 'STOP_UPDATE' and p_broker_fee_override is not null then raise exception 'Stop update has no trading fee'; end if;
  select * into tx from public.portfolio_transactions where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if tx.broker_fee_override is distinct from p_broker_fee_override or tx.sell_tax_override is distinct from p_sell_tax_override then
      raise exception 'Request ID already used for different costs';
    end if;
  end if;
  tx_id := public.record_portfolio_transaction_before_costs(p_portfolio_id,p_symbol_id,p_action,p_quantity,p_price,p_stop_price,p_note,p_trading_date,p_request_id);
  if tx.id is null then
    update public.portfolio_transactions set broker_fee_override=p_broker_fee_override, sell_tax_override=p_sell_tax_override where id=tx_id;
  end if;
  return tx_id;
end $$;
revoke all on function public.record_portfolio_transaction(uuid,bigint,text,bigint,numeric,numeric,text,date,uuid,numeric,numeric) from public,anon;
grant execute on function public.record_portfolio_transaction(uuid,bigint,text,bigint,numeric,numeric,text,date,uuid,numeric,numeric) to authenticated;

alter function public.update_portfolio_transaction(uuid,text,bigint,numeric,numeric,text,date)
  rename to update_portfolio_transaction_before_costs;
revoke all on function public.update_portfolio_transaction_before_costs(uuid,text,bigint,numeric,numeric,text,date) from public,anon,authenticated;
create function public.update_portfolio_transaction(
  p_transaction_id uuid,p_action text,p_quantity bigint,p_price numeric default null,
  p_stop_price numeric default null,p_note text default null,p_trading_date date default current_date,
  p_broker_fee_override numeric default null,p_sell_tax_override numeric default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_broker_fee_override < 0 or p_sell_tax_override < 0 then raise exception 'Costs must be nonnegative'; end if;
  if p_action not in ('SELL_REDUCE','SELL_CLOSE') and p_sell_tax_override is not null then raise exception 'Sale tax applies only to a sale'; end if;
  if p_action = 'STOP_UPDATE' and p_broker_fee_override is not null then raise exception 'Stop update has no trading fee'; end if;
  perform public.update_portfolio_transaction_before_costs(p_transaction_id,p_action,p_quantity,p_price,p_stop_price,p_note,p_trading_date);
  update public.portfolio_transactions set broker_fee_override=p_broker_fee_override, sell_tax_override=p_sell_tax_override
  where id=p_transaction_id and user_id=auth.uid();
end $$;
revoke all on function public.update_portfolio_transaction(uuid,text,bigint,numeric,numeric,text,date,numeric,numeric) from public,anon;
grant execute on function public.update_portfolio_transaction(uuid,text,bigint,numeric,numeric,text,date,numeric,numeric) to authenticated;
