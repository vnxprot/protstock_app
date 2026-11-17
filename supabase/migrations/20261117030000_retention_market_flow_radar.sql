create table public.market_radar_source_status (
  trading_date date not null,
  exchange text not null check (exchange in ('HOSE', 'HNX', 'UPCOM')),
  category text not null check (category in ('foreign', 'proprietary')),
  status text not null check (status in ('ready', 'failed')),
  primary key (trading_date, exchange, category)
);
alter table public.market_radar_source_status enable row level security;
revoke all on public.market_radar_source_status from public, anon, authenticated;
grant select on public.market_radar_source_status to authenticated;
grant all on public.market_radar_source_status to service_role;
create policy authenticated_read_market_radar_source_status on public.market_radar_source_status
  for select to authenticated using (true);

create function public.market_radar_storage(p_prune boolean default false)
returns bigint language plpgsql set search_path = public as $$
declare
  tape_start date;
  report_start date;
begin
  if p_prune then
    select min(trading_date) filter (where session_rank <= 20), min(trading_date)
      into tape_start, report_start
    from (
      select ip.trading_date, row_number() over (order by ip.trading_date desc) as session_rank
      from market_index_prices ip join market_indices i on i.id = ip.index_id and i.code = 'VNINDEX'
      order by ip.trading_date desc limit 50
    ) dates;
    delete from market_radar_daily where trading_date < tape_start and category in ('large', 'medium', 'small');
    delete from market_radar_daily where trading_date < report_start and category in ('foreign', 'proprietary');
    delete from market_radar_publications where trading_date < report_start;
    delete from market_radar_source_status where trading_date < report_start;
  end if;
  return pg_database_size(current_database());
end;
$$;
revoke all on function public.market_radar_storage(boolean) from public, anon, authenticated;
grant execute on function public.market_radar_storage(boolean) to service_role;
