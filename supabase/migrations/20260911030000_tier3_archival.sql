-- Tier 3: archive only old terminal pattern evidence with outcome coverage.

alter table public.pattern_instances alter column evidence drop not null;

create or replace function public.archive_old_pattern_evidence(p_cutoff_date date)
returns table(pattern_id uuid)
language sql
security definer
set search_path = public
as $$
  update public.pattern_instances pattern
  set evidence = null
  where pattern.state in ('FAILED', 'EXPIRED')
    and pattern.as_of_date < p_cutoff_date
    and pattern.evidence is not null
    and not exists (
      select 1
      from public.signals signal
      where signal.symbol_id = pattern.symbol_id
        and signal.timeframe = pattern.timeframe
        and signal.as_of_date = pattern.as_of_date
        and not exists (
          select 1 from public.signal_outcomes outcome where outcome.signal_id = signal.id
        )
    )
  returning pattern.id;
$$;

revoke all on function public.archive_old_pattern_evidence(date) from public, anon, authenticated;
grant execute on function public.archive_old_pattern_evidence(date) to service_role;
