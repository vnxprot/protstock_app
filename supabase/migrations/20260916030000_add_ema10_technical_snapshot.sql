-- Keep the persisted snapshot contract in step with IndicatorSnapshot.to_dict().
-- EMA10 is used by the pullback engines and must be available to every timeframe.
alter table public.technical_snapshots
  add column if not exists ema10 numeric(18,4);
