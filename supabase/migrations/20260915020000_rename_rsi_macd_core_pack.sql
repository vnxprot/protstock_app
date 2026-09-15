-- A display-name normalization only: preserve the same rule, versions and audit history.
update public.rules
set name = 'Prot Core Pack · RSI MACD Divergence', updated_at = now()
where name = 'Prot Core Pack · Phân kỳ RSI + xác nhận MACD';
