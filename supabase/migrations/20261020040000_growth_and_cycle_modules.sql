-- Bounded, independent research views. No new financial feeds or live trade signals.
create table public.investment_module_current (
 symbol_id bigint primary key references public.symbols(id) on delete cascade,
 as_of_date date not null,
 version text not null,
 source_revision text not null,
 evidence jsonb not null check (jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=12000),
 calculated_at timestamptz not null default now()
);
create table public.investment_module_events (
 symbol_id bigint not null references public.symbols(id) on delete cascade,
 observed_on date not null,
 stage text not null,
 candidate text not null,
 setup text not null,
 weekly_date date,
 version text not null,
 primary key(symbol_id,observed_on)
);
create table public.canslim_reviews (
 user_id uuid not null references auth.users(id) on delete cascade,
 symbol_id bigint not null references public.symbols(id) on delete cascade,
 c text not null check(c in ('PASS','FAIL','UNKNOWN')),
 a text not null check(a in ('PASS','FAIL','UNKNOWN')),
 n text not null check(n in ('PASS','FAIL','UNKNOWN')),
 i text not null check(i in ('PASS','FAIL','UNKNOWN')),
 reviewed_on date not null,
 reporting_period text not null check(length(reporting_period)<=80),
 catalyst text not null check(length(catalyst)<=600),
 risks text not null check(length(risks)<=1200),
 source_url text not null check(length(source_url)<=1000 and (source_url='' or source_url ~ '^https?://[^[:space:]]+$')),
 revision integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(user_id,symbol_id)
);
alter table public.investment_module_current enable row level security;
alter table public.investment_module_events enable row level security;
alter table public.canslim_reviews enable row level security;
create policy module_current_read on public.investment_module_current for select to authenticated using(public.is_active_member());
create policy module_events_read on public.investment_module_events for select to authenticated using(public.is_active_member());
create policy own_canslim_reviews on public.canslim_reviews for select to authenticated using(user_id=auth.uid() and public.is_prot_admin());
grant select on public.investment_module_current,public.investment_module_events,public.canslim_reviews to authenticated;
grant all on public.investment_module_current,public.investment_module_events,public.canslim_reviews to service_role;

create function public.save_canslim_review(p_symbol_id bigint,p_review jsonb,p_expected_revision integer,p_expected_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.canslim_reviews; today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if auth.uid() is null or not public.is_prot_admin() or p_expected_user_id is distinct from auth.uid() then raise exception 'Review owner mismatch or permission denied'; end if;
 if jsonb_typeof(p_review) is distinct from 'object' or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid review'; end if;
 if not exists(select 1 from public.symbols where id=p_symbol_id and active) then raise exception 'Active symbol required'; end if;
 if coalesce(p_review->>'reviewed_on','')='' or (p_review->>'reviewed_on')::date>today then raise exception 'Invalid review date'; end if;
 if (p_review->>'reviewed_on')::date<today-730 then raise exception 'Review must describe a recent personal verification'; end if;
 if coalesce(p_review->>'c','') not in ('PASS','FAIL','UNKNOWN') or coalesce(p_review->>'a','') not in ('PASS','FAIL','UNKNOWN')
   or coalesce(p_review->>'n','') not in ('PASS','FAIL','UNKNOWN') or coalesce(p_review->>'i','') not in ('PASS','FAIL','UNKNOWN') then raise exception 'Invalid review status'; end if;
 if (p_review->>'c'='PASS' or p_review->>'a'='PASS') and trim(coalesce(p_review->>'reporting_period',''))='' then raise exception 'Reporting period required for C/A verification'; end if;
 if (p_review->>'c'='PASS' or p_review->>'a'='PASS' or p_review->>'n'='PASS' or p_review->>'i'='PASS') and trim(coalesce(p_review->>'source_url',''))='' then raise exception 'Source required for verified criteria'; end if;
 if pg_catalog.pg_database_size(current_database())>470000000 then raise exception 'Database capacity reserve reached'; end if;
 if p_expected_revision=0 then
   insert into public.canslim_reviews(user_id,symbol_id,c,a,n,i,reviewed_on,reporting_period,catalyst,risks,source_url)
   values(auth.uid(),p_symbol_id,p_review->>'c',p_review->>'a',p_review->>'n',p_review->>'i',(p_review->>'reviewed_on')::date,
     coalesce(p_review->>'reporting_period',''),coalesce(p_review->>'catalyst',''),coalesce(p_review->>'risks',''),coalesce(p_review->>'source_url',''))
   on conflict do nothing returning * into r;
 else
   update public.canslim_reviews set c=p_review->>'c',a=p_review->>'a',n=p_review->>'n',i=p_review->>'i',
     reviewed_on=(p_review->>'reviewed_on')::date,reporting_period=coalesce(p_review->>'reporting_period',''),
     catalyst=coalesce(p_review->>'catalyst',''),risks=coalesce(p_review->>'risks',''),source_url=coalesce(p_review->>'source_url',''),
     revision=revision+1,updated_at=now()
   where user_id=auth.uid() and symbol_id=p_symbol_id and revision=p_expected_revision returning * into r;
 end if;
 if r.user_id is null then raise exception 'Review conflict: reload the saved review before retrying'; end if;
 return to_jsonb(r);
end $$;
revoke all on function public.save_canslim_review(bigint,jsonb,integer,uuid) from public,anon;
grant execute on function public.save_canslim_review(bigint,jsonb,integer,uuid) to authenticated;

create function public.investment_modules_capacity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare database_bytes bigint; module_bytes bigint;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 select pg_catalog.pg_database_size(current_database()) into database_bytes;
 select sum(pg_catalog.pg_total_relation_size(t::regclass)) into module_bytes
 from unnest(array['public.investment_module_current','public.investment_module_events','public.canslim_reviews']) t;
 return jsonb_build_object('allowed',database_bytes<450000000 and module_bytes<25000000,'database_bytes',database_bytes,'module_bytes',module_bytes);
end $$;
revoke all on function public.investment_modules_capacity() from public,anon,authenticated;
grant execute on function public.investment_modules_capacity() to service_role;

create function public.publish_investment_modules(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cutoff date; rev text; row_count integer; module_bytes bigint;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(20261020,4);
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Expected assessment array'; end if;
 row_count:=jsonb_array_length(p_rows);
 if row_count=0 or row_count>2000 or pg_catalog.octet_length(p_rows::text)>10000000 then raise exception 'Assessment batch outside capacity budget'; end if;
 if pg_catalog.pg_database_size(current_database())>=450000000 then raise exception 'Optional module refresh stopped at 450 MB database reserve'; end if;
 select sum(pg_catalog.pg_total_relation_size(t::regclass)) into module_bytes
 from unnest(array['public.investment_module_current','public.investment_module_events','public.canslim_reviews']) t;
 if module_bytes>=25000000 then raise exception 'Module reserve reached; compact bounded derived tables before refresh'; end if;
 select trading_date,source_revision into cutoff,rev from public.job_runs
 where status='SUCCEEDED' and source_revision='core-rules-v0.0.0-trend1' and counts ? 'published_signals'
 order by trading_date desc,finished_at desc limit 1;
 if cutoff is null then raise exception 'Published EOD required'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'as_of_date')::date is distinct from cutoff
   or x->>'source_revision' is distinct from rev or x->>'version' is distinct from 'INVESTMENT_V1_20261020'
   or jsonb_typeof(x->'evidence') is distinct from 'object'
   or coalesce(x->'evidence'->>'quality','') not in ('VALID','MISSING_SESSION','INSUFFICIENT')) then raise exception 'Invalid publication date, revision or evidence'; end if;
 if row_count<>(select count(*) from public.symbols where active)
   or row_count<>(select count(distinct (x->>'symbol_id')::bigint) from jsonb_array_elements(p_rows) x)
   or exists(select 1 from jsonb_array_elements(p_rows) x where not exists(select 1 from public.symbols s where s.id=(x->>'symbol_id')::bigint and s.active)) then raise exception 'Full active universe required'; end if;
 -- Record only observed changes; never fabricate historical discovery dates.
 insert into public.investment_module_events(symbol_id,observed_on,stage,candidate,setup,weekly_date,version)
 select (x->>'symbol_id')::bigint,cutoff,x->'evidence'->'cycle'->>'state',x->'evidence'->'cycle'->>'candidate',x->'evidence'->>'setup',
   (x->'evidence'->'cycle'->>'weekly_date')::date,x->>'version'
 from jsonb_array_elements(p_rows) x left join public.investment_module_current c on c.symbol_id=(x->>'symbol_id')::bigint
 where c.symbol_id is null or c.evidence->'cycle'->>'state' is distinct from x->'evidence'->'cycle'->>'state'
   or c.evidence->'cycle'->>'candidate' is distinct from x->'evidence'->'cycle'->>'candidate'
   or c.evidence->>'setup' is distinct from x->'evidence'->>'setup'
 on conflict(symbol_id,observed_on) do update set stage=excluded.stage,candidate=excluded.candidate,setup=excluded.setup,weekly_date=excluded.weekly_date,version=excluded.version;
 insert into public.investment_module_current(symbol_id,as_of_date,version,source_revision,evidence)
 select (x->>'symbol_id')::bigint,cutoff,x->>'version',rev,x->'evidence' from jsonb_array_elements(p_rows) x
 on conflict(symbol_id) do update set as_of_date=excluded.as_of_date,version=excluded.version,source_revision=excluded.source_revision,evidence=excluded.evidence,calculated_at=now();
 delete from public.investment_module_current c where not exists(select 1 from public.symbols s where s.id=c.symbol_id and s.active);
 delete from public.investment_module_events e where e.observed_on<cutoff-730 or (e.symbol_id,e.observed_on) in
   (select symbol_id,observed_on from (select symbol_id,observed_on,row_number() over(partition by symbol_id order by observed_on desc) rn from public.investment_module_events) q where rn>60);
 return jsonb_build_object('as_of_date',cutoff,'symbols',row_count,'module_bytes_before',module_bytes,'version','INVESTMENT_V1_20261020');
end $$;
revoke all on function public.publish_investment_modules(jsonb) from public,anon,authenticated;
grant execute on function public.publish_investment_modules(jsonb) to service_role;
notify pgrst,'reload schema';
