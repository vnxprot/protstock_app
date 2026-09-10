-- §0.5: persist the canonical resolve_signal() decision independently of DSL rules.

alter table public.signals alter column rule_version_id drop not null;
alter table public.signals add column if not exists source text not null default 'USER_RULE'
  check (source in ('CORE_ENGINE', 'USER_RULE'));

create unique index if not exists signals_core_engine_unique
  on public.signals (symbol_id, timeframe, as_of_date)
  where source = 'CORE_ENGINE';

drop policy if exists owner_signals_read on public.signals;
create policy owner_signals_read on public.signals for select to authenticated
  using (
    source = 'CORE_ENGINE'
    or exists (
      select 1
      from public.rule_versions rv
      join public.rules r on r.id = rv.rule_id
      where rv.id = rule_version_id and r.user_id = auth.uid()
    )
  );

-- A partial unique index needs its predicate in ON CONFLICT. The REST upsert API
-- cannot supply that predicate, so the service-role pipeline calls this function.
create or replace function public.upsert_core_engine_signal(
  p_symbol_id bigint,
  p_timeframe text,
  p_as_of_date date,
  p_action text,
  p_score numeric,
  p_reasons jsonb,
  p_evidence jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  persisted_id uuid;
begin
  insert into public.signals (
    rule_version_id, source, symbol_id, timeframe, as_of_date,
    action, score, reasons, evidence
  ) values (
    null, 'CORE_ENGINE', p_symbol_id, p_timeframe, p_as_of_date,
    p_action, p_score, p_reasons, p_evidence
  )
  on conflict (symbol_id, timeframe, as_of_date) where source = 'CORE_ENGINE'
  do update set
    action = excluded.action,
    score = excluded.score,
    reasons = excluded.reasons,
    evidence = excluded.evidence
  returning id into persisted_id;
  return persisted_id;
end;
$$;

revoke all on function public.upsert_core_engine_signal(bigint, text, date, text, numeric, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_core_engine_signal(bigint, text, date, text, numeric, jsonb, jsonb)
  to service_role;

update public.rules set status = 'ARCHIVED'
where name in (
  'Core v1 · Mua nền tích lũy',
  'Core v1 · Mua hai đáy',
  'Core v1 · Theo dõi setup',
  'Core v1 · Bán mẫu hình bearish'
);
