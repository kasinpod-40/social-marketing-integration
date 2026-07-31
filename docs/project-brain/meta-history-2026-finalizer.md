# Project Brain — Meta History 2026 Finalizer

## Repository decision

The guarded implementation is merged through PR #319 at
`0ae80e3809cda0a582d8cfc0715313f8ac191a45`. Exact-head Meta End-to-End Verification #95 and Branch
Verification #1383 passed after alignment with the concurrent Report readiness recovery.

Repository work performed no Remote action. Live history execution remains a separate one-time Terminal
step.

## Data authority

The existing pinned Meta delivery remains authoritative. Its completed Facebook operation is verified and
never replayed or replaced. A separate deterministic Facebook July operation fills missing monthly
history through the existing Shared pipeline and Stable Business keys.

## History scope

```text
Facebook pinned    verify existing completion; no replay
Facebook July      2026-07-01..2026-07-31 supplemental operation
Instagram          2026-07-01..2026-07-31
Meta Ads required  2026-05-01..2026-07-31
Meta Ads optional  2026-01-01..2026-04-30 under bounded baseline volume
```

## Durable source behavior

- Facebook supplemental history uses existing bounded `since`/`until` reads and a new deterministic
  operation identity. Stable content keys make D1/Lark writes idempotent without deleting or replacing
  existing facts.
- Instagram media pagination remains newest-first and stops after crossing the lower date boundary.
- Meta Ads long ranges use an internal compound cursor while every Provider request remains at most 31
  inclusive days.
- Existing <=31-day Ads and unbounded Instagram source calls keep their prior contracts.

## Execution ownership

The only public entrypoint is:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

It owns exact clean-main validation, six ISO generation values, pinned-session verification, fresh identity
proof, D1/Lark chains, adaptive Ads expansion, checkpoint reuse, uncertain-admission blocking and
automatic all-false restore.

The one-command, finalizer, D1 and Lark launchers are implementation children. Operators must not invoke
them directly.

The implementation reuses existing phase operators and compatibility shims. No second Connector, Queue,
Reliability, D1 writer, Coverage engine or Lark sync engine is introduced.

## Final safe decision

Only accepted Terminal evidence can establish:

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook pinned completion       verified / no replay
Facebook July supplemental       complete
Instagram July                   complete
Meta Ads required                complete
D1/Lark parity                   pass
same-operation replay            pass
Worker flags                     all false
Active Work/Lock/Queue           0/0/0
Schedule                         disabled
Production                       blocked
```

Until that output exists, the authoritative status is `META_HISTORY_2026_EXECUTION_READY`, not Live
completed.
