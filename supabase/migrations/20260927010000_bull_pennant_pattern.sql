-- The shared flag detector can distinguish a contracting bull pennant.
alter table public.pattern_instances drop constraint if exists pattern_instances_pattern_type_check;
alter table public.pattern_instances add constraint pattern_instances_pattern_type_check check (pattern_type in (
  'ACCUMULATION_BASE', 'DOUBLE_BOTTOM', 'DOUBLE_TOP',
  'ASCENDING_TRIANGLE', 'DESCENDING_TRIANGLE', 'SYMMETRICAL_TRIANGLE',
  'BULL_FLAG', 'BULL_PENNANT', 'BEAR_FLAG', 'CANDLE_SUPPORT', 'PULLBACK_CONTINUATION'
));

-- Repair old UNKNOWN market regimes from stored VNINDEX bars, using only rows
-- available on or before each snapshot date. Breadth fields remain untouched.
with index_trends as (
  select prices.trading_date, prices.close,
    count(*) over w50 as sample50,
    avg(prices.close) over w20 as sma20,
    avg(prices.close) over w50 as sma50
  from public.market_index_prices prices
  join public.market_indices market on market.id = prices.index_id
  where market.code = 'VNINDEX'
  window w20 as (order by prices.trading_date rows between 19 preceding and current row),
         w50 as (order by prices.trading_date rows between 49 preceding and current row)
)
update public.market_breadth_snapshots breadth
set vnindex_trend_state = case
  when trends.close > trends.sma20 and trends.sma20 > trends.sma50 then 'UP'
  when trends.close < trends.sma20 and trends.sma20 < trends.sma50 then 'DOWN'
  else 'SIDEWAYS'
end
from index_trends trends
where breadth.trading_date = trends.trading_date
  and breadth.vnindex_trend_state = 'UNKNOWN'
  and trends.sample50 = 50;
