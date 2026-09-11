-- Tier 4: versioned, toggleable Core Packs share the normal rule/version path.

alter table public.rules add column if not exists kind text not null default 'USER_RULE'
  check (kind in ('CORE_PACK', 'USER_RULE'));
alter table public.rules add column if not exists pack_version text;
alter table public.rules add column if not exists notification_mode text not null default 'TELEGRAM'
  check (notification_mode in ('RECORD_ONLY', 'SCREENER', 'TELEGRAM'));
alter table public.rules add column if not exists blocks_new_entries boolean not null default false;

-- CORE_PACK is the forward-only source. CORE_ENGINE remains valid for legacy
-- nullable-FK rows created before this migration.
alter table public.signals drop constraint if exists signals_source_check;
alter table public.signals add constraint signals_source_check
  check (source in ('CORE_ENGINE', 'CORE_PACK', 'USER_RULE'));

-- A normal authenticated session can write its own DSL rules but can never
-- create or relabel a Core Pack. Service-role EOD/seeding bypasses RLS.
drop policy if exists owner_rules on public.rules;
create policy owner_rules_read on public.rules for select to authenticated
  using (user_id = auth.uid());
create policy owner_user_rules_insert on public.rules for insert to authenticated
  with check (user_id = auth.uid() and kind = 'USER_RULE');
create policy owner_user_rules_update on public.rules for update to authenticated
  using (user_id = auth.uid() and kind = 'USER_RULE')
  with check (user_id = auth.uid() and kind = 'USER_RULE');
create policy owner_core_pack_status_update on public.rules for update to authenticated
  using (user_id = auth.uid() and kind = 'CORE_PACK')
  with check (user_id = auth.uid() and kind = 'CORE_PACK');
create policy owner_user_rules_delete on public.rules for delete to authenticated
  using (user_id = auth.uid() and kind = 'USER_RULE');

-- Pullback Continuation joins the common pattern lifecycle.
alter table public.pattern_instances drop constraint if exists pattern_instances_pattern_type_check;
alter table public.pattern_instances add constraint pattern_instances_pattern_type_check check (pattern_type in (
  'ACCUMULATION_BASE', 'DOUBLE_BOTTOM', 'DOUBLE_TOP',
  'ASCENDING_TRIANGLE', 'DESCENDING_TRIANGLE', 'SYMMETRICAL_TRIANGLE',
  'BULL_FLAG', 'BEAR_FLAG', 'CANDLE_SUPPORT', 'PULLBACK_CONTINUATION'
));

create or replace view public.effective_signals
with (security_invoker = true)
as
select distinct on (signal.symbol_id, signal.timeframe, signal.as_of_date)
  signal.id as signal_id, signal.symbol_id, signal.timeframe, signal.as_of_date,
  signal.action, signal.source, signal.score, signal.reasons, signal.evidence,
  symbol.symbol, symbol.sector,
  rule.name as rule_name, rule.pack_version, rule.kind, rule.notification_mode,
  rule.blocks_new_entries
from public.signals signal
left join public.rule_versions version on version.id = signal.rule_version_id
left join public.rules rule on rule.id = version.rule_id
join public.symbols symbol on symbol.id = signal.symbol_id
order by signal.symbol_id, signal.timeframe, signal.as_of_date,
  case signal.action
    when 'EXIT' then 0
    when 'REDUCE' then 1
    else case when signal.action = 'WATCH' and coalesce(rule.blocks_new_entries, false) then 2
              when signal.action = 'ADD' then 3
              when signal.action = 'PROBE_BUY' then 4
              else 5 end
  end;

grant select on public.effective_signals to authenticated;

-- Seed only once for the private Prot owner. The legacy four Core v1 DSL rows
-- remain archived; these are new consolidated engines with independent toggles.
with owner_row as (
  select id from auth.users where email = 'prot@protstock.local' limit 1
), packs as (
  select * from (values
    ('Prot Core Engine v2.0', 'Core Pack v2 priority ladder', 'ACTIVE', 'v2.0', 'core_ladder_v2', 'TELEGRAM'),
    ('Prot Core Engine v1.0', 'Core Pack v1 consolidated legacy conditions', 'ACTIVE', 'v1.0', 'core_ladder_v1', 'TELEGRAM'),
    ('Prot Core Pack · Pullback Continuation', 'Core Pack pullback continuation', 'ARCHIVED', 'v1.0', 'pullback_continuation_v1', 'TELEGRAM')
  ) as seed(name, input_text, status, pack_version, engine, notification_mode)
), inserted as (
  insert into public.rules (user_id, name, input_text, status, kind, pack_version, notification_mode)
  select owner_row.id, packs.name, packs.input_text, packs.status, 'CORE_PACK', packs.pack_version, packs.notification_mode
  from owner_row cross join packs
  where not exists (
    select 1 from public.rules existing where existing.user_id = owner_row.id and existing.name = packs.name
  )
  returning id
)
insert into public.rule_versions (rule_id, version, dsl, compiled_hash)
select rule.id, 1,
  jsonb_build_object('version', 1, 'timeframe', 'D', 'engine', packs.engine, 'overrides', '{}'::jsonb),
  encode(extensions.digest(rule.name || ':' || packs.pack_version, 'sha256'), 'hex')
from public.rules rule
join owner_row on owner_row.id = rule.user_id
join packs on packs.name = rule.name
where not exists (select 1 from public.rule_versions existing where existing.rule_id = rule.id and existing.version = 1);
