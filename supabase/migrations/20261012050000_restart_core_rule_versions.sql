-- Start the current Core Engine and Core Pack rule lineage at v0.0.0 while
-- preserving every frozen prior rule_version for existing signals and journals.
do $$
declare pack record; latest public.rule_versions%rowtype;
begin
 for pack in select id from public.rules where kind='CORE_PACK' order by id for update loop
  select * into latest from public.rule_versions where rule_id=pack.id order by version desc limit 1;
  if found and coalesce(latest.dsl->>'implementation_version','') <> 'core-rules-v0.0.0' then
   insert into public.rule_versions(rule_id,version,dsl,compiled_hash)
   values(pack.id,latest.version+1,
          latest.dsl || jsonb_build_object('implementation_version','core-rules-v0.0.0','policy_version','v0.0.0'),
          'pending');
  end if;
 end loop;
end $$;

update public.rules set pack_version='v0.0.0',updated_at=now()
where kind='CORE_PACK';
