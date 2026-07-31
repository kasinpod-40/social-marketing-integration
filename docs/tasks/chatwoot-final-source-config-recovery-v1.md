# Chatwoot Final Source Config Recovery v1

## Incident

The guarded Chatwoot Final 30-day Initial + three-day Daily UAT on
`main@f93dcca29c5770b74a3dc6e41f2aac3489ebc8d1` passed local gates, Remote read-only admission,
a fresh D1 backup and temporary exact-four-flag Active deployment. The first Initial Queue message was
accepted once, then the Worker classified the job as a Permanent runtime-config failure before creating Work,
Sync, Coverage or Business rows:

```text
operation_id        chatwoot-initial-30d-1785526770359-f93dcca29c57
main Queue attempts 1
terminal DLQ rows   1 / open
system alerts       1 / critical / open
error_code          CHATWOOT_RUNTIME_CONFIG_INVALID
error_message       CHATWOOT_BASE_URL is required
Sync / Work / Phase 0 / 0 / 0
Coverage             0
Chatwoot Business    0
Provider requests    0
Lark writes          0
```

Automatic Safe restore completed and the retained evidence confirms all execution flags false, Schedule false,
Webhook false and Production blocked.

## Root cause

The public Final UAT launcher read the private `.dev.vars`, but its generated Wrangler config materialized only
Lark mappings, Chatwoot execution flags, window contract and pagination limits. The deployed Worker therefore did
not receive the non-secret Provider identity values required when the Connector gate became true:

```text
CHATWOOT_BASE_URL
CHATWOOT_ACCOUNT_ID
```

The runtime requires both fields before it reads the existing `CHATWOOT_API_ACCESS_TOKEN` Worker Secret. Fixing
only the URL would move the same Permanent failure to the missing Account ID.

## Repository correction

The recovery path:

1. requires clean exact current `main` and exact confirmation;
2. reads the approved source identity only from private `.dev.vars`/Environment;
3. validates a non-placeholder credential-free HTTPS origin and positive Account ID;
4. materializes both non-secret fields into one private mode-0600 generated Wrangler config;
5. never edits `.dev.vars` or `wrangler.sync.jsonc` and never persists or prints the raw identity;
6. delegates Secret staging, Lark table discovery, Queue discovery and the complete UAT to the existing reviewed launcher;
7. creates a new Head-bound Initial/Daily identity rather than redriving the failed message;
8. binds the current UAT evidence directory to the exact Repository Head and supports verification/closure-only resume when its accepted summary already exists;
9. requires accepted Initial, replay, Daily, replay, D1/Lark parity, all-false restore and zero exact lock;
10. creates a fresh D1 backup, then resolves only the pinned old `dead_letter_jobs`,
    `dead_letter_operation_metadata` and `system_alerts` records;
11. records and validates one exact affected row from each of the three closure statements;
12. accepts only exact same-reference partial closure state after an interruption and resumes without another Queue send;
13. rejects any conflicting recovery/audit reference or old Work/Sync/Coverage/Lock activity;
14. verifies the all-false Worker version remains unchanged throughout closure;
15. never deletes or redrives a Queue message and never changes old Queue-attempt identity;
16. proves the current UAT Initial/Daily snapshots are unchanged across incident closure.

The existing Worker Secret contract remains `CHATWOOT_API_ACCESS_TOKEN`. No Token value is copied into Wrangler
vars, evidence, command arguments or Repository source.

## Exact retained incident

```text
operation_id  chatwoot-initial-30d-1785526770359-f93dcca29c57
work_key      chatwoot:chemistry_k:chatwoot-initial-30d-1785526770359-f93dcca29c57
requested_at  1785526770359
message_id    712733dca2f55d0f39698d87d33b3d56
dlq_id        terminal:712733dca2f55d0f39698d87d33b3d56
alert_id      alert:terminal:712733dca2f55d0f39698d87d33b3d56
```

Before a new UAT, this identity must remain exactly one Queue attempt, one open Terminal DLQ, one open critical
Chatwoot alert, zero exact old Sync/Work/Phase/Coverage, zero active exact lock and zero Chatwoot Business rows.
After a successful new UAT, Business rows may exist but the exact old operational identity must remain unchanged
until completion-only closure.

A command interruption during the three-record closure may leave an exact subset already resolved. A later run is
allowed to continue only when every immutable incident field still matches and every non-null recovery/audit
reference equals the current recovery Head. A resolved incident without the current-head accepted UAT summary is
rejected.

## Public command after Review and Merge

```bash
CONFIRM_CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY=\
RECOVER_CHATWOOT_SOURCE_CONFIG_AND_COMPLETE_UAT \
node scripts/chatwoot-final-source-config-recovery-launcher.mjs --execute
```

Do not run the original Final UAT launcher, manually redrive the DLQ, close the Alert or edit Remote D1 before
this recovery command is reviewed and merged.

## Accepted final result

```text
marker                         CHATWOOT_SOURCE_CONFIG_RECOVERY_COMPLETED_SAFE
innerMarker                    CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
sourceIdentityVerified         true
initial30DayVerified           true
initialReplayVerified          true
daily3DayVerified              true
dailyReplayVerified            true
retainedIncidentResolved       true
closureMutationCount           3 on first closure / 0 on resolved verification-only resume
currentUatSnapshotDrift        false
restoredAllFlagsFalse          true
safeVersionStableAcrossClosure true
exactLockScopeVerified         true
activeLockCount                0
queueRedrive                   false
scheduleEnabled                false
webhookEnabled                 false
production                     false
```

Live completion must not be declared until the exact post-merge Terminal output contains both accepted markers
and all final safety fields.

## Implementation safety

Repository implementation and CI perform no Provider request, Queue/DLQ send or redrive, Remote D1 read/write,
Lark request/write, Worker deployment, Secret mutation, Schedule/Webhook activation or Production action.
`docs/current-task.md` remains unchanged because the concurrent Meta workstream owns it.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-final-source-config-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```
