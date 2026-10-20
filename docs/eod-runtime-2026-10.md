# EOD runtime recovery, 20 October 2026

- Supabase dispatches Fast Lane at 15:30 Vietnam on weekdays. GitHub's 15:30
  schedule is a delayed fallback. The shared `protstock-eod` concurrency group
  and publication/heartbeat preflight prevent duplicate processing.
- Exactly one Watchdog is dispatched by Supabase at 15:35. It starts absent or
  failed work; it leaves active work alone. There are no later Watchdog schedules.
- A lightweight source-health workflow runs at 08:00, with a GitHub backup.
  It discovers stable generation 5 releases from the official package index,
  probes real VCI stock/index data and compares stored VCI overlap before approval.
  Approval and health manifests are private Storage objects. Changed health,
  recovery, release or expiry states notify the existing owner Telegram channel.
- The ingest runner verifies an approved release, tries approved standby releases, and
  can validate a new candidate if all approved releases have stopped working.
  Both parallel lots share that exact release on one runner, avoiding concurrent
  device registrations on two hosted runners. The official SDK authenticates with
  the repository `VNSTOCK_API_KEY` secret before any source probe or VCI ingest.
  Device/account restrictions remain enforced by vnstock. Neither
  a new SDK version nor a VCI outage silently changes the persisted price vendor.
- AUTO preserves each symbol's existing vendor (VCI for new series). Legacy
  client-version-derived revision hashes are normalized on read. Actual vendor
  or adjustment-basis changes still require coherent history validation.
- Routine ingest writes changed overlap bars only, and reuses merged in-memory
  history instead of reading the full series twice. Each shard makes at most one
  additional pass for missing sessions/transient errors; permanent basis errors
  remain visible. Personal backtests run in their separate queue workflow.
- Finalize reuses same-run calculations; it skips repeated publication only when
  no new successful ingest followed the prior publication and coverage is unchanged.
  Incomplete final coverage produces a failed workflow, with PARTIAL data retained.
- An explicit `repair_missing=true` bypasses the exhausted automatic attempt budget
  while keeping missing-only selection and active-job protection. The capacity
  workflow sets it when dispatching the 19 October repair.

Source probes validate the interface and representative data, not every possible
future vendor correction. A version that changes the checked price basis is held
for review. If every supported source path fails, the workflow reports failure and
keeps the latest valid publication rather than manufacturing current-session bars.

- Source-health shares the EOD concurrency group. Every attempted Fast Lane has
  an independent operational Telegram report, including setup failures; skipping
  trading alerts during repairs does not disable failure reports. Worker logs
  show each symbol as it starts. Failed source setup blocks publication.
