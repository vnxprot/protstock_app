-- One primary dispatch at 15:30 and exactly one Watchdog at 15:35 Vietnam.
create or replace function public.install_eod_watchdog_cron()
returns void language plpgsql security definer
set search_path = public, extensions, vault, pg_catalog
as $$
declare
  github_token text;
  slot record;
begin
  select decrypted_secret into github_token from vault.decrypted_secrets
  where name = 'github_eod_watchdog_token' limit 1;
  if coalesce(github_token,'') = '' then
    raise exception 'Missing Vault secret github_eod_watchdog_token';
  end if;
  perform cron.unschedule(jobid) from cron.job
  where jobname in ('protstock-eod-watchdog-1620','protstock-eod-watchdog-1650',
    'protstock-eod-watchdog-1535','protstock-eod-watchdog-1735','protstock-eod-watchdog-1905',
    'protstock-eod-primary-1530','protstock-vnstock-health-0800');
  for slot in select * from (values
    ('protstock-eod-primary-1530','30 8 * * 1-5','eod-fast.yml',true),
    ('protstock-eod-watchdog-1535','35 8 * * 1-5','eod-watchdog.yml',false),
    ('protstock-vnstock-health-0800','0 1 * * *','vnstock-health.yml',false)
  ) as slots(jobname,schedule,workflow,fast_lane)
  loop
    perform cron.schedule(slot.jobname,slot.schedule,format($job$
      select net.http_post(url := %L,
        headers := jsonb_build_object('Accept','application/vnd.github+json',
          'Authorization','Bearer ' || %L,'X-GitHub-Api-Version','2022-11-28'),
        body := %L::jsonb);
    $job$, 'https://api.github.com/repos/vnxprot/protstock_app/actions/workflows/' || slot.workflow || '/dispatches',
      github_token, case when slot.fast_lane then '{"ref":"main","inputs":{"skip_backtests":true}}'
                        else '{"ref":"main"}' end));
  end loop;
end;
$$;
revoke all on function public.install_eod_watchdog_cron() from public;
select public.install_eod_watchdog_cron();
