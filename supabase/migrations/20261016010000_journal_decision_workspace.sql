-- Additive journal workspace. Legacy notes and automatic ledger trails stay intact.
alter table public.journal_entries
  add column workflow jsonb,
  add column linked_transaction_id uuid references public.portfolio_transactions(id) on delete set null,
  add column linked_cycle_id uuid references public.portfolio_transactions(id) on delete set null;
alter table public.journal_entries drop constraint journal_entries_decision_check;
alter table public.journal_entries add constraint journal_entries_decision_check check (decision in ('BUY','SELL','HOLD','WAIT','SKIP','STOP'));
create unique index journal_one_decision_per_execution on public.journal_entries(linked_transaction_id) where linked_transaction_id is not null;
create index journal_owner_timeline on public.journal_entries(user_id,decision_date desc,created_at desc,id);
create index journal_cycle_link on public.journal_entries(linked_cycle_id) where linked_cycle_id is not null;

create function public.journal_capture_context(p_symbol_id bigint,p_date date,p_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; baseline jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Future evidence is not allowed'; end if;
  select jsonb_build_object('date',d.trading_date,'close',d.close*1000,'revision',d.data_revision,'basis',d.price_basis)
    into baseline from public.daily_prices d where d.symbol_id=p_symbol_id and d.trading_date=p_date
    and d.quality_status='VALID' and d.data_revision is not null;
  select jsonb_build_object(
    'as_of_date',p_date,'source_revision',p_revision,'captured_at',now(),'baseline',baseline,
    'signals',coalesce((select jsonb_agg(jsonb_build_object('timeframe',s.timeframe,'action',s.composite_action,'state',s.signal_state,'score',s.confluence_score,'reasons',s.reasons)) from public.consolidated_signals s where s.symbol_id=p_symbol_id and s.as_of_date=p_date and (p_revision is null or s.source_revision=p_revision)),'[]'::jsonb),
    'engines',coalesce((select jsonb_agg(jsonb_build_object('name',r.name,'version',rv.version,'rule_version_id',rv.id,'signal',to_jsonb(s))) from public.signals s join public.rule_versions rv on rv.id=s.rule_version_id join public.rules r on r.id=rv.rule_id where s.symbol_id=p_symbol_id and s.as_of_date=p_date and (p_revision is null or to_jsonb(s)->>'source_revision'=p_revision)),'[]'::jsonb),
    'challenger',coalesce((select jsonb_agg(to_jsonb(c)) from public.challenger_strategy_assessments c where c.symbol_id=p_symbol_id and c.trading_date=p_date),'[]'::jsonb),
    'funnel',coalesce((select jsonb_agg(to_jsonb(f)) from public.signal_funnel_assessments f where f.symbol_id=p_symbol_id and f.as_of_date=p_date),'[]'::jsonb),
    'radar',coalesce((select jsonb_agg(to_jsonb(r)) from public.momentum_radar_assessments r where r.symbol_id=p_symbol_id and r.as_of_date=p_date),'[]'::jsonb),
    'macd',coalesce((select jsonb_agg(to_jsonb(m)) from public.macd_divergence_assessments m where m.symbol_id=p_symbol_id and m.as_of_date=p_date),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.journal_capture_context(bigint,date,text) from public,anon;
grant execute on function public.journal_capture_context(bigint,date,text) to authenticated;

create function public.journal_cycle_anchor(p_owner uuid,p_transaction uuid) returns uuid
language sql stable security definer set search_path='' as $$
with tx as (
 select t.*,case when t.action in ('BUY_NEW','BUY_ADD') then t.quantity when t.action in ('SELL_REDUCE','SELL_CLOSE') then -t.quantity else 0 end delta,
 row_number() over(partition by t.portfolio_id,t.symbol_id order by t.trading_date,t.created_at,t.id) rn
 from public.portfolio_transactions t where t.user_id=p_owner
), balances as (
 select *,sum(delta) over(partition by portfolio_id,symbol_id order by rn) balance from tx
), grouped as (
 select *,sum(case when delta>0 and balance=delta then 1 else 0 end) over(partition by portfolio_id,symbol_id order by rn) grp from balances
), anchored as (
 select id,grp,first_value(id) over(partition by portfolio_id,symbol_id,grp order by rn) anchor from grouped
) select anchor from anchored where id=p_transaction and grp>0
$$;
revoke all on function public.journal_cycle_anchor(uuid,uuid) from public,anon,authenticated;

create function public.guard_journal_workflow() returns trigger
language plpgsql security definer set search_path='' as $$
declare tx public.portfolio_transactions%rowtype; anchor public.portfolio_transactions%rowtype;
  w jsonb; rule jsonb; evaluation_base jsonb; today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if new.transaction_id is not null and not exists(
    select 1 from public.portfolio_transactions t where t.id=new.transaction_id and t.user_id=new.user_id and t.symbol_id=new.symbol_id
  ) then raise exception 'Original execution must match journal owner and symbol'; end if;
  if new.workflow is null then
    if tg_op='UPDATE' and old.workflow is not null then raise exception 'Historical classification cannot be removed'; end if;
    if new.linked_transaction_id is not null or new.linked_cycle_id is not null then raise exception 'A link requires journal classification'; end if;
    return new;
  end if;
  w := new.workflow;
  if jsonb_typeof(w) <> 'object' or w->>'schema' is distinct from '1'
    or coalesce(w->>'source','') not in ('MANUAL','ANALYSIS','SIGNALS','RADAR','FUNNEL','MACD','PORTFOLIO','UNKNOWN')
    or coalesce(w->>'role','') not in ('CHAMPION','CHALLENGER','PERSONAL','UNKNOWN')
    or coalesce(w->>'status','') not in ('PLANNED','EXECUTED','CANCELLED')
    or coalesce(w->>'adherence','') not in ('FOLLOWED','BROKEN','UNKNOWN')
    or length(coalesce(w->>'strategy','')) > 160 or length(coalesce(w->>'version','')) > 120
    or jsonb_typeof(w->'plan') is distinct from 'object'
    or jsonb_typeof(w->'support') is distinct from 'array' or jsonb_typeof(w->'checks') is distinct from 'array'
    then raise exception 'Invalid journal classification'; end if;
  if new.decision_date > today then raise exception 'Future decision is not allowed'; end if;
  if tg_op='UPDATE' and old.workflow is not null and (
    (w - 'status' - 'adherence' - 'emotion') is distinct from (old.workflow - 'status' - 'adherence' - 'emotion')
    or new.decision is distinct from old.decision or new.symbol_id is distinct from old.symbol_id
  ) then raise exception 'Historical strategy and plan are immutable; create a new decision'; end if;
  if exists(select 1 from jsonb_each(w->'plan') p where p.key in ('entry','stop','target') and p.value<>'null'::jsonb and (p.value #>> '{}')::numeric<=0)
    then raise exception 'Plan prices must be positive VND'; end if;
  if new.workflow->>'status'='CANCELLED' and (new.linked_transaction_id is not null or new.transaction_id is not null)
    then raise exception 'A linked execution cannot be cancelled in the journal'; end if;
  if tg_op='INSERT' or (tg_op='UPDATE' and old.workflow is null) then
    new.workflow := (new.workflow - 'evaluation_base' - 'evaluation_after') || jsonb_build_object('classified_at',now(),
      'classification_timing',case when tg_op='UPDATE' or new.transaction_id is not null or new.linked_transaction_id is not null then 'RETROSPECTIVE' else 'AT_DECISION' end);
  end if;
  if tg_op='UPDATE' and old.linked_transaction_id is not null and new.linked_transaction_id is null
    and not exists(select 1 from public.portfolio_transactions where id=old.linked_transaction_id) then
    new.workflow := jsonb_set(new.workflow,'{status}','"CANCELLED"');
    w:=new.workflow;
  end if;
  if new.linked_transaction_id is not null then
    select * into tx from public.portfolio_transactions where id=new.linked_transaction_id and user_id=new.user_id for update;
    if tx.id is null or tx.symbol_id<>new.symbol_id
      or (new.decision='BUY' and tx.action not in ('BUY_NEW','BUY_ADD'))
      or (new.decision in ('SELL','STOP') and tx.action not in ('SELL_REDUCE','SELL_CLOSE'))
      or (new.decision='HOLD' and tx.action<>'STOP_UPDATE')
      or new.decision in ('WAIT','SKIP') or tx.trading_date<new.decision_date
      then raise exception 'Execution must match owner, symbol, action and decision date'; end if;
    new.workflow := jsonb_set(new.workflow,'{status}','"EXECUTED"');
    if new.linked_cycle_id is not null and new.linked_cycle_id is distinct from public.journal_cycle_anchor(new.user_id,tx.id) then
      raise exception 'Execution belongs to a different cycle';
    end if;
    new.linked_cycle_id := public.journal_cycle_anchor(new.user_id,tx.id);
  elsif new.transaction_id is null and w->>'status'='EXECUTED' and new.decision in ('BUY','SELL','STOP') then
    raise exception 'Executed trade requires a ledger link';
  end if;
  if new.linked_cycle_id is not null then
    select * into anchor from public.portfolio_transactions where id=new.linked_cycle_id and user_id=new.user_id;
    if anchor.id is null or anchor.symbol_id<>new.symbol_id or anchor.action not in ('BUY_NEW','BUY_ADD')
      or public.journal_cycle_anchor(new.user_id,anchor.id) is distinct from anchor.id
      or (tx.id is not null and tx.portfolio_id<>anchor.portfolio_id) then raise exception 'Invalid owner or symbol for cycle'; end if;
  end if;
  if tg_op='INSERT' and new.decision='HOLD' and not exists(
    select 1 from public.positions p join public.portfolios f on f.id=p.portfolio_id
    where f.user_id=new.user_id and p.symbol_id=new.symbol_id and p.quantity>0
  ) then raise exception 'HOLD requires an existing position'; end if;
  if tg_op='INSERT' and w->'evaluation' is not null and w->'evaluation'<>'null'::jsonb then
    rule := w->'evaluation';
    if coalesce(rule->>'horizon','') not in ('5','10','20') or coalesce(rule->>'direction','') not in ('UP','DOWN')
      or coalesce((rule->>'threshold')::numeric,-1) not between 0 and 100 then raise exception 'Invalid forward evaluation rule'; end if;
    -- Evaluation begins after capture, never after a backdated signal. Baseline is server-owned.
    select jsonb_build_object('date',d.trading_date,'close',d.close*1000,'revision',d.data_revision,'basis',d.price_basis)
    into evaluation_base from public.daily_prices d where d.symbol_id=new.symbol_id and d.trading_date<=today
      and d.quality_status='VALID' and d.data_revision is not null order by d.trading_date desc limit 1;
    new.workflow := jsonb_set(new.workflow,'{evaluation_base}',coalesce(evaluation_base,'null'::jsonb));
    new.workflow := jsonb_set(new.workflow,'{evaluation_after}',to_jsonb(today));
  end if;
  return new;
end $$;
create trigger journal_workflow_guard before insert or update on public.journal_entries for each row execute function public.guard_journal_workflow();

-- Owner-only forward observations, not fills or a backtest. Require every market session.
create function public.journal_forward_results() returns jsonb
language sql stable security invoker set search_path='' as $$
with notes as (
  select j.*,j.workflow->'evaluation' rule,j.workflow->'evaluation_base' base,
    (j.workflow->>'evaluation_after')::date start_date
  from public.journal_entries j where j.user_id=auth.uid() and j.workflow->'evaluation' is not null
    and j.workflow->'evaluation'<>'null'::jsonb and j.workflow->>'evaluation_after' is not null
    and j.workflow->>'status'<>'CANCELLED'
), observations as (
  select j.id,j.base,j.rule,j.start_date, future.*,
    exists(select 1 from public.daily_prices b where b.symbol_id=j.symbol_id and b.trading_date=(j.base->>'date')::date
      and b.quality_status='VALID' and b.data_revision=j.base->>'revision' and b.close*1000=(j.base->>'close')::numeric) baseline_valid
  from notes j left join lateral (
    select count(*) sessions,count(p.close) covered,max(p.close*1000) filter(where m.rn=(j.rule->>'horizon')::integer) end_close,
      max(m.trading_date) end_date,
      bool_and(p.quality_status='VALID' and p.data_revision=j.base->>'revision' and p.price_basis=j.base->>'basis') basis_valid
    from (select d.trading_date,row_number() over(order by d.trading_date) rn from public.daily_prices d
      join public.symbols s on s.id=d.symbol_id and s.symbol='VNINDEX'
      where d.trading_date>greatest(j.start_date,(j.base->>'date')::date) and d.trading_date<=(now() at time zone 'Asia/Ho_Chi_Minh')::date
      order by d.trading_date limit (j.rule->>'horizon')::integer) m
    left join public.daily_prices p on p.symbol_id=j.symbol_id and p.trading_date=m.trading_date
  ) future on true
), results as (
select *,case when base is null or base='null'::jsonb then 'MISSING_BASELINE'
  when sessions<(rule->>'horizon')::integer then 'PENDING'
  when covered<>sessions then 'MISSING_DATA'
  when not baseline_valid or not coalesce(basis_valid,false) then 'BASIS_CHANGED'
  else 'READY' end state,
  (end_close/nullif((base->>'close')::numeric,0)-1)*100 return_pct from observations
)
select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'sessions',sessions,'end_date',end_date,
  'return_pct',case when state='READY' then return_pct end,'success',case when state='READY' then
  (case when rule->>'direction'='DOWN' then -return_pct else return_pct end)>=(rule->>'threshold')::numeric end)),'[]'::jsonb) from results
$$;
revoke all on function public.journal_forward_results() from public,anon;
grant execute on function public.journal_forward_results() to authenticated;
notify pgrst,'reload schema';
