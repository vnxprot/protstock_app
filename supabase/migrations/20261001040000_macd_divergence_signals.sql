-- Store the 1-, 2- and 3-segment views independently for each oscillator.
alter table public.macd_divergence_assessments
  drop constraint if exists macd_divergence_assessments_swings_check;
alter table public.macd_divergence_assessments
  add constraint macd_divergence_assessments_swings_check check (swings in (2, 3, 4));
alter table public.macd_divergence_assessments
  drop constraint if exists macd_divergence_assessments_pkey;
alter table public.macd_divergence_assessments
  add primary key (symbol_id, as_of_date, version, oscillator, swings);

-- This pack evaluates the current daily bar only. It does not run replay or
-- publish research outcomes. The shared signal policy still gates buy votes.
with owner_row as (
  select id from auth.users where email = 'prot@protstock.local' limit 1
)
insert into public.rules(user_id,name,input_text,status,kind,pack_version,notification_mode)
select owner_row.id, 'Prot Core Pack · Phân kỳ Dương MACD',
  'Giá tạo 2–4 đáy thấp dần, MACD tại chính các đáy cao dần; WATCH sau xác nhận đáy, PROBE_BUY khi giá đóng vượt đỉnh hồi.',
  'ACTIVE', 'CORE_PACK', 'v3.0', 'TELEGRAM'
from owner_row
where not exists (
  select 1 from public.rules r where r.user_id = owner_row.id
    and r.name = 'Prot Core Pack · Phân kỳ Dương MACD'
);

insert into public.rule_versions(rule_id,version,dsl,compiled_hash)
select r.id, 1,
  jsonb_build_object('version', 1, 'engine', 'macd_bullish_divergence_v3',
                     'timeframes', '["D"]'::jsonb, 'overrides', '{}'::jsonb,
                     'policy_version', '2026-10-01-v3'),
  encode(extensions.digest(r.name || ':2026-10-01-v3', 'sha256'), 'hex')
from public.rules r
where r.name = 'Prot Core Pack · Phân kỳ Dương MACD'
  and r.kind = 'CORE_PACK'
  and not exists (select 1 from public.rule_versions rv where rv.rule_id = r.id);
