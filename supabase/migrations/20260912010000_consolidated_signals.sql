-- Phase 2: preserve raw signal audit rows while publishing one resolved decision.
create table if not exists public.consolidated_signals (
  id uuid primary key default extensions.gen_random_uuid(),
  symbol_id bigint not null references public.symbols(id) on delete cascade,
  timeframe text not null default 'D',
  as_of_date date not null,
  composite_action text not null check (composite_action in ('PROBE_BUY', 'ADD', 'REDUCE', 'EXIT', 'WATCH')),
  confluence_score integer not null default 70 check (confluence_score between 0 and 100),
  confluence_count integer not null default 1 check (confluence_count >= 1),
  consensus_engines text[] not null,
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (symbol_id, timeframe, as_of_date)
);

create index if not exists consolidated_signals_lookup_idx
  on public.consolidated_signals (as_of_date desc, composite_action, confluence_score desc);

alter table public.consolidated_signals enable row level security;
create policy authenticated_read_consolidated_signals on public.consolidated_signals
  for select to authenticated using (true);
grant select on public.consolidated_signals to authenticated;

-- Pullback already exists. Seed the three additional specialized packs once.
with owner_row as (
  select id from auth.users where email = 'prot@protstock.local' limit 1
), packs as (
  select * from (values
    ('Prot Core Pack · VCP Breakout', 'Nén biến động 30 phiên, volume kiệt và breakout xác nhận', 'ACTIVE', 'v1.0', 'vcp_breakout_v1'),
    ('Prot Core Pack · RSI MACD Divergence', 'Phân kỳ RSI tại vùng hỗ trợ mạnh', 'ACTIVE', 'v1.0', 'rsi_macd_divergence_v1'),
    ('Prot Core Pack · Relative Strength Leader', 'Mã mạnh hơn VNINDEX khi thị trường đi ngang hoặc suy yếu', 'ACTIVE', 'v1.0', 'relative_strength_leader_v1')
  ) as seed(name, input_text, status, pack_version, engine)
), inserted_rules as (
  insert into public.rules (user_id, name, input_text, status, kind, pack_version, notification_mode)
  select owner_row.id, packs.name, packs.input_text, packs.status, 'CORE_PACK', packs.pack_version, 'TELEGRAM'
  from owner_row cross join packs
  where not exists (select 1 from public.rules rule where rule.user_id = owner_row.id and rule.name = packs.name)
  returning id
)
insert into public.rule_versions (rule_id, version, dsl, compiled_hash)
select rule.id, 1, jsonb_build_object('version', 1, 'timeframe', 'D', 'engine', packs.engine, 'overrides', '{}'::jsonb),
  encode(extensions.digest(rule.name || ':' || packs.pack_version, 'sha256'), 'hex')
from public.rules rule
join owner_row on owner_row.id = rule.user_id
join packs on packs.name = rule.name
where not exists (select 1 from public.rule_versions version where version.rule_id = rule.id and version.version = 1);
