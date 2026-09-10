alter table public.signals drop constraint if exists signals_action_check;
update public.signals set action = case action
  when 'BUY' then 'PROBE_BUY'
  when 'SELL' then 'REDUCE'
  when 'STOP' then 'REDUCE'
  else action
end;
alter table public.signals add constraint signals_action_check
  check (action in ('PROBE_BUY', 'ADD', 'REDUCE', 'EXIT', 'WATCH'));
