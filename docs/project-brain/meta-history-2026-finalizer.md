# Project Brain — Meta History 2026 Finalizer

## Repository decision

The guarded history implementation was merged through PR #319. Runtime-preflight recovery PR #330 was
then Squash Merged after exact-head Meta and Branch verification. The third Terminal attempt later stopped
before the first history operation because the finalizer required a historical local Meta
clone/session/overlay/finalizer bundle that was no longer present.

That local bundle is no longer an execution prerequisite. The durable continuity authority is now:

```text
fresh Facebook identity validation
+ exact current six-operation plan
+ valid read-only no-mutation evidence envelope
+ no legacy operation replay or replacement
+ one deterministic Facebook July supplemental operation
+ current D1/Lark parity and same-operation idempotency
+ final all-false Reliability state
```

Repository implementation and CI perform no Meta Provider request, Queue send, Remote D1/Lark Business
write, Worker deployment, Schedule activation or Production action. Live history execution remains a
separate one-time Terminal step after merge and handoff.

## Runtime-preflight authority

- The non-secret Wrangler source may be a readable regular file or a symlink resolving to one.
- The generated execution config is private `0600` with absolute Repository paths for `main` and
  `migrations_dir`.
- Active Queue execution requires a Queue attempt linked to active durable Work. A historical
  `sync_runs` status without active Work is not current Queue execution.
- Worker-flag verification is independent from Reliability-idle verification.
- Emergency Safe deployment is permitted only when the exact active-flag assertion proves a Worker
  execution flag is enabled. Other inspection errors never authorize deploy.

## Pinned continuity authority

The historical Meta delivery remains protected from replay or replacement, but its old local execution
files are not Business-data authority and are not required.

The current finalizer writes private evidence `pinned-facebook-continuity.json` bound to the exact current
Repository Head. It is accepted only when:

- the read-only Summary envelope has the expected contract, phase and status;
- the envelope proves `mutationPerformed=false`, `businessWrites=0` and `queueMessages=0`;
- fresh read-only validation contains exactly four current identity validations in the expected order;
- every identity has `status=identity_validated` and at least one request attempt;
- the current plan exactly matches all six expected target/range/mode/operation-ID tuples;
- exactly one required Facebook operation covers July 1–31, 2026;
- the new operation ID is derived from current Head, target and date range;
- no current operation uses the historical operation identity;
- `existingOperationReplay=false`;
- `replacementOperation=false`;
- `legacyLocalArtifactsRequired=false`.

The historical operation identity is retained only as a SHA-256 fingerprint in non-secret continuity
evidence. The accepted read-only evidence is also fingerprinted. The old clone, session, overlay and
finalizer are neither reconstructed nor executed.

## Data authority

Existing Facebook rows remain untouched. A separate deterministic Facebook July operation fills missing
monthly history through the existing Shared pipeline and Stable Business keys. Existing rows are upserted
or skipped idempotently; they are not deleted or replaced.

## History scope

```text
Facebook continuity  fresh identity + exact no-replay plan
Facebook July        2026-07-01..2026-07-31 supplemental operation
Instagram            2026-07-01..2026-07-31
Meta Ads required    2026-05-01..2026-07-31
Meta Ads optional    2026-01-01..2026-04-30 under bounded baseline volume
```

## Durable source behavior

- Facebook supplemental history uses existing bounded `since`/`until` reads and a new deterministic
  operation identity. Stable content keys make D1/Lark writes idempotent without deleting or replacing
  existing facts.
- Instagram media pagination remains newest-first and stops after crossing the lower date boundary.
- Meta Ads long ranges use an internal compound cursor while every Provider request remains at most 31
  inclusive days.
- Existing <=31-day Ads and unbounded Instagram source calls keep their prior contracts.
- Meta Lark completion reads the canonical summary field `larkParityVerified`; the stale alias
  `larkVerified` is not accepted.

## Parallel-main alignment

The continuity workstream is based directly on
`main@9d79e45676600831e1cc2fd7ca358a3176c55295`. It retains unchanged the Lark Dashboard scope/full-block
recovery and Chatwoot Queue topology normalization merged by concurrent workstreams. The Meta PR changes
only its seven scoped files.

## Execution ownership

The only public entrypoint is:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

It owns exact clean-main validation, six ISO generation values, fresh identity proof, pinned Facebook
continuity, D1/Lark chains, adaptive Ads expansion, checkpoint reuse, uncertain-admission blocking and
automatic all-false restore.

The one-command, finalizer, D1 and Lark launchers are implementation children. Operators must not invoke
them directly.

The implementation reuses existing phase operators and compatibility shims. No second Connector, Queue,
Reliability, D1 writer, Coverage engine or Lark sync engine is introduced.

## Final safe decision

Only accepted Terminal evidence can establish:

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook continuity             fresh identity / no old replay
Facebook July supplemental      complete
Instagram July                  complete
Meta Ads required               complete
D1/Lark parity                  pass
same-operation replay           pass
Worker flags                    all false
Active Work/Lock/Queue          0/0/0
Schedule                        disabled
Production                      blocked
```

Until that output exists, Live completion is not declared.
