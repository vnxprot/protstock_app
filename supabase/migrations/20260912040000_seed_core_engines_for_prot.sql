-- Core-pack migrations may have run before the private Prot account was
-- bootstrapped. Seed any missing engines now that the owner exists. Keep all
-- optional engines paused; Core Engine v1.0 is the explicit active baseline.
with owner_row as (
  select id from auth.users where email = 'prot@protstock.local' limit 1
), packs as (
  select * from (values
    ('Prot Core Engine v1.0', 'Core Pack v1 consolidated legacy conditions', 'ACTIVE', 'v1.0', 'core_ladder_v1'),
    ('Prot Core Engine v2.0', 'Core Pack v2 priority ladder', 'PAUSED', 'v2.0', 'core_ladder_v2'),
    ('Prot Core Pack · Pullback Continuation', 'Core Pack pullback continuation', 'PAUSED', 'v1.0', 'pullback_continuation_v1'),
    ('Prot Core Pack · VCP Breakout', 'Nén biến động 30 phiên, volume kiệt và breakout xác nhận', 'PAUSED', 'v1.0', 'vcp_breakout_v1'),
    ('Prot Core Pack · RSI MACD Divergence', 'Phân kỳ RSI tại vùng hỗ trợ mạnh', 'PAUSED', 'v1.0', 'rsi_macd_divergence_v1'),
    ('Prot Core Pack · Relative Strength Leader', 'Mã mạnh hơn VNINDEX khi thị trường đi ngang hoặc suy yếu', 'PAUSED', 'v1.0', 'relative_strength_leader_v1')
  ) as seed(name, input_text, status, pack_version, engine)
)
insert into public.rules (user_id, name, input_text, status, kind, pack_version, notification_mode)
select owner_row.id, packs.name, packs.input_text, packs.status, 'CORE_PACK', packs.pack_version, 'TELEGRAM'
from owner_row cross join packs
where not exists (
  select 1 from public.rules existing
  where existing.user_id = owner_row.id and existing.name = packs.name
);

insert into public.rule_versions (rule_id, version, dsl, compiled_hash)
select rule.id, 1,
  jsonb_build_object('version', 1, 'timeframe', 'D', 'engine', packs.engine, 'overrides', '{}'::jsonb),
  encode(extensions.digest(rule.name || ':' || packs.pack_version, 'sha256'), 'hex')
from public.rules rule
join (select id from auth.users where email = 'prot@protstock.local' limit 1) owner_row on owner_row.id = rule.user_id
join (values
  ('Prot Core Engine v1.0', 'v1.0', 'core_ladder_v1'),
  ('Prot Core Engine v2.0', 'v2.0', 'core_ladder_v2'),
  ('Prot Core Pack · Pullback Continuation', 'v1.0', 'pullback_continuation_v1'),
  ('Prot Core Pack · VCP Breakout', 'v1.0', 'vcp_breakout_v1'),
  ('Prot Core Pack · RSI MACD Divergence', 'v1.0', 'rsi_macd_divergence_v1'),
  ('Prot Core Pack · Relative Strength Leader', 'v1.0', 'relative_strength_leader_v1')
) as packs(name, pack_version, engine) on packs.name = rule.name
where not exists (
  select 1 from public.rule_versions existing where existing.rule_id = rule.id and existing.version = 1
);

-- Make the frozen v1 baseline available immediately. Optional engines retain
-- their existing toggle state once created.
update public.rules
set status = 'ACTIVE'
where name = 'Prot Core Engine v1.0'
  and user_id = (select id from auth.users where email = 'prot@protstock.local' limit 1);