-- Activate the prospectively evaluated, MACD-line-only price-zone rule.
-- Keep V3 assessments and rule versions for audit; new EOD writes V4 rows.
update public.rules
set input_text = 'Phân kỳ dương theo 2–4 vùng đáy giá và đáy riêng đường MACD. Theo dõi khi vùng mới xác nhận; đề xuất mua chỉ ở phiên giá breakout có volume xác nhận và qua policy chung.',
    pack_version = 'v4.0', status = 'ACTIVE', updated_at = now()
where name = 'Prot Core Pack · Phân kỳ Dương MACD' and kind = 'CORE_PACK'
  and user_id in (select id from auth.users where email = 'prot@protstock.local');

insert into public.rule_versions(rule_id, version, dsl, compiled_hash)
select r.id, coalesce((select max(rv.version) from public.rule_versions rv where rv.rule_id = r.id), 0) + 1,
       jsonb_build_object('version', 4, 'engine', 'macd_bullish_divergence_v4',
                          'timeframes', '["D"]'::jsonb, 'overrides', '{}'::jsonb,
                          'policy_version', '2026-10-01-zone-v4'),
       encode(extensions.digest(r.name || ':2026-10-01-zone-v4', 'sha256'), 'hex')
from public.rules r
where r.name = 'Prot Core Pack · Phân kỳ Dương MACD' and r.kind = 'CORE_PACK'
  and r.user_id in (select id from auth.users where email = 'prot@protstock.local')
  and not exists (select 1 from public.rule_versions rv where rv.rule_id = r.id
                  and rv.dsl->>'engine' = 'macd_bullish_divergence_v4');
