-- One immutable publication shared by the web and Telegram. No trading signals are modified.
create table public.opportunity_publications (
 id uuid primary key default extensions.gen_random_uuid(),
 trading_date date not null, version text not null, source_revision text not null,
 input_hash text not null, eod_published_at timestamptz not null, radar_published_at timestamptz not null,
 published_at timestamptz not null default now(), historical boolean not null default false,
 rows jsonb not null check(jsonb_typeof(rows)='array'), summary jsonb not null default '{}',
 unique(trading_date,version,input_hash)
);
create index opportunity_publications_day on public.opportunity_publications(trading_date desc,published_at desc);
create table public.opportunity_sessions (
 trading_date date primary key, publication_id uuid not null references public.opportunity_publications(id),
 updated_at timestamptz not null default now()
);
create table public.opportunity_notification_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true, system_alerts boolean not null default true,
 scope text not null default 'ALL' check(scope in ('ALL','WATCHLIST')),
 max_symbols integer not null default 5 check(max_symbols between 1 and 5),
 updated_at timestamptz not null default now()
);
create table public.opportunity_notifications (
 id uuid primary key default extensions.gen_random_uuid(),
 user_id uuid not null references auth.users(id), trading_date date not null,
 publication_id uuid not null references public.opportunity_publications(id),
 status text not null check(status in ('CLAIMED','SENT','FAILED','UNKNOWN')),
 payload jsonb not null, message_id bigint, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(user_id,trading_date)
);
alter table public.opportunity_publications enable row level security;
alter table public.opportunity_sessions enable row level security;
alter table public.opportunity_notification_settings enable row level security;
alter table public.opportunity_notifications enable row level security;
create policy opportunities_read on public.opportunity_publications for select to authenticated using(public.is_active_member());
create policy opportunity_sessions_read on public.opportunity_sessions for select to authenticated using(public.is_active_member());
create policy opportunity_settings_owner on public.opportunity_notification_settings for all to authenticated
 using(user_id=auth.uid() and public.is_prot_admin()) with check(user_id=auth.uid() and public.is_prot_admin());
create policy opportunity_deliveries_owner on public.opportunity_notifications for select to authenticated using(user_id=auth.uid() and public.is_prot_admin());
grant select on public.opportunity_publications,public.opportunity_sessions,public.opportunity_notifications to authenticated;
grant select,insert,update on public.opportunity_notification_settings to authenticated;
grant all on public.opportunity_publications,public.opportunity_sessions,public.opportunity_notification_settings,public.opportunity_notifications to service_role;
insert into public.opportunity_notification_settings(user_id)
 select user_id from public.user_profiles where username='prot' and role='ADMIN' and status='ACTIVE' on conflict do nothing;

create function public.opportunity_inputs(p_day date) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'eod',(select to_jsonb(j) from public.job_runs j where j.trading_date=p_day and j.status='SUCCEEDED'
   and j.source_revision='core-rules-v0.0.0-trend1' and j.counts ? 'published_signals' order by j.finished_at desc limit 1),
 'radar',(select to_jsonb(r) from public.intraday_radar_sessions r where r.trading_date=p_day),
 'previous',(select p.rows from public.opportunity_sessions s join public.opportunity_publications p on p.id=s.publication_id
   where s.trading_date<p_day order by s.trading_date desc limit 1),
 'breadth',(select to_jsonb(b) from public.market_breadth_snapshots b where b.trading_date=p_day),
 'stocks',coalesce((select jsonb_agg(jsonb_build_object('symbol_id',s.id,'symbol',s.symbol,'sector',s.sector,
   'technical',t.payload,'prices',d.payload,'signals',c.payload,'bursts',b.payload,'minute_status',ms.payload,
   'momentum',m.payload,'funnel',f.payload,'macd',mc.payload))
 from public.symbols s
 cross join lateral(select jsonb_agg(to_jsonb(q) order by q.as_of_date) payload from
   (select * from public.technical_snapshots where symbol_id=s.id and timeframe='D' and as_of_date<=p_day order by as_of_date desc limit 4) q) t
 cross join lateral(select jsonb_agg(to_jsonb(q) order by q.trading_date) payload from
   (select trading_date,open,high,low,close,volume,quality_status,price_basis,data_revision from public.daily_prices
    where symbol_id=s.id and trading_date<=p_day order by trading_date desc limit 25) q) d
 cross join lateral(select coalesce(jsonb_agg(to_jsonb(q)),'[]') payload from
   (select timeframe,composite_action,signal_state,trigger_price,invalidation_price,reasons from public.consolidated_signals
    where symbol_id=s.id and as_of_date=p_day and source_revision='core-rules-v0.0.0-trend1') q) c
 cross join lateral(select coalesce(jsonb_agg(to_jsonb(q)),'[]') payload from
   (select id,start_time,end_time,volume,value_vnd,volume_ratio,price_change_pct,direction,baseline_sessions,created_at
    from public.intraday_spike_events where symbol_id=s.id and trading_date=p_day and source='VCI_DIRECT_1M') q) b
 left join lateral(select to_jsonb(q) payload from public.intraday_radar_symbol_status q where symbol_id=s.id and trading_date=p_day) ms on true
 left join lateral(select to_jsonb(q) payload from public.momentum_radar_assessments q where symbol_id=s.id and as_of_date=p_day
   and version='MOMENTUM_RADAR_V0_0_0_TREND1') m on true
 left join lateral(select to_jsonb(q) payload from public.signal_funnel_assessments q where symbol_id=s.id and as_of_date=p_day
   and version='MTF_FUNNEL_SHADOW_V0_0_0_TREND1') f on true
 left join lateral(select to_jsonb(q) payload from public.macd_divergence_assessments q where symbol_id=s.id and as_of_date=p_day
   and version='MACD_BULLISH_DIVERGENCE_ZONE_V0_0_0' and oscillator='MACD_LINE') mc on true
 where s.active),'[]'))
$$;
revoke all on function public.opportunity_inputs(date) from public,anon,authenticated;
grant execute on function public.opportunity_inputs(date) to service_role;

create function public.publish_opportunities(p_day date,p_version text,p_hash text,p_eod timestamptz,p_radar timestamptz,p_rows jsonb,p_summary jsonb,p_historical boolean default true)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; eod_time timestamptz; radar_time timestamptz;
begin
 perform pg_advisory_xact_lock(hashtext('opportunities:'||p_day::text));
 select finished_at into eod_time from public.job_runs where trading_date=p_day and status='SUCCEEDED'
 and source_revision='core-rules-v0.0.0-trend1' and counts ? 'published_signals' order by finished_at desc limit 1;
 select published_at into radar_time from public.intraday_radar_sessions where trading_date=p_day and status='PUBLISHED';
 if eod_time is distinct from p_eod or radar_time is distinct from p_radar or eod_time is null or radar_time is null then
   raise exception 'Source publication changed or is not ready';
 end if;
 insert into public.opportunity_publications(trading_date,version,source_revision,input_hash,eod_published_at,radar_published_at,rows,summary,historical)
 values(p_day,p_version,'core-rules-v0.0.0-trend1',p_hash,p_eod,p_radar,p_rows,p_summary,p_historical)
 on conflict(trading_date,version,input_hash) do nothing returning id into result;
 if result is null then select id into result from public.opportunity_publications where trading_date=p_day and version=p_version and input_hash=p_hash; end if;
 insert into public.opportunity_sessions(trading_date,publication_id) values(p_day,result)
 on conflict(trading_date) do update set publication_id=excluded.publication_id,updated_at=now();
 return result;
end $$;
revoke all on function public.publish_opportunities(date,text,text,timestamptz,timestamptz,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_opportunities(date,text,text,timestamptz,timestamptz,jsonb,jsonb,boolean) to service_role;

create function public.get_opportunities(p_day date default null,p_publication uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare chosen public.opportunity_publications%rowtype; day date; radar_status text; latest_eod timestamptz; latest_radar timestamptz;
begin
 if not public.is_active_member() then raise exception 'Inactive account'; end if;
 if p_publication is not null then
   select * into chosen from public.opportunity_publications where id=p_publication and (p_day is null or trading_date=p_day);
   if not found then return jsonb_build_object('status','NOT_FOUND','rows','[]'::jsonb); end if;
   return to_jsonb(chosen)||jsonb_build_object('status','PUBLISHED','pinned',true);
 end if;
 day:=p_day;
 if day is null then select trading_date into day from public.job_runs where status='SUCCEEDED'
   and source_revision='core-rules-v0.0.0-trend1' and counts ? 'published_signals' order by trading_date desc,finished_at desc limit 1; end if;
 select finished_at into latest_eod from public.job_runs where trading_date=day and status='SUCCEEDED'
   and source_revision='core-rules-v0.0.0-trend1' and counts ? 'published_signals' order by finished_at desc limit 1;
 select status,published_at into radar_status,latest_radar from public.intraday_radar_sessions where trading_date=day;
 select p.* into chosen from public.opportunity_sessions s join public.opportunity_publications p on p.id=s.publication_id where s.trading_date=day;
 if chosen.id is not null and latest_eod=chosen.eod_published_at and radar_status='PUBLISHED' and latest_radar=chosen.radar_published_at then
   return to_jsonb(chosen)||jsonb_build_object('status','PUBLISHED','pinned',false);
 end if;
 return jsonb_build_object('trading_date',day,'status',case when latest_eod is null then 'WAIT_EOD'
   when radar_status='PUBLISHED' then 'WAIT_SUMMARY' when radar_status in ('FAILED','INCOMPLETE') then radar_status else 'WAIT_RADAR' end,'rows','[]'::jsonb);
end $$;
revoke all on function public.get_opportunities(date,uuid) from public,anon;
grant execute on function public.get_opportunities(date,uuid) to authenticated;
notify pgrst, 'reload schema';
