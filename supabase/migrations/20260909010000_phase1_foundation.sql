-- Prot Stock Phase 1: reference, EOD market data, disclosures and job observability.
-- Canonical price data is daily. Weekly/monthly bars are derived and must carry
-- an explicit completion flag to prevent look-ahead bias.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.symbols (
  id bigint generated always as identity primary key,
  symbol text not null unique check (symbol = upper(symbol) and symbol ~ '^[A-Z0-9]{3,10}$'),
  exchange text not null default 'UNKNOWN' check (exchange in ('HOSE', 'HNX', 'UPCOM', 'UNKNOWN')),
  company_name text,
  sector text not null,
  active boolean not null default true,
  listed_from date,
  delisted_on date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delisted_on is null or listed_from is null or delisted_on >= listed_from)
);

create trigger symbols_set_updated_at
before update on public.symbols
for each row execute function public.set_updated_at();

create table public.symbol_sector_history (
  id bigint generated always as identity primary key,
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  sector text not null,
  valid_from date not null,
  valid_to date,
  source text not null default 'universe_import',
  recorded_at timestamptz not null default now(),
  unique (symbol_id, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

create index symbol_sector_history_lookup_idx
  on public.symbol_sector_history (symbol_id, valid_from desc);

create or replace function public.track_symbol_sector()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.symbol_sector_history (symbol_id, sector, valid_from)
    values (new.id, new.sector, current_date)
    on conflict (symbol_id, valid_from) do update set sector = excluded.sector;
  elsif new.sector is distinct from old.sector then
    update public.symbol_sector_history
       set valid_to = current_date - 1
     where symbol_id = new.id and valid_to is null;

    insert into public.symbol_sector_history (symbol_id, sector, valid_from)
    values (new.id, new.sector, current_date)
    on conflict (symbol_id, valid_from) do update set sector = excluded.sector;
  end if;
  return new;
end;
$$;

create trigger symbols_track_sector
after insert or update of sector on public.symbols
for each row execute function public.track_symbol_sector();

create table public.universe_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  source_file_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'PREVIEW'
    check (status in ('PREVIEW', 'APPLIED', 'REJECTED', 'FAILED')),
  deactivate_missing boolean not null default false,
  total_rows integer not null default 0 check (total_rows >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  changed_count integer not null default 0 check (changed_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  diff jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create table public.universe_import_rows (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.universe_imports(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  symbol text,
  sector text,
  active boolean,
  action text not null check (action in ('ADD', 'UPDATE', 'UNCHANGED', 'INVALID', 'DUPLICATE', 'MISSING')),
  validation_errors jsonb not null default '[]'::jsonb,
  raw_row jsonb not null default '{}'::jsonb,
  unique (import_id, row_number)
);

create index universe_import_rows_action_idx
  on public.universe_import_rows (import_id, action);

create table public.daily_prices (
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  trading_date date not null,
  open numeric(18,4) not null check (open > 0),
  high numeric(18,4) not null check (high > 0),
  low numeric(18,4) not null check (low > 0),
  close numeric(18,4) not null check (close > 0),
  volume bigint not null check (volume >= 0),
  traded_value numeric(24,2) check (traded_value is null or traded_value >= 0),
  adjusted_close numeric(18,4) check (adjusted_close is null or adjusted_close > 0),
  adjustment_factor numeric(20,10) not null default 1 check (adjustment_factor > 0),
  source text not null,
  source_url text,
  collected_at timestamptz not null default now(),
  quality_status text not null default 'VALID'
    check (quality_status in ('VALID', 'WARNING', 'REJECTED')),
  raw_payload jsonb,
  primary key (symbol_id, trading_date),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);

create index daily_prices_date_idx on public.daily_prices (trading_date desc);

create table public.derived_bars (
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  timeframe text not null check (timeframe in ('W', 'M')),
  period_start date not null,
  period_end date not null,
  open numeric(18,4) not null check (open > 0),
  high numeric(18,4) not null check (high > 0),
  low numeric(18,4) not null check (low > 0),
  close numeric(18,4) not null check (close > 0),
  volume bigint not null check (volume >= 0),
  traded_value numeric(24,2) check (traded_value is null or traded_value >= 0),
  is_complete boolean not null default false,
  source_last_date date not null,
  calculated_at timestamptz not null default now(),
  primary key (symbol_id, timeframe, period_start),
  check (period_end >= period_start),
  check (source_last_date between period_start and period_end),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);

create index derived_bars_lookup_idx
  on public.derived_bars (symbol_id, timeframe, period_start desc);

create table public.market_indices (
  id bigint generated always as identity primary key,
  code text not null unique check (code = upper(code)),
  name text not null,
  exchange text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.market_index_prices (
  index_id bigint not null references public.market_indices(id) on delete restrict,
  trading_date date not null,
  open numeric(18,4) not null,
  high numeric(18,4) not null,
  low numeric(18,4) not null,
  close numeric(18,4) not null,
  volume bigint check (volume is null or volume >= 0),
  source text not null,
  collected_at timestamptz not null default now(),
  primary key (index_id, trading_date),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high))
);

create table public.corporate_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  symbol_id bigint not null references public.symbols(id) on delete restrict,
  action_type text not null
    check (action_type in ('CASH_DIVIDEND', 'STOCK_DIVIDEND', 'SPLIT', 'RIGHTS_ISSUE', 'BONUS', 'OTHER')),
  ex_date date,
  record_date date,
  payment_date date,
  ratio numeric(20,10),
  cash_amount numeric(20,4),
  currency text default 'VND',
  published_at timestamptz,
  collected_at timestamptz not null default now(),
  source text not null,
  source_url text,
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  unique nulls not distinct (symbol_id, action_type, ex_date, content_hash)
);

create table public.disclosures (
  id uuid primary key default extensions.gen_random_uuid(),
  symbol_id bigint references public.symbols(id) on delete restrict,
  source text not null check (source in ('HOSE', 'HNX', 'UPCOM', 'COMPANY', 'OTHER')),
  source_reference text,
  category text,
  title text not null,
  reporting_period text,
  published_at timestamptz not null,
  collected_at timestamptz not null default now(),
  available_from date not null,
  source_url text not null,
  latest_version integer not null default 1 check (latest_version > 0),
  created_at timestamptz not null default now(),
  unique nulls not distinct (source, source_reference)
);

create index disclosures_point_in_time_idx
  on public.disclosures (symbol_id, available_from desc, published_at desc);

create table public.disclosure_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  disclosure_id uuid not null references public.disclosures(id) on delete cascade,
  version integer not null check (version > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  document_url text,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  unique (disclosure_id, version),
  unique (disclosure_id, content_hash)
);

create table public.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_type text not null check (job_type in ('UNIVERSE_IMPORT', 'EOD_INGEST', 'DISCLOSURE_INGEST', 'DERIVE_BARS', 'VALIDATION')),
  trading_date date,
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'SKIPPED')),
  trigger_type text not null default 'MANUAL'
    check (trigger_type in ('MANUAL', 'SCHEDULED', 'RETRY')),
  source_revision text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_summary text,
  check (finished_at is null or finished_at >= started_at)
);

create index job_runs_recent_idx on public.job_runs (started_at desc);

create table public.job_run_items (
  id bigint generated always as identity primary key,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  symbol_id bigint references public.symbols(id) on delete restrict,
  item_key text,
  status text not null check (status in ('SUCCEEDED', 'WARNING', 'FAILED', 'SKIPPED')),
  rows_written integer not null default 0 check (rows_written >= 0),
  warning_codes jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index job_run_items_run_idx on public.job_run_items (job_run_id, status);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  locale text not null default 'vi-VN',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

create view public.latest_daily_prices
with (security_invoker = true)
as
select distinct on (p.symbol_id)
  p.symbol_id,
  s.symbol,
  s.sector,
  p.trading_date,
  p.open,
  p.high,
  p.low,
  p.close,
  p.volume,
  p.adjusted_close,
  p.quality_status,
  p.collected_at
from public.daily_prices p
join public.symbols s on s.id = p.symbol_id
where s.active
order by p.symbol_id, p.trading_date desc;

insert into public.market_indices (code, name, exchange)
values
  ('VNINDEX', 'VN-Index', 'HOSE'),
  ('HNXINDEX', 'HNX-Index', 'HNX'),
  ('UPCOMINDEX', 'UPCoM-Index', 'UPCOM')
on conflict (code) do nothing;

alter table public.symbols enable row level security;
alter table public.symbol_sector_history enable row level security;
alter table public.universe_imports enable row level security;
alter table public.universe_import_rows enable row level security;
alter table public.daily_prices enable row level security;
alter table public.derived_bars enable row level security;
alter table public.market_indices enable row level security;
alter table public.market_index_prices enable row level security;
alter table public.corporate_actions enable row level security;
alter table public.disclosures enable row level security;
alter table public.disclosure_versions enable row level security;
alter table public.job_runs enable row level security;
alter table public.job_run_items enable row level security;
alter table public.user_settings enable row level security;

create policy authenticated_read_symbols on public.symbols for select to authenticated using (true);
create policy authenticated_read_sector_history on public.symbol_sector_history for select to authenticated using (true);
create policy authenticated_read_universe_imports on public.universe_imports for select to authenticated using (true);
create policy authenticated_read_universe_rows on public.universe_import_rows for select to authenticated using (true);
create policy authenticated_read_daily_prices on public.daily_prices for select to authenticated using (true);
create policy authenticated_read_derived_bars on public.derived_bars for select to authenticated using (true);
create policy authenticated_read_indices on public.market_indices for select to authenticated using (true);
create policy authenticated_read_index_prices on public.market_index_prices for select to authenticated using (true);
create policy authenticated_read_corporate_actions on public.corporate_actions for select to authenticated using (true);
create policy authenticated_read_disclosures on public.disclosures for select to authenticated using (true);
create policy authenticated_read_disclosure_versions on public.disclosure_versions for select to authenticated using (true);
create policy authenticated_read_job_runs on public.job_runs for select to authenticated using (true);
create policy authenticated_read_job_items on public.job_run_items for select to authenticated using (true);
create policy user_reads_own_settings on public.user_settings for select to authenticated using (auth.uid() = user_id);
create policy user_inserts_own_settings on public.user_settings for insert to authenticated with check (auth.uid() = user_id);
create policy user_updates_own_settings on public.user_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant select on public.symbols, public.symbol_sector_history, public.universe_imports,
  public.universe_import_rows, public.daily_prices, public.derived_bars,
  public.market_indices, public.market_index_prices, public.corporate_actions,
  public.disclosures, public.disclosure_versions, public.job_runs,
  public.job_run_items, public.latest_daily_prices to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;
