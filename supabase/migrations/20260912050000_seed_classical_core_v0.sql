-- v0.0 is intentionally seeded paused.  It is a research-first, opt-in engine
-- whose five child model toggles live in rule_versions.dsl.overrides.models.
with owner_row as (
  select id from auth.users where email = 'prot@protstock.local' limit 1
), seed as (
  select
    'Prot Core Engine v0.0'::text as name,
    '5 mô hình cổ điển: nền phẳng, cờ/pennant, hai đáy, hai đỉnh, vai đầu vai'::text as input_text,
    'PAUSED'::text as status,
    'v0.0'::text as pack_version,
    'classical_patterns_v0'::text as engine
)
insert into public.rules (user_id, name, input_text, status, kind, pack_version, notification_mode)
select owner_row.id, seed.name, seed.input_text, seed.status, 'CORE_PACK', seed.pack_version, 'RECORD_ONLY'
from owner_row cross join seed
where not exists (
  select 1 from public.rules existing
  where existing.user_id = owner_row.id and existing.name = seed.name
);

insert into public.rule_versions (rule_id, version, dsl, compiled_hash)
select rule.id, 1,
  jsonb_build_object(
    'version', 1,
    'timeframe', 'D',
    'engine', 'classical_patterns_v0',
    'overrides', jsonb_build_object(
      'models', jsonb_build_object(
        'flat_base', true,
        'flag_pennant', true,
        'double_bottom', true,
        'double_top', true,
        'head_shoulders', true
      )
    )
  ),
  encode(extensions.digest(rule.name || ':v0.0', 'sha256'), 'hex')
from public.rules rule
join (select id from auth.users where email = 'prot@protstock.local' limit 1) owner_row on owner_row.id = rule.user_id
where rule.name = 'Prot Core Engine v0.0'
  and not exists (
    select 1 from public.rule_versions existing
    where existing.rule_id = rule.id and existing.version = 1
  );
