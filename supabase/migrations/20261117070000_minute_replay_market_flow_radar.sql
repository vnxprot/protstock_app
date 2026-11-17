insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('market-radar-minute-replay', 'market-radar-minute-replay', false, 32768, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy authenticated_read_market_radar_replay on storage.objects
  for select to authenticated using (bucket_id = 'market-radar-minute-replay');

create function public.market_radar_expired_replays(p_cutoff date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(name), '[]'::jsonb)
  from storage.objects
  where bucket_id = 'market-radar-minute-replay'
    and name ~ '^(HOSE|HNX|UPCOM)/[A-Z0-9]+/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json\.gz$'
    and left(split_part(name, '/', 3), 10) < to_char(p_cutoff, 'YYYY-MM-DD');
$$;

revoke all on function public.market_radar_expired_replays(date) from public, anon, authenticated;
grant execute on function public.market_radar_expired_replays(date) to service_role;
