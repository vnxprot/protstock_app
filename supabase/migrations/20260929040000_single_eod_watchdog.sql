-- One 15:35 ICT watchdog; retire both legacy watchdog schedules.
create or replace function public.install_eod_watchdog_cron()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, pg_catalog
as $$
declare
  github_token text;
  webhook_url constant text := 'https://api.github.com/repos/vnxprot/protstock_app/actions/workflows/eod-watchdog.yml/dispatches';
begin
  select decrypted_secret into github_token
  from vault.decrypted_secrets
  where name = 'github_eod_watchdog_token'
  limit 1;

  if coalesce(github_token, '') = '' then
    raise exception 'Missing Vault secret github_eod_watchdog_token';
  end if;

  perform cron.unschedule(jobid) from cron.job
  where jobname in ('protstock-eod-watchdog-1620', 'protstock-eod-watchdog-1650', 'protstock-eod-watchdog-1535');

  perform cron.schedule(
    'protstock-eod-watchdog-1535',
    '35 8 * * 1-5',
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
end;
$$;

revoke all on function public.install_eod_watchdog_cron() from public;
select public.install_eod_watchdog_cron();
