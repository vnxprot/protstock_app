-- Extend the structural v0 engine without replacing its historical five-family version.
do $$
declare rule_row record; prior record; config jsonb;
begin
  select * into rule_row from public.rules
  where user_id = (select id from auth.users where email = 'prot@protstock.local' limit 1)
    and name = 'Prot Core Engine v0.0' and kind = 'CORE_PACK' limit 1;
  if found then
    update public.rules set
      input_text = '7 mô hình: nền phẳng, cờ/pennant, hai đáy, hai đỉnh, vai đầu vai, cốc tay cầm, đáy tròn',
      status = 'ACTIVE', pack_version = 'v0.1', updated_at = now()
    where id = rule_row.id;
    select * into prior from public.rule_versions where rule_id = rule_row.id order by version desc limit 1;
    config := jsonb_set(prior.dsl, '{timeframes}', '["D","W"]'::jsonb, true);
    config := jsonb_set(config, '{overrides,models,cup_handle}', 'true'::jsonb, true) || '{"policy_version":"2026-09-15-v0.1"}'::jsonb;
    if not exists (select 1 from public.rule_versions where rule_id = rule_row.id and dsl->>'policy_version' = '2026-09-15-v0.1') then
      insert into public.rule_versions(rule_id, version, dsl, compiled_hash)
      values(rule_row.id, prior.version + 1, config, encode(extensions.digest(config::text, 'sha256'), 'hex'));
    end if;
  end if;
end $$;

-- Wyckoff contributes transparent context only. T+ Pullback is a short-horizon
-- daily setup, but every proposal still goes through the common safety policy.
with owner_row as (select id from auth.users where email = 'prot@protstock.local' limit 1), seed as (
  select * from (values
    ('Prot Core Pack · Wyckoff Context', 'Wyckoff Spring/SOS và UTAD/SOW làm bối cảnh cung cầu; không tự phát lệnh mua.', 'ACTIVE', 'v1.0', 'wyckoff_context_v1', 'RECORD_ONLY', '["D","W"]'::jsonb),
    ('Prot Core Pack · T+ Pullback', 'Pullback 3–7 phiên trong xu hướng tuần tăng; kích hoạt bằng nến hồi và volume ngày.', 'ACTIVE', 'v1.0', 'tplus_pullback_v1', 'TELEGRAM', '["D"]'::jsonb)
  ) as row(name,input_text,status,pack_version,engine,notification_mode,timeframes)
)
insert into public.rules(user_id,name,input_text,status,kind,pack_version,notification_mode)
select owner_row.id, seed.name, seed.input_text, seed.status, 'CORE_PACK', seed.pack_version, seed.notification_mode
from owner_row cross join seed
where not exists (select 1 from public.rules r where r.user_id=owner_row.id and r.name=seed.name);

insert into public.rule_versions(rule_id,version,dsl,compiled_hash)
select r.id, 1, jsonb_build_object('version',1,'engine',seed.engine,'timeframes',seed.timeframes,'overrides','{}'::jsonb,'policy_version','2026-09-15-v1.0'),
  encode(extensions.digest(r.name || ':2026-09-15-v1.0', 'sha256'), 'hex')
from public.rules r
join (select id from auth.users where email='prot@protstock.local' limit 1) owner_row on owner_row.id=r.user_id
join (values
  ('Prot Core Pack · Wyckoff Context','wyckoff_context_v1','["D","W"]'::jsonb),
  ('Prot Core Pack · T+ Pullback','tplus_pullback_v1','["D"]'::jsonb)
) as seed(name,engine,timeframes) on seed.name=r.name
where not exists (select 1 from public.rule_versions rv where rv.rule_id=r.id);
