-- Small bounded reads, independently publishable EOD discovery, and explicit build state.
alter table public.opportunity_publications alter column radar_published_at drop not null;
alter table public.opportunity_publications add column phase text not null default 'RADAR' check(phase in ('EOD','RADAR'));
create table public.opportunity_builds (
 trading_date date not null, phase text not null check(phase in ('EOD','RADAR')),
 version text not null, status text not null check(status in ('PROCESSING','READY','PARTIAL','FAILED')),
 attempt integer not null check(attempt between 1 and 3), token uuid not null,
 eod_published_at timestamptz not null, radar_published_at timestamptz,
 previous_publication uuid, publication_id uuid references public.opportunity_publications(id),
 started_at timestamptz not null default now(), finished_at timestamptz, last_error text,
 progress jsonb not null default '{}', primary key(trading_date,phase)
);
alter table public.opportunity_builds enable row level security;
create policy opportunity_builds_read on public.opportunity_builds for select to authenticated using(public.is_active_member());
grant select on public.opportunity_builds to authenticated;
grant all on public.opportunity_builds to service_role;

create function public.opportunity_context(p_day date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'eod',(select jsonb_build_object('finished_at',finished_at,'source_revision',source_revision,'counts',counts)
   from public.job_runs where trading_date=p_day and status='SUCCEEDED' and counts ? 'published_signals' order by finished_at desc limit 1),
 'radar',(select jsonb_build_object('status',status,'published_at',published_at,'baseline_ready_symbols',baseline_ready_symbols,'expected_symbols',expected_symbols)
   from public.intraday_radar_sessions where trading_date=p_day),
 'previous',(select jsonb_build_object('id',p.id,'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'symbol_id',r->'symbol_id','status',r->'status','first_seen',r->'first_seen',
   'support_reference',r->'support_reference','invalidation_price',r->'invalidation_price')) from jsonb_array_elements(p.rows) r),'[]'))
   from public.opportunity_sessions s join public.opportunity_publications p on p.id=s.publication_id where s.trading_date<p_day order by s.trading_date desc limit 1),
 'breadth',(select jsonb_build_object('vnindex_trend_state',vnindex_trend_state,'pct_above_sma50',pct_above_sma50)
   from public.market_breadth_snapshots where trading_date=p_day),
 'symbol_ids',(select coalesce(jsonb_agg(id order by id),'[]') from public.symbols where active))
$$;
revoke all on function public.opportunity_context(date) from public,anon,authenticated;
grant execute on function public.opportunity_context(date) to service_role;

create function public.opportunity_input_batch(p_day date,p_ids bigint[],p_revision text,p_minutes boolean default true) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare output jsonb;
begin
 if coalesce(cardinality(p_ids),0) not between 1 and 25 then raise exception 'Batch must contain 1 to 25 symbols'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('symbol_id',s.id,'symbol',s.symbol,'sector',s.sector,
   'technical',t.payload,'prices',d.payload,'signals',c.payload,'bursts',b.payload,
   'minute_status',ms.payload,'momentum',m.payload,'funnel',f.payload,'macd',mc.payload) order by s.id),'[]') into output
 from public.symbols s
 cross join lateral(select jsonb_agg(to_jsonb(q) order by q.as_of_date) payload from
   (select as_of_date,close,ema20,rsi14,macd_histogram,volume_avg20,volume_ratio20,cmf20,atr14,
     jsonb_build_object('state',monthly_context->>'state') monthly_context
    from public.technical_snapshots where symbol_id=s.id and timeframe='D' and as_of_date<=p_day
    order by as_of_date desc limit 4) q) t
 cross join lateral(select jsonb_agg(to_jsonb(q) order by q.trading_date) payload from
   (select trading_date,open,high,low,close,volume,quality_status from public.daily_prices
    where symbol_id=s.id and trading_date<=p_day order by trading_date desc limit 25) q) d
 cross join lateral(select coalesce(jsonb_agg(to_jsonb(q)),'[]') payload from
   (select timeframe,composite_action,signal_state,trigger_price,invalidation_price
    from public.consolidated_signals where symbol_id=s.id and as_of_date=p_day and source_revision=p_revision) q) c
 cross join lateral(select coalesce(jsonb_agg(to_jsonb(q)),'[]') payload from
   (select id,start_time,end_time,volume,value_vnd,price_change_pct,direction,baseline_sessions
    from public.intraday_spike_events where p_minutes and symbol_id=s.id and trading_date=p_day and source='VCI_DIRECT_1M'
    order by start_time,id) q) b
 left join lateral(select jsonb_build_object('status',status,'baseline_sessions',baseline_sessions) payload
   from public.intraday_radar_symbol_status where p_minutes and symbol_id=s.id and trading_date=p_day limit 1) ms on true
 left join lateral(select jsonb_build_object('stage',stage,'entry_status',entry_status,
     'evidence',jsonb_build_object('monthly_state',evidence->>'monthly_state')) payload
   from public.momentum_radar_assessments where symbol_id=s.id and as_of_date=p_day
   and version='MOMENTUM_RADAR_V0_0_0_TREND1' limit 1) m on true
 left join lateral(select jsonb_build_object('stage',stage) payload from public.signal_funnel_assessments
   where symbol_id=s.id and as_of_date=p_day and version='MTF_FUNNEL_SHADOW_V0_0_0_TREND1' limit 1) f on true
 -- Aggregate variants inside one stock; never multiply the stock by swing count.
 left join lateral(select jsonb_build_object('stage',stage,'swings',swings,'trigger_date',trigger_date) payload
   from public.macd_divergence_assessments where symbol_id=s.id and as_of_date=p_day
   and version='MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0' and oscillator='MACD_LINE'
   order by case when stage='CONFIRMED' and trigger_date=p_day then 0 when stage='WATCH_PRICE_CONFIRMATION' then 1
     when stage='WATCH_PIVOT_CONFIRMATION' then 2 when stage='CONFIRMED' then 3 else 4 end,swings desc limit 1) mc on true
 where s.active and s.id=any(p_ids);
 return output;
end $$;
revoke all on function public.opportunity_input_batch(date,bigint[],text,boolean) from public,anon,authenticated;
grant execute on function public.opportunity_input_batch(date,bigint[],text,boolean) to service_role;

create function public.begin_opportunity_build(p_day date,p_phase text,p_version text,p_eod timestamptz,p_radar timestamptz,p_previous uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.opportunity_builds%rowtype; next_attempt integer; claim uuid; same_source boolean;
begin
 if p_phase not in ('EOD','RADAR') or p_eod is null or (p_phase='RADAR' and p_radar is null) then raise exception 'Invalid build source'; end if;
 perform pg_advisory_xact_lock(hashtext('opportunity-build:'||p_day::text||p_phase));
 select * into old from public.opportunity_builds where trading_date=p_day and phase=p_phase for update;
 same_source:=old.version=p_version and old.eod_published_at=p_eod and old.radar_published_at is not distinct from p_radar
   and old.previous_publication is not distinct from p_previous;
 -- Any live lease blocks a replacement; the token protects updates after lease expiry.
 if old.status='PROCESSING' and old.started_at>now()-interval '20 minutes' then return jsonb_build_object('action','IN_PROGRESS'); end if;
 if same_source and old.status='READY' then return jsonb_build_object('action','READY','publication_id',old.publication_id); end if;
 if same_source and old.attempt>=3 then return jsonb_build_object('action','RETRY_LIMIT','attempt',old.attempt); end if;
 next_attempt:=case when same_source then old.attempt+1 else 1 end;
 claim:=extensions.gen_random_uuid();
 insert into public.opportunity_builds(trading_date,phase,version,status,attempt,token,eod_published_at,radar_published_at,previous_publication)
 values(p_day,p_phase,p_version,'PROCESSING',next_attempt,claim,p_eod,p_radar,p_previous)
 on conflict(trading_date,phase) do update set version=excluded.version,status='PROCESSING',attempt=excluded.attempt,token=excluded.token,
   eod_published_at=p_eod,radar_published_at=p_radar,previous_publication=p_previous,started_at=now(),finished_at=null,last_error=null,progress='{}';
 return jsonb_build_object('action','RUN','attempt',next_attempt,'token',claim);
end $$;
revoke all on function public.begin_opportunity_build(date,text,text,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.begin_opportunity_build(date,text,text,timestamptz,timestamptz,uuid) to service_role;

create or replace function public.publish_opportunities(p_day date,p_version text,p_hash text,p_eod timestamptz,p_radar timestamptz,p_rows jsonb,p_summary jsonb,p_historical boolean default true)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; eod_time timestamptz; radar_time timestamptz; revision text; chosen public.opportunity_publications%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext('opportunities:'||p_day::text));
 select finished_at,source_revision into eod_time,revision from public.job_runs where trading_date=p_day and status='SUCCEEDED'
   and counts ? 'published_signals' order by finished_at desc limit 1;
 select published_at into radar_time from public.intraday_radar_sessions where trading_date=p_day and status='PUBLISHED';
 if eod_time is null or eod_time is distinct from p_eod or (p_radar is not null and radar_time is distinct from p_radar) then
   raise exception 'Source publication changed or is not ready'; end if;
 if jsonb_array_length(p_rows)<>(select count(distinct r->>'symbol_id') from jsonb_array_elements(p_rows) r) then
   raise exception 'Duplicate or missing symbol_id in publication'; end if;
 insert into public.opportunity_publications(trading_date,version,source_revision,input_hash,eod_published_at,radar_published_at,rows,summary,historical,phase)
 values(p_day,p_version,revision,p_hash,p_eod,p_radar,p_rows,p_summary,p_historical,case when p_radar is null then 'EOD' else 'RADAR' end)
 on conflict(trading_date,version,input_hash) do nothing returning id into result;
 if result is null then select id into result from public.opportunity_publications where trading_date=p_day and version=p_version and input_hash=p_hash; end if;
 select p.* into chosen from public.opportunity_sessions s join public.opportunity_publications p on p.id=s.publication_id where s.trading_date=p_day;
 -- A late EOD-only worker must not replace a complete Radar publication of the same source.
 if p_radar is null and chosen.phase='RADAR' and chosen.eod_published_at=p_eod then return result; end if;
 if p_radar is null and chosen.eod_published_at=p_eod and coalesce((chosen.summary->>'input_complete')::boolean,false)
   and not coalesce((p_summary->>'input_complete')::boolean,false) then return result; end if;
 insert into public.opportunity_sessions(trading_date,publication_id) values(p_day,result)
 on conflict(trading_date) do update set publication_id=excluded.publication_id,updated_at=now();
 return result;
end $$;

create function public.finish_opportunity_build(p_day date,p_phase text,p_token uuid,p_hash text,p_rows jsonb,p_summary jsonb,p_historical boolean default true)
returns uuid language plpgsql security invoker set search_path='' as $$
declare build public.opportunity_builds%rowtype; result uuid; partial boolean;
begin
 select * into build from public.opportunity_builds where trading_date=p_day and phase=p_phase and token=p_token and status='PROCESSING' for update;
 if not found then raise exception 'Build lease is not owned'; end if;
 partial:=coalesce((p_summary->>'input_complete')::boolean,false)=false;
 result:=public.publish_opportunities(p_day,build.version,p_hash,build.eod_published_at,
   case when p_phase='RADAR' and not partial then build.radar_published_at else null end,p_rows,p_summary,p_historical);
 update public.opportunity_builds set status=case when partial then 'PARTIAL' else 'READY' end,finished_at=now(),publication_id=result,
   last_error=case when partial then 'Một số nhóm mã chưa xử lý xong; danh sách hiện là sơ bộ.' else null end,progress=p_summary
 where trading_date=p_day and phase=p_phase and token=p_token;
 return result;
end $$;
revoke all on function public.finish_opportunity_build(date,text,uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finish_opportunity_build(date,text,uuid,text,jsonb,jsonb,boolean) to service_role;

create or replace function public.get_opportunities(p_day date default null,p_publication uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare chosen public.opportunity_publications%rowtype; day date; radar_status text; latest_eod timestamptz; latest_radar timestamptz;
 build public.opportunity_builds%rowtype; display_status text; build_json jsonb;
begin
 if not public.is_active_member() then raise exception 'Inactive account'; end if;
 if p_publication is not null then
   select * into chosen from public.opportunity_publications where id=p_publication and (p_day is null or trading_date=p_day);
   if not found then return jsonb_build_object('status','NOT_FOUND','rows','[]'::jsonb); end if;
   return to_jsonb(chosen)||jsonb_build_object('status',case when chosen.phase='EOD' then 'PROVISIONAL' else 'PUBLISHED' end,'pinned',true);
 end if;
 day:=p_day;
 if day is null then select trading_date into day from public.job_runs where status='SUCCEEDED' and counts ? 'published_signals'
   order by trading_date desc,finished_at desc limit 1; end if;
 select finished_at into latest_eod from public.job_runs where trading_date=day and status='SUCCEEDED' and counts ? 'published_signals' order by finished_at desc limit 1;
 select status,published_at into radar_status,latest_radar from public.intraday_radar_sessions where trading_date=day;
 select * into build from public.opportunity_builds where trading_date=day and eod_published_at=latest_eod
   order by case when phase='RADAR' then 0 else 1 end limit 1;
 build_json:=case when build.token is null then null else jsonb_build_object('status',case when build.status='PROCESSING' and build.started_at<now()-interval '20 minutes'
   then 'STALLED' else build.status end,'phase',build.phase,'attempt',build.attempt,'started_at',build.started_at,'finished_at',build.finished_at,
   'last_error',build.last_error,'retry_exhausted',build.attempt>=3 and build.status in ('FAILED','PARTIAL')) end;
 select p.* into chosen from public.opportunity_sessions s join public.opportunity_publications p on p.id=s.publication_id where s.trading_date=day;
 if chosen.id is not null then
   display_status:=case when chosen.eod_published_at is distinct from latest_eod then 'STALE'
     when chosen.phase='EOD' then 'PROVISIONAL'
     when radar_status='PUBLISHED' and latest_radar=chosen.radar_published_at then 'PUBLISHED' else 'STALE' end;
   return to_jsonb(chosen)||jsonb_build_object('status',display_status,'pinned',false,'build',build_json,'radar_status',radar_status);
 end if;
 display_status:=case when latest_eod is null then 'WAIT_EOD' when build_json->>'status'='STALLED' then 'STALLED'
   when build.status='FAILED' then 'FAILED' when build.status='PROCESSING' then 'PROCESSING' else 'NOT_STARTED' end;
 return jsonb_build_object('trading_date',day,'status',display_status,'build',build_json,'radar_status',radar_status,'rows','[]'::jsonb);
end $$;
notify pgrst, 'reload schema';
