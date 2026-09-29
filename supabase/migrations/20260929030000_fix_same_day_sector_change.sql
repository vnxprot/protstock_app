-- A same-day universe correction must replace that day's sector record,
-- not close it at yesterday (which violates valid_to >= valid_from).
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
    on conflict (symbol_id, valid_from) do update
      set sector = excluded.sector, valid_to = null;
  elsif new.sector is distinct from old.sector then
    update public.symbol_sector_history
       set valid_to = current_date - 1
     where symbol_id = new.id and valid_to is null and valid_from < current_date;

    insert into public.symbol_sector_history (symbol_id, sector, valid_from)
    values (new.id, new.sector, current_date)
    on conflict (symbol_id, valid_from) do update
      set sector = excluded.sector, valid_to = null;
  end if;
  return new;
end;
$$;
