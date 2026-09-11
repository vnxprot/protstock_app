-- Toggleable engines remain auditable without treating old raw signals as current output.
create table public.engine_run_summaries (
  id uuid primary key default extensions.gen_random_uuid(),
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  rule_id uuid not null references public.rules(id) on delete cascade,
  rule_version_id uuid not null references public.rule_versions(id) on delete cascade,
  trading_date date not null,
  timeframe text not null,
  engine_name text not null,
  evaluated_count integer not null default 0 check (evaluated_count >= 0),
  emitted_count integer not null default 0 check (emitted_count >= 0),
  contributed_count integer not null default 0 check (contributed_count >= 0),
  created_at timestamptz not null default now(),
  unique (job_run_id, rule_version_id, timeframe)
);

create index engine_run_summaries_latest_idx on public.engine_run_summaries (rule_id, created_at desc);
alter table public.engine_run_summaries enable row level security;
create policy owner_reads_engine_run_summaries on public.engine_run_summaries for select to authenticated
  using (exists (select 1 from public.rules rule where rule.id = engine_run_summaries.rule_id and rule.user_id = auth.uid()));
grant select on public.engine_run_summaries to authenticated;
