-- Seed the private owner's deterministic Core Rules v1 once.
with owner_row as (select id from auth.users where email = 'prot@protstock.local' limit 1)
insert into public.rules (user_id, name, input_text, status)
select owner_row.id, seed.name, seed.input_text, 'ACTIVE'
from owner_row cross join (values
  ('Core v1 · Mua nền tích lũy', 'Mua khi mẫu hình nền tích lũy xác nhận, volume lớn hơn 1.5 lần và RSI từ 40 đến 75'),
  ('Core v1 · Mua hai đáy', 'Mua khi mẫu hình hai đáy xác nhận, volume lớn hơn 1.3 lần và RSI từ 40 đến 75'),
  ('Core v1 · Theo dõi setup', 'Theo dõi khi mẫu hình tam giác tăng sẵn sàng'),
  ('Core v1 · Bán mẫu hình bearish', 'Bán khi mẫu hình hai đỉnh xác nhận')
) as seed(name, input_text)
where not exists (select 1 from public.rules r where r.user_id = owner_row.id and r.name = seed.name);

insert into public.rule_versions (rule_id, version, dsl, compiled_hash)
select r.id, 1,
  case r.name
    when 'Core v1 · Mua nền tích lũy' then '{"version":1,"action":"BUY","timeframe":"D","all":[{"metric":"volume_ratio20","op":">","value":1.5},{"metric":"rsi14","op":"between","min":40,"max":75},{"metric":"pattern","op":"confirmed","type":"ACCUMULATION_BASE"}]}'::jsonb
    when 'Core v1 · Mua hai đáy' then '{"version":1,"action":"BUY","timeframe":"D","all":[{"metric":"volume_ratio20","op":">","value":1.3},{"metric":"rsi14","op":"between","min":40,"max":75},{"metric":"pattern","op":"confirmed","type":"DOUBLE_BOTTOM"}]}'::jsonb
    when 'Core v1 · Theo dõi setup' then '{"version":1,"action":"WATCH","timeframe":"D","all":[{"metric":"pattern","op":"ready","type":"ASCENDING_TRIANGLE"}]}'::jsonb
    else '{"version":1,"action":"SELL","timeframe":"D","all":[{"metric":"pattern","op":"confirmed","type":"DOUBLE_TOP"}]}'::jsonb
  end,
  encode(extensions.digest(r.name, 'sha256'), 'hex')
from public.rules r
where r.name like 'Core v1 · %'
  and not exists (select 1 from public.rule_versions rv where rv.rule_id = r.id and rv.version = 1);
