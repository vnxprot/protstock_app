-- The initial Core Rules migration can run before the private owner is created.
-- Seed once again after bootstrap, using the current action taxonomy.
with owner_row as (
  select id from auth.users where email = 'prot@protstock.local' limit 1
), seeded_rules as (
  select * from (values
    ('Core v1 · Mua nền tích lũy', 'Mua khi mẫu hình nền tích lũy xác nhận, volume lớn hơn 1.5 lần và RSI từ 40 đến 75', '{"version":1,"action":"PROBE_BUY","timeframe":"D","all":[{"metric":"volume_ratio20","op":">","value":1.5},{"metric":"rsi14","op":"between","min":40,"max":75},{"metric":"pattern","op":"confirmed","type":"ACCUMULATION_BASE"}]}'),
    ('Core v1 · Mua hai đáy', 'Mua khi mẫu hình hai đáy xác nhận, volume lớn hơn 1.3 lần và RSI từ 40 đến 75', '{"version":1,"action":"PROBE_BUY","timeframe":"D","all":[{"metric":"volume_ratio20","op":">","value":1.3},{"metric":"rsi14","op":"between","min":40,"max":75},{"metric":"pattern","op":"confirmed","type":"DOUBLE_BOTTOM"}]}'),
    ('Core v1 · Theo dõi setup', 'Theo dõi khi mẫu hình tam giác tăng sẵn sàng', '{"version":1,"action":"WATCH","timeframe":"D","all":[{"metric":"pattern","op":"ready","type":"ASCENDING_TRIANGLE"}]}'),
    ('Core v1 · Bán mẫu hình bearish', 'Bán khi mẫu hình hai đỉnh xác nhận', '{"version":1,"action":"REDUCE","timeframe":"D","all":[{"metric":"pattern","op":"confirmed","type":"DOUBLE_TOP"}]}')
  ) as seed(name, input_text, dsl)
), inserted_rules as (
  insert into public.rules (user_id, name, input_text, status)
  select owner_row.id, seed.name, seed.input_text, 'ACTIVE'
  from owner_row cross join seeded_rules seed
  where not exists (
    select 1 from public.rules existing
    where existing.user_id = owner_row.id and existing.name = seed.name
  )
  returning id, name
)
insert into public.rule_versions (rule_id, version, dsl, compiled_hash)
select rules.id, 1, seed.dsl::jsonb, encode(extensions.digest(rules.name, 'sha256'), 'hex')
from public.rules rules
join owner_row on owner_row.id = rules.user_id
join seeded_rules seed on seed.name = rules.name
where not exists (
  select 1 from public.rule_versions version
  where version.rule_id = rules.id and version.version = 1
);
