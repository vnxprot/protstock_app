-- Claim and initialize a Radar attempt atomically, with the parent inserted first.
alter table public.intraday_radar_sessions drop constraint intraday_radar_sessions_status_check;
alter table public.intraday_radar_sessions add constraint intraday_radar_sessions_status_check
  check (status in ('PROCESSING', 'INCOMPLETE', 'PUBLISHED', 'FAILED'));
alter table public.intraday_radar_symbol_status add column retryable boolean not null default false;

create function public.begin_intraday_radar_session(
  p_day date, p_policy text, p_eligible jsonb, p_missing jsonb, p_pending jsonb,
  p_force boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.intraday_radar_sessions; next_attempt integer;
begin
  if p_day is null or p_day > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Invalid Radar trading date';
  end if;
  insert into public.intraday_radar_sessions(trading_date,status)
    values(p_day,'INCOMPLETE') on conflict(trading_date) do nothing;
  select * into r from public.intraday_radar_sessions where trading_date=p_day for update;
  if r.status='PROCESSING' and r.updated_at > now()-interval '4 hours' then
    return jsonb_build_object('action','IN_PROGRESS','attempt',r.attempt_count);
  end if;
  if r.status='PUBLISHED' and r.source_policy=p_policy and not p_force then
    return jsonb_build_object('action','DONE','attempt',r.attempt_count);
  end if;
  if r.attempt_count>=3 and not p_force then
    return jsonb_build_object('action','RETRY_LIMIT','attempt',r.attempt_count);
  end if;
  next_attempt := case when p_force then 1 else r.attempt_count+1 end;
  update public.intraday_radar_sessions set status='PROCESSING',source_policy=p_policy,
    attempt_count=next_attempt,expected_symbols=jsonb_array_length(p_eligible),
    coverage_threshold=0.95,published_at=null,updated_at=now(),source_errors='[]'
    where trading_date=p_day;
  insert into public.intraday_radar_symbol_status(trading_date,symbol_id,status,error,retryable)
    select p_day,(s->>'id')::bigint,'EMPTY','EOD_MISSING_CANDLE',false
    from jsonb_array_elements(p_missing) s
    on conflict(trading_date,symbol_id) do update set status='EMPTY',baseline_sessions=0,
      source=null,error=excluded.error,retryable=false,updated_at=now();
  -- A runner crash leaves an explicit retryable marker, never an old successful state.
  insert into public.intraday_radar_symbol_status(trading_date,symbol_id,status,error,retryable)
    select p_day,(s->>'id')::bigint,'FAILED','COLLECTOR_NOT_FINISHED',true
    from jsonb_array_elements(p_eligible) s
    where p_pending @> jsonb_build_array((s->>'id')::bigint)
    on conflict(trading_date,symbol_id) do update set status='FAILED',baseline_sessions=0,
      source=null,error=excluded.error,retryable=true,updated_at=now();
  -- Drop statuses for symbols no longer in this attempt's universe.
  delete from public.intraday_radar_symbol_status st where st.trading_date=p_day
    and not exists(select 1 from jsonb_array_elements(p_eligible || p_missing) s
      where (s->>'id')::bigint=st.symbol_id);
  return jsonb_build_object('action','RUN','attempt',next_attempt);
end $$;
revoke all on function public.begin_intraday_radar_session(date,text,jsonb,jsonb,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.begin_intraday_radar_session(date,text,jsonb,jsonb,jsonb,boolean) to service_role;
notify pgrst,'reload schema';
