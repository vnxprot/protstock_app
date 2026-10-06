-- Extend only the isolated Challenger research tables. Champion remains untouched.
alter table public.challenger_strategy_assessments
  drop constraint if exists challenger_strategy_assessments_strategy_code_check;
alter table public.challenger_strategy_assessments
  add constraint challenger_strategy_assessments_strategy_code_check
  check (strategy_code in ('UPTREND_CORE','SIDEWAY_RANGE','ADAPTIVE_FUNNEL','MACD_EARLY_ZONE','DOWNTREND_SPRING'));

alter table public.challenger_strategy_tplus_outcomes
  drop constraint if exists challenger_strategy_tplus_outcomes_strategy_code_check;
alter table public.challenger_strategy_tplus_outcomes
  add constraint challenger_strategy_tplus_outcomes_strategy_code_check
  check (strategy_code in ('UPTREND_CORE','SIDEWAY_RANGE','ADAPTIVE_FUNNEL','MACD_EARLY_ZONE','DOWNTREND_SPRING'));
