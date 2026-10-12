-- A recent price low is observable before the two later bars needed to
-- confirm a pivot. Keep that observation separate from a confirmed setup.
alter table public.macd_divergence_assessments
  alter column confirmed_on drop not null;

alter table public.macd_divergence_assessments
  drop constraint if exists macd_divergence_assessments_stage_check;

alter table public.macd_divergence_assessments
  add constraint macd_divergence_assessments_stage_check
  check (stage in ('WATCH_PIVOT_CONFIRMATION', 'WATCH_PRICE_CONFIRMATION',
                   'CONFIRMED', 'INVALIDATED', 'EXPIRED'));

alter table public.macd_divergence_assessments
  add constraint macd_divergence_confirmed_date_check
  check ((stage = 'WATCH_PIVOT_CONFIRMATION' and confirmed_on is null)
      or (stage <> 'WATCH_PIVOT_CONFIRMATION' and confirmed_on is not null));
