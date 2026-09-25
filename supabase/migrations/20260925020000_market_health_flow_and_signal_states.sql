-- Prot Stock v2.2.1: free OHLCV-derived context. No paid data source required.
alter table public.technical_snapshots
  add column if not exists flow_score numeric(7,2),
  add column if not exists flow_state text not null default 'UNKNOWN'
    check (flow_state in ('PURPLE', 'GREEN', 'RED', 'BLUE', 'NEUTRAL', 'UNKNOWN')),
  add column if not exists cmf20 numeric(10,4),
  add column if not exists obv_slope20 numeric(10,4);

alter table public.market_breadth_snapshots
  add column if not exists pct_above_sma20 numeric(7,4),
  add column if not exists pct_above_sma200 numeric(7,4),
  add column if not exists pct_ma_stack numeric(7,4),
  add column if not exists market_health_score numeric(7,2),
  add column if not exists market_health_state text not null default 'UNKNOWN'
    check (market_health_state in ('RISK_ON', 'NEUTRAL', 'RISK_OFF', 'UNKNOWN'));

alter table public.consolidated_signals
  add column if not exists signal_state text not null default 'ACTIONABLE'
    check (signal_state in ('ACTIONABLE', 'WATCH_SETUP', 'EXTENDED', 'MOMENTUM_CONTINUATION', 'WATCH_CONTEXT'));

create index if not exists consolidated_signals_state_idx
  on public.consolidated_signals (as_of_date desc, signal_state, confluence_score desc);
