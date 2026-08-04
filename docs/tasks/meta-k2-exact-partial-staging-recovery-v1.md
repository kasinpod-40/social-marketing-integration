# Meta K2 Exact Partial-Staging Recovery v1

## Status

```text
IMPLEMENTATION_STATUS                 = REVIEWED_IMPLEMENTED
LIVE_STATUS                           = RECOVERY_PENDING_AFTER_VERIFIED_SAFE_RESTORE
TARGET                                = chemistry_k2
PERIOD                                = 2026-07-01..2026-07-31
PRODUCTION                            = BLOCKED
SCHEDULE                              = DISABLED
QUEUE_SEND_DURING_RECOVERY            = 0_REQUIRED
LIFECYCLE_SQL_REPAIR                  = FORBIDDEN
PROVIDER_REPLAY                       = FORBIDDEN_UNLESS_EXPLICITLY_PROVEN_REQUIRED
```

This contract continues the already accepted Chemistry K2 Meta Ads operation from its exact durable
partial-staging checkpoint. It does not create a replacement operation, send another Cloudflare Queue
message, repair lifecycle state with SQL, or fabricate completion.

## Exact operation identity

```text
operationId
meta-chemistry_k2-history-20260701-20260731-f741090d1d8a

workKey
meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a

syncRunId
meta:meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a

sourceAccountKey
chemistry_k2

period
2026-07-01..2026-07-31
```

The immutable older forensic operation remains excluded from every recovery path:

```text
meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba
```

## Retained exact checkpoint

Recovery admission requires two read-only snapshots at least 30 seconds apart and the following state to
remain identical:

```text
sync_run_status           = running/success only in the bounded form allowed by this contract
work_status               = active
work_lifecycle_status     = active
records_written           = 0
stage                     = daily
unitCount                 = 27
rowCount                  = 2601
pageNumber                = 27
contentIndex               = 0
queue_operation_attempts  = 1
main_queue_attempts       = 29
active_lock_count         = 0
D1 phase                  = not started
Coverage                  = 0
Lark phase                = 0
Completion phase          = 0
idle                      >= 16 minutes
```

The exact recovery confirmation is:

```text
MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY=RECOVER_EXACT_PARTIAL_META_ADS_STAGING
```

## Reused architecture

The implementation reuses the existing components without adding another pipeline or reliability engine:

- `processMetaEndToEndSync` and `processMetaEndToEndGeneration`;
- existing Meta Graph client and Meta Ads adapter;
- existing resumable work store and durable phase checkpoints;
- existing D1 writers, Coverage, reconciliation and `TableSyncEngine`;
- existing Worker deployment/all-false verification helpers;
- existing D1 and Lark snapshot classifiers.

The recovery route invokes the existing Meta Queue use-case directly with a local, identity-validating Queue
stub. Continuation requests that the use-case would normally enqueue are suppressed only after verifying the
same operation ID, work key, generation and source account. Therefore the recovery does not create a new
Cloudflare Queue delivery or `queue_operation_attempt` row.

## Reviewed continuation route

```text
POST /operator/meta/d1-only-partial-staging-continuation
```

The route is unavailable unless all of these are true:

- the exact recovery mode is enabled;
- an ephemeral bearer token matches its SHA-256 digest;
- the response attestation is bound to the reviewed deployment;
- the exact operation, work key, sync run, account and period match;
- the Worker has exactly the approved execution flags for the selected phase;
- no unexpected enabled flag is present.

### D1 window

Only these execution flags may be true:

```text
MKT_CONNECTOR_META_ADS_ENABLED
MKT_META_SOURCE_READ_ENABLED
MKT_META_D1_WRITE_ENABLED
```

The existing use-case resumes source staging from the durable `daily` checkpoint, completes source staging,
then performs D1 entity/daily writes and Coverage. Lark, Report, Schedule and Production remain disabled.

### Lark window

Only these execution flags may be true:

```text
MKT_CONNECTOR_META_ADS_ENABLED
MKT_META_SOURCE_READ_ENABLED
MKT_META_D1_WRITE_ENABLED
MKT_META_LARK_WRITE_ENABLED
```

The Lark projection for Meta Ads is restricted to:

```text
mktAdsAccounts
mktAdsCampaigns
mktAdsAdGroups
mktAdsAds
```

Detailed RAW Ads rows, Creative inventory and `mktAdsDaily` are not mirrored to Lark. July daily detail and
July activity entities remain durable in D1.

## Reviewed launcher and runtime authority

The reviewed launcher is:

```text
scripts/meta-k2-partial-staging-reviewed-launcher.mjs
```

It reads the private `.dev.vars`, materializes the two required non-secret Meta source mappings, forces the
complete shared execution-flag set to all-false in a private temporary Wrangler config, and makes `main` and
`migrations_dir` absolute.

The launcher does not trust a guessed Worker hostname. It resolves one Worker origin from all available
runtime authority inputs and requires them to agree:

```text
MKT_CONNECTION_PUBLIC_ORIGIN
MKT_GOOGLE_ADS_REDIRECT_URI
MKT_YOUTUBE_REDIRECT_URI
MKT_META_K2_EXACT_RECOVERY_URL (optional exact override)
```

Before archiving evidence or deploying an active window, it sends a no-Business POST probe to the exact
route while the Worker is all-false. The probe is accepted only when the response proves the exact recovery
handler, zero direct use-case invocation, zero Queue mutation and zero Business mutation. Generic 404,
redirects, conflicting origins and unknown endpoints fail closed.

## Reviewed retry classes

### Pre-activation no-mutation failure

```text
MKT_META_K2_PREACTIVATION_RETRY=ARCHIVE_AND_RETRY_EXACT_PREACTIVATION_FAILURE
```

The root may be archived only when it contains the exact retained-admission, stability and non-empty backup
footprint and proves zero active deployment, zero continuation call and zero mutation.

### Post-activation no-Business failure

```text
MKT_META_K2_POST_ACTIVATION_RETRY=ARCHIVE_AND_RETRY_EXACT_POST_ACTIVATION_NO_BUSINESS_FAILURE
```

This class covers the retained HTTP 404 incident where the D1 active window deployed but the direct endpoint
call was not accepted, followed by a verified emergency all-false restore. Before archiving this footprint,
the launcher additionally verifies:

- the current Worker has no true execution flags;
- the exact D1 checkpoint remains `daily / 27 / 2601 / page 27 / content 0`;
- D1 Business and Coverage counts remain zero;
- Queue attempts remain `1 / 29`;
- one active D1 deployment and one safe restore are hash-linked in evidence;
- the current Worker origin passes the exact safe-route probe;
- no direct use-case invocation was accepted.

All prior evidence and backup SQL files are renamed to timestamped archives, never deleted.

## Finalizer phases

1. Verify the exact clean reviewed branch/head and retained operation ancestry.
2. Verify exact-head CI attestation.
3. Read and hash-validate retained Queue acceptance and all-false restore evidence.
4. Run local focused/full gates before remote mutation.
5. Verify current Worker all-false and unrelated Reliability idle.
6. Validate the exact stable partial checkpoint twice.
7. Export a remote D1 backup.
8. Deploy the exact D1 continuation window.
9. Call one bounded direct use-case invocation at a time until D1/Coverage completion.
10. Verify Queue attempts remain exactly `1 / 29` and D1 parity is complete.
11. Call the same operation once more and verify zero Business/Coverage drift.
12. Restore and verify Worker all-false.
13. Perform GET-only Lark table/field preflight for the four allowed tables.
14. Deploy the exact Lark continuation window.
15. Call one bounded direct use-case invocation at a time until Lark/completion reconciliation completes.
16. Verify exact four-table D1/Lark parity and zero Queue/D1/Coverage drift.
17. Call the same operation once more and verify durable idempotency.
18. Restore and verify Worker all-false.
19. Verify active work, locks and active Queue operations are zero, excluding only the allowed forensic row.
20. Write the hash-linked summary and terminal marker.

## Required terminal result

```text
META_HISTORY_2026_TARGET_COMPLETED_SAFE
```

The marker is valid only when the evidence proves:

```text
accepted                    = true
target                      = chemistry_k2
period                      = 2026-07-01..2026-07-31
d1Completed                 = true
larkCompleted               = true
idempotentRerunVerified     = true
executionFlagsAllFalse      = true
activeWork                  = 0, excluding the explicitly allowed forensic row
activeLocks                 = 0
activeQueueOperations       = 0
queueMessageCount           = 0
lifecycleSqlRepairCount     = 0
scheduleEnabled             = false
production                  = false
```

## Regression coverage

The implementation includes regressions for:

- the exact `daily / 27 / 2601 / page 27 / content 0` checkpoint;
- the stale orphaned state with no lock or writes;
- the 30-second stability and 16-minute idle gates;
- exact operation/work/sync-run/account/period binding;
- epoch numeric-string and ISO timestamp handling;
- D1 and Lark continuation without Cloudflare Queue delivery;
- Queue attempt counts remaining unchanged;
- D1 writes starting only after source staging completion;
- D1/Coverage and Lark idempotency without count drift;
- all-false execution flag enforcement;
- Meta Ads Lark projection limited to Account/Campaign/AdSet/Ad;
- retained evidence hash linkage and reviewed-head ancestry;
- generated private Wrangler path rebasing and cleanup;
- exact Worker-origin consensus across public origin and OAuth callback URIs;
- safe-handler probing that rejects generic HTTP 404 and redirects;
- exact post-activation/no-Business retry after verified emergency restore;
- blocking retry when Worker flags, D1 counts, Coverage or Queue checkpoint drift.

## Verification gates

Before live execution, the exact final Head must pass:

```bash
npm ci
npm run check
node --test \
  tests/application/meta-d1-only-rollout-operator.test.js \
  tests/application/meta-d1-only-partial-staging-recovery.test.js \
  tests/application/meta-k2-partial-staging-running.test.js \
  tests/application/meta-d1-only-partial-staging-recovery-http.test.js \
  tests/application/meta-ads-lark-scope.test.js \
  tests/application/meta-k2-partial-staging-finalizer.test.js \
  tests/application/meta-k2-partial-staging-reviewed-launcher.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Both GitHub workflows must conclude `success` on that same Head:

```text
Meta End-to-End Verification
Branch Verification
```

## Failure behavior

Any identity drift, origin conflict, unknown route, generic 404, unsafe Worker flag, checkpoint/count drift,
active lock, Queue attempt increase, Lark scope expansion, attestation mismatch, incomplete parity or evidence
hash failure stops the operation fail-closed. After an activated window, the finalizer attempts safe all-false
restore and verifies the active Worker version. It never authorizes a blind resend, replacement operation,
lifecycle SQL repair, Schedule activation or Production execution.
