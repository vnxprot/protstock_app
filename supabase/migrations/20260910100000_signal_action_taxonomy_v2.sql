alter table public.signals drop constraint if exists signals_action_check;
alter table public.signals add constraint signals_action_check
  check (action in ('PROBE_BUY', 'ADD', 'REDUCE', 'EXIT', 'WATCH'));
