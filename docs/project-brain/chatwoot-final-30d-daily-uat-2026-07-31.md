# Project Brain — Chatwoot Final 30-Day UAT + Daily Incremental

## Purpose

The merged Chatwoot durable runtime is completed by one separately reviewed Terminal closeout path. Repository defaults remain all false. The inner operator temporarily opens only the exact four Chatwoot ingestion/report flags, runs controlled Initial and Daily operations, then restores the Shared Worker to verified all-false state. A public launcher independently verifies the actual Shared Reliability lock scope before execution and after closeout.

## Locked source window

```text
Initial UAT                         exact rolling 30 days
Daily Incremental                  exact rolling 3 days
Anchor                             Stable Queue originalRequestedAt
Automatic expansion                false
Older-created updated Conversation included
Schedule                           disabled
Webhook                            disabled
Production                         blocked
```

## Reused Shared Core

```text
ChatwootDurableApiClient
→ existing normalizers
→ D1ChatwootAnalyticsStore
→ TableSyncEngine
→ data_coverage_runs / entities
→ D1ResumableWorkStore
→ D1IncrementalStateStore
→ runReliableSync / Lock
→ shared Queue / DLQ / System Alert
```

No replacement runtime, writer or reliability framework is introduced.

## One-command decision

The authoritative public command is plan-only unless it receives the exact confirmation:

```bash
CONFIRM_CHATWOOT_FINAL_UAT=EXECUTE_CHATWOOT_30D_DAILY_UAT \
node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute
```

The launcher delegates the reviewed action sequence to `scripts/chatwoot-final-30d-daily-uat.mjs`. It requires clean exact current `main`; detached HEAD is allowed when it equals `origin/main`. The command resolves the authenticated Cloudflare account, bearer session and exact main Queue, while secrets remain in `.dev.vars`/Wrangler Secret storage and are never persisted in evidence.

The launcher also removes the need for a manual ignored-config edit. It creates a private temporary config, supplies missing reviewed Chatwoot Safe flags, the locked 30-day/three-day contract and the reviewed 1,000/100,000 pagination bounds, removes the retired 48-hour overlap input, rebases local paths and deletes the temporary file afterward. Conflicting locked values fail closed.

The exact Shared Reliability lock authority is:

```text
integration_workspace:chatwoot:chemistry_k:%
```

The launcher requires zero active rows under this prefix before delegation and again after the inner operator has restored Safe state.

## Safety sequence

```text
exact Shared lock preflight
→ exact-head local gates
→ generated Safe/Active bundle dry-runs
→ Remote all-false / D1 / Queue / Cron / Lark read-only preflight
→ private D1 export
→ exact-four-flag Active deployment
→ Initial 30-day durable operation
→ D1/Lark parity
→ same-operation Initial replay
→ Daily three-day durable operation
→ D1/Lark parity
→ same-operation Daily replay
→ automatic all-false Safe deployment and verification
→ exact Shared lock closeout
```

Only one original Initial message and one original Daily message are admitted. Continuations are created by the Worker runtime and preserve Stable Queue identity. Replay sends the exact completed identity and must produce no Business, Coverage, cursor or Lark count drift.

## Evidence and interruption handling

Private evidence lives below:

```text
outputs/chatwoot-final-30d-daily-uat/<repository-head>/
```

Every stage is SHA-bound to Repository Head and session fingerprint. Deployment and Queue attempt records are persisted before the remote action. An uncertain Queue attempt is never blindly repeated; durable D1 identity must prove acceptance first.

After Active deployment ownership, the inner operator attempts Safe restore in `finally`. It restores only when the current version is still the reviewed baseline or the operator-owned Active version. Concurrent version drift blocks overwrite and requires review.

## Completion authority

Final success requires the last launcher result to contain:

```text
marker                 CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
exactLockScopeVerified true
activeLockCount        0
```

This proves:

- exact Initial 30-day completion and checkpoint;
- exact Daily three-day completion and one cursor advance;
- bounded multi-unit execution;
- zero failed Coverage rows, Chatwoot DLQ records and open Chatwoot alerts;
- exact D1/Lark parity across 15 targets;
- idempotent Initial and Daily same-operation replay;
- zero true execution flags after Safe restore;
- zero active exact Chatwoot Shared Reliability locks;
- Schedule, Webhook and Production remain disabled.

## Current implementation record

```text
Base main          = 95fe279d6ef46978d95acb1611ec859ae35cba64
Branch             = integration/chatwoot-final-30d-daily-uat
Draft PR           = #311
Code verified head = 3431760f769308cf52c0568e7cf4f6236213751e
Code CI            = #1335 / 30602618460 / PASS
Docs closeout CI   = required on final exact Head
Remote actions     = 0 during Repository implementation
```
