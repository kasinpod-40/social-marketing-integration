# Project Brain — Meta History 2026 Finalizer

## Repository decision

The guarded history implementation was merged through PR #319. Runtime-preflight recovery PR #330 was
then Squash Merged at `f88cc46e33889386bc4593c118e28681e6c86ff1` after exact-head Meta End-to-End
Verification #98 and Branch Verification #1390 passed.

Repository implementation, hotfix and CI performed no Meta Provider request, Queue send, Remote D1/Lark
Business write, Worker deployment, Schedule activation or Production action. Live history execution
remains a separate one-time Terminal step.

## Runtime-preflight authority

- The non-secret Wrangler source may be a readable regular file or a symlink resolving to one.
- The generated execution config is private `0600` with absolute Repository paths for `main` and
  `migrations_dir`.
- Active Queue execution requires a Queue attempt linked to active durable Work. A historical
  `sync_runs` status without active Work is not current Queue execution.
- Worker-flag verification is independent from Reliability-idle verification.
- Emergency Safe deployment is permitted only when the exact active-flag assertion proves a Worker
  execution flag is enabled. Other inspection errors never authorize deploy.

The previous two Terminal attempts stopped before the first Meta operation. Existing runtime evidence and
historical Reliability rows remain retained; they are not deleted or directly edited.

## Data authority

The existing pinned Meta delivery remains authoritative. Its completed Facebook operation is verified and
never replayed or replaced. A separate deterministic Facebook July operation fills missing monthly history
through the existing Shared pipeline and Stable Business keys.

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
