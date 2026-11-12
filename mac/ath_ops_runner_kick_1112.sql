-- 2026-11-12 · Free fallback trigger for the GitHub runner lane.
-- The Mac's restricted login (role ath_worker) may ask ONE thing: how many runner jobs are waiting. It returns a number
-- only (no job contents). The Mac LaunchAgent com.ath.runner-kick uses it every 2 min and, when > 0, starts
-- `gh workflow run ath-runner.yml` with the Mac's existing gh login. No new token, no new secret.
create or replace function ath_ops.runner_waiting()
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from ath_ops.jobs q
  where q.lane = 'runner' and q.attempts < q.max_attempts
    and ((q.status = 'queued' and q.run_after <= pg_catalog.now()) or (q.status = 'running' and q.locked_until < pg_catalog.now()));
$$;
revoke all on function ath_ops.runner_waiting() from public;
grant execute on function ath_ops.runner_waiting() to ath_worker;
select 'runner_waiting ready' as status, ath_ops.runner_waiting() as waiting_now;
