create policy authenticated_read_analysis_archives on storage.objects
  for select to authenticated using (
    bucket_id = 'database-archives' and name like 'analysis/v1/%'
  );

create function public.protstock_storage_bytes()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects
  where metadata->>'size' ~ '^[0-9]+$';
$$;
revoke all on function public.protstock_storage_bytes() from public, anon, authenticated;
grant execute on function public.protstock_storage_bytes() to service_role;

create or replace function public.archive_old_pattern_evidence(p_cutoff_date date)
returns table(pattern_id uuid)
language sql security definer set search_path = public as $$
  update public.pattern_instances pattern
  set evidence = null
  where pattern.state in ('FAILED', 'EXPIRED')
    and pattern.as_of_date < p_cutoff_date
    and pattern.evidence is not null
    and not (pattern.evidence ? '_historyObject')
    and not exists (
      select 1 from public.signals signal
      where signal.symbol_id = pattern.symbol_id and signal.timeframe = pattern.timeframe
        and signal.as_of_date = pattern.as_of_date
        and not exists (select 1 from public.signal_outcomes outcome where outcome.signal_id = signal.id)
    )
  returning pattern.id;
$$;
