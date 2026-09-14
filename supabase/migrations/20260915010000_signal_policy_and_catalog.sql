-- Forward-only: preserve raw audit rows and old rule versions.
create table public.signal_evaluations (
  id uuid primary key default extensions.gen_random_uuid(),
  rule_version_id uuid not null references public.rule_versions(id),
  symbol_id bigint not null references public.symbols(id),
  timeframe text not null check (timeframe in ('D','W','M')),
  as_of_date date not null,
  proposed_action text not null check (proposed_action in ('WATCH','PROBE_BUY','ADD','REDUCE','EXIT')),
  action text not null check (action in ('WATCH','PROBE_BUY','ADD','REDUCE','EXIT')),
  emitted boolean not null,
  reasons jsonb not null default '[]',
  evidence jsonb not null default '{}',
  unique(rule_version_id,symbol_id,timeframe,as_of_date)
);
alter table public.signal_evaluations enable row level security;
create policy owner_evaluations on public.signal_evaluations for select to authenticated using (
  exists(select 1 from public.rule_versions rv join public.rules r on r.id=rv.rule_id where rv.id=rule_version_id and r.user_id=auth.uid())
);
grant select on public.signal_evaluations to authenticated;

-- Only retire the empty duplicate; keep real versions and all historical evidence.
update public.rules r set status='ARCHIVED', updated_at=now()
where r.name='Prot Core Pack · Hồi về hỗ trợ (Pullback Continuation, khung Ngày)'
and not exists(select 1 from public.rule_versions rv where rv.rule_id=r.id);

do $$
declare r record; old_version record; config jsonb;
begin
  for r in select * from public.rules where kind='CORE_PACK' and name in ('Prot Core Engine v2.0','Prot Core Pack · RSI MACD Divergence') loop
    select * into old_version from public.rule_versions where rule_id=r.id order by version desc limit 1;
    if not found then continue; end if;
    if r.name='Prot Core Engine v2.0' then
      config := old_version.dsl || '{"timeframes":["D","W","M"],"policy_version":"2026-09-15"}'::jsonb;
    else
      config := old_version.dsl || '{"engine":"rsi_macd_confirmation_v1_1","timeframe":"D","policy_version":"2026-09-15"}'::jsonb;
      update public.rules set name='Prot Core Pack · Phân kỳ RSI + xác nhận MACD', pack_version='v1.1', updated_at=now() where id=r.id;
    end if;
    insert into public.rule_versions(rule_id,version,dsl,compiled_hash)
    values(r.id,old_version.version+1,config,encode(extensions.digest(config::text,'sha256'),'hex'));
  end loop;
end $$;

create view public.engine_outcome_stats with (security_invoker=true) as
select r.name as engine_name, s.timeframe, s.action, o.horizon_days,
  count(*) as sample_size, avg(o.forward_return_pct) as average_forward_return,
  avg(o.max_drawdown_pct) as average_drawdown,
  avg(o.hit_invalidation::int) as invalidation_rate
from public.signal_outcomes o join public.signals s on s.id=o.signal_id
left join public.rule_versions rv on rv.id=s.rule_version_id
left join public.rules r on r.id=rv.rule_id
group by r.name,s.timeframe,s.action,o.horizon_days;
grant select on public.engine_outcome_stats to authenticated;
