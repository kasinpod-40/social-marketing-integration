# Project Brain — Meta History 2026 Finalizer

## Repository decision

The Meta history execution chain is merged and ready for one controlled Terminal run:

```text
Initial history implementation   PR #319 / Squash Merged
Runtime-preflight recovery       PR #330 / Squash Merged
Pinned-continuity recovery       PR #342 / Squash Merged
Current continuity main SHA      ce59437dbb9e9325f743805af0f67ce5cf192c04
Meta verification                #105 / PASS
Branch verification              #1412 / PASS
Live history completion          pending Terminal evidence
```

PR #342 removed the historical local clone/session/overlay/finalizer bundle from the execution contract.
Those files are not durable Business-data authority and are no longer searched, reconstructed or run.

Repository implementation and CI performed no Meta Provider request, Queue send, Remote D1/Lark Business
write, Worker deployment, Schedule activation or Production action.

## Runtime-preflight authority

- The non-secret Wrangler source may be a readable regular file or a symlink resolving to one.
- The generated execution config is private `0600` with absolute Repository paths for `main` and
  `migrations_dir`.
- Active Queue execution requires a Queue attempt linked to active durable Work. Historical `sync_runs`
  rows without active Work are not current Queue execution.
- Worker-flag verification is independent from Reliability-idle verification.
- Emergency Safe deployment is permitted only when the exact active-flag assertion proves a Worker
  execution flag is enabled. Other inspection errors never authorize deploy.

## Pinned continuity authority

The historical Meta delivery remains protected from replay or replacement through current, Head-bound
evidence rather than old local files.

The finalizer writes private `pinned-facebook-continuity.json`. It is accepted only when:

- the read-only Summary has the expected contract, phase and `status=passed`;
- `mutationPerformed=false`, `businessWrites=0` and `queueMessages=0`;
- exactly four validations occur in order: Facebook, Instagram, `chemistry_k2`, `chemistry_k3`;
- every identity has `status=identity_validated` and at least one request attempt;
- all six expected target/range/mode/deterministic-operation-ID tuples match the current Head;
- exactly one required Facebook operation covers July 1–31, 2026;
- no current operation uses the historical operation identity;
- `existingOperationReplay=false`;
- `replacementOperation=false`;
- `legacyLocalArtifactsRequired=false`.

The historical operation identity is retained only as a SHA-256 fingerprint. The accepted read-only
evidence is fingerprinted separately. The old finalizer is never executed.

## Data authority

Existing Facebook and Lark rows remain authoritative. A separate deterministic Facebook July operation
fills missing monthly history through the existing Shared pipeline and Stable Business keys. Existing
facts are upserted or skipped idempotently; they are not deleted or replaced.

## History scope

```text
Facebook continuity  fresh identity + exact no-replay plan
Facebook July        2026-07-01..2026-07-31 supplemental operation
Instagram            2026-07-01..2026-07-31
Meta Ads required    2026-05-01..2026-07-31
Meta Ads optional    2026-01-01..2026-04-30 under bounded baseline volume
```

## Durable source behavior

- Facebook supplemental history uses bounded `since`/`until` reads and a deterministic current operation.
- Instagram pagination remains newest-first and stops after crossing the lower date boundary.
- Meta Ads long ranges use an internal compound cursor while each Provider request remains at most 31
  inclusive days.
- Existing <=31-day Ads and unbounded Instagram source calls keep their prior contracts.
- Meta Lark completion reads canonical `larkParityVerified`; stale `larkVerified` is rejected.

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

Until that output exists, the authoritative state is `META_HISTORY_2026_EXECUTION_READY`, not Live
completed.
