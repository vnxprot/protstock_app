-- The consolidated Core Engine v1.0 replaces these archived DSL rows.
-- Do not delete if historical signals still depend on their rule versions.
do $$
declare
  legacy_rule_version_ids uuid[];
begin
  select array_agg(rv.id) into legacy_rule_version_ids
  from public.rule_versions rv
  join public.rules r on r.id = rv.rule_id
  where r.name in (
    'Core v1 · Mua nền tích lũy', 'Core v1 · Mua hai đáy',
    'Core v1 · Theo dõi setup', 'Core v1 · Bán mẫu hình bearish'
  );

  if exists (
    select 1 from public.signals s
    where s.rule_version_id = any(legacy_rule_version_ids)
  ) then
    raise exception 'Legacy Core v1 rule_versions are still referenced by signals; aborting delete — investigate before retrying.';
  end if;

  delete from public.rule_versions where id = any(legacy_rule_version_ids);
  delete from public.rules where name in (
    'Core v1 · Mua nền tích lũy', 'Core v1 · Mua hai đáy',
    'Core v1 · Theo dõi setup', 'Core v1 · Bán mẫu hình bearish'
  );
end $$;
