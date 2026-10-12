-- Rebuilds must not retain a signal or explanation from a rule that no
-- longer matches the same symbol, timeframe and date.
create or replace function public.remove_superseded_rule_outputs(
  p_symbol_id bigint,
  p_timeframe text,
  p_as_of_date date,
  p_rule_version_ids uuid[],
  p_signal_keys text[],
  p_evaluation_ids uuid[]
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.signals s
  where s.symbol_id = p_symbol_id and s.timeframe = p_timeframe
    and s.as_of_date = p_as_of_date
    and s.rule_version_id = any(p_rule_version_ids)
    and not (s.rule_version_id::text || ':' || s.action = any(p_signal_keys));

  delete from public.signal_evaluations e
  where e.symbol_id = p_symbol_id and e.timeframe = p_timeframe
    and e.as_of_date = p_as_of_date
    and e.rule_version_id = any(p_rule_version_ids)
    and not (e.rule_version_id = any(p_evaluation_ids));
end;
$$;

revoke all on function public.remove_superseded_rule_outputs(bigint,text,date,uuid[],text[],uuid[]) from public, anon, authenticated;
grant execute on function public.remove_superseded_rule_outputs(bigint,text,date,uuid[],text[],uuid[]) to service_role;
