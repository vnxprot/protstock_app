-- Dispatch two later checks when the first vendor EOD snapshot is unavailable.
create or replace function public.install_eod_watchdog_cron()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, pg_catalog
as $$
declare
  github_token text;
  webhook_url constant text := 'https://api.github.com/repos/vnxprot/protstock_app/actions/workflows/eod-watchdog.yml/dispatches';
  slot record;
begin
  select decrypted_secret into github_token
  from vault.decrypted_secrets
  where name = 'github_eod_watchdog_token'
  limit 1;

  if coalesce(github_token, '') = '' then
    raise exception 'Missing Vault secret github_eod_watchdog_token';
  end if;

  perform cron.unschedule(jobid) from cron.job
  where jobname in ('protstock-eod-watchdog-1620', 'protstock-eod-watchdog-1650',
                    'protstock-eod-watchdog-1535', 'protstock-eod-watchdog-1735',
                    'protstock-eod-watchdog-1905');

  for slot in
    select * from (values
      ('protstock-eod-watchdog-1535', '35 8 * * 1-5'),
      ('protstock-eod-watchdog-1735', '35 10 * * 1-5'),
      ('protstock-eod-watchdog-1905', '5 12 * * 1-5')
    ) as slots(jobname, schedule)
  loop
    perform cron.schedule(
      slot.jobname,
      slot.schedule,
      format($job$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Accept', 'application/vnd.github+json',
            'Authorization', 'Bearer ' || %L,
            'X-GitHub-Api-Version', '2022-11-28'
          ),
          body := jsonb_build_object('ref', 'main')
        );
      $job$, webhook_url, github_token)
    );
  end loop;
end;
$$;

revoke all on function public.install_eod_watchdog_cron() from public;
select public.install_eod_watchdog_cron();
