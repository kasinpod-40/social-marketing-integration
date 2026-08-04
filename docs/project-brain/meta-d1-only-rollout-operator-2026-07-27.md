# Meta D1-only Rollout Operator — 2026-07-27

## Repository state

```text
BRANCH                              = integration/meta-d1-only-rollout-operator
DRAFT_PR                            = #114
BASE_MAIN_SHA                       = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
VERIFIED_IMPLEMENTATION_HEAD        = e667a1b9141a8a472157ed94d693ab0b50be90b2
CONTRACT                            = meta-d1-only-rollout-v1
META_READ_ONLY_PROVIDER_VALIDATION  = PASS / 4 TARGETS
REPOSITORY_IMPLEMENTATION           = PASS
REMOTE_EXECUTION                    = NOT_RUN
REMOTE_MUTATION                     = NONE
PRODUCTION                          = BLOCKED
```

## Why this operator exists

Chemistry K Meta identity and permission validation passed for Facebook, Instagram and both Meta Ads
accounts using GET-only Provider calls. The next approved architecture boundary is D1-only
processing, but the Repository previously had no rollout operator that bound Backup, deployment
provenance, exact Queue operation, D1/Coverage reconciliation, idempotent rerun and safe restore.

The existing Meta Runtime already supports `d1Only=true`. This branch adds guarded orchestration
around that existing path rather than creating another Connector or write engine.

## Target isolation

One chain selects exactly one target:

```text
facebook
instagram
chemistry_k2
chemistry_k3
```

Every target has its own operationId, generation, workKey, syncRunId, backup and Evidence root.
Meta Ads aliases remain exact and cannot be inferred or mixed.

## Runtime reuse

The operator reuses:

- protected manual Meta Job Catalog entries;
- Shared stable Queue operation helpers;
- Meta active job router and exact source mapping;
- Shared Queue continuation ownership;
- Reliability runner, D1 lock and sync-run contracts;
- resumable source/D1 phases;
- Organic History Writer and Marketing History Store;
- Storage Foundation D1 and Coverage tables

No new migration is added. Chatwoot Migration `0018` remains unrelated and this operator does not
apply it.

## Approved execution window

Safe baseline requires every MKT execution flag false. Active D1-only deployment enables exactly:

```text
selected connector flag
MKT_META_SOURCE_READ_ENABLED
MKT_META_D1_WRITE_ENABLED
```

Lark, Report, Schedules, unrelated Connectors, DLQ redrive, retention and Production remain false.
The Active config is derived temporarily from the reviewed Safe config and is removed after each
Wrangler command.

## D1-only completion semantics

The existing Meta processor writes D1 and Coverage before checking the Lark gate. With Lark false it
returns at `lark_gate_disabled`. Therefore accepted evidence requires:

```text
sync run success
D1 phase complete
valid Coverage / failed_rows=0
no Lark phase
no full-completion phase
no active lock
active unfinished Work boundary
```

The unfinished Work is intentional. It preserves the later separately approved Lark continuation
boundary and must not be mislabeled as failed D1 processing.

## Idempotency proof

After the first D1-only operation reaches the accepted boundary, the operator permits one explicit
same-operation Queue send. Verification requires an additional Queue attempt with zero drift across
target Business counts, operation-scoped Business counts and Coverage counts.

## Safety and evidence

- every executable phase has an exact confirmation;
- read-only validation summary SHA is part of the target fingerprint;
- evidence is SHA-256 chained and tamper checked;
- Queue attempt records are written before send;
- D1 backup is required before deployment/send;
- Active deployment has a guarded all-false restore;
- Tokens, Authorization headers, secret values, raw config and raw Provider payloads are excluded;
- implementation performs no Remote action

## Verification result

An initial test run found a test-contract defect where an already normalized D1 snapshot was
normalized again before classification. The normalizer was made idempotent; no Runtime or Business
contract was changed. Both exact-head workflows then passed:

```text
META_END_TO_END_VERIFICATION        = #31 / 30284509274 / PASS
BRANCH_VERIFICATION                 = #670 / 30284508692 / PASS
FOCUSED_META_D1_ONLY_TESTS          = 15 / 15 PASS
NODE_UNIT_INTEGRATION               = 1075 / 1075 PASS
WORKERS_RUNTIME                     = 11 / 11 PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
DEPENDENCY_AUDIT                    = 0 vulnerabilities
WRANGLER_DRY_RUN                    = PASS / NO DEPLOYMENT
VERIFICATION_ARTIFACT               = 8660233416
VERIFICATION_ARTIFACT_DIGEST        = sha256:ddfd07495533887a07f83cf9e0e39eb5415bc038c1ee070a3b413f0d04eaa237
REMOTE_ACTION_COUNT                 = 0
```

## Remaining gates

1. review Draft PR #114 and merge separately;
2. refresh exact `main`, active Worker version, D1 migration ledger and Queue topology;
3. separately approve one target's plan/preflight;
4. separately approve Backup and Safe deployment;
5. separately approve one D1-only active window and same-operation rerun;
6. restore all false;
7. repeat with a fresh chain for the next target;
8. after all four targets pass, open a separate Lark parity task

This document authorizes none of the Remote phases above.

## Meta Ads long-staging continuation — 2026-08-02

Live `chemistry_k2` source staging proved that one bounded Provider unit per Queue invocation can outlive
the original fixed controller window. The exact operation advanced to 66 units / 6,406 rows at Ads page 22,
but the controller restored all-false before the source phase completed. The following continuation was then
correctly rejected with disabled execution gates; D1/Coverage/Lark Business rows remained zero.

The operator now records only sanitized source/D1 progress metadata and supports an explicit Meta Ads
partial-staging recovery mode. Eligibility requires stale and stable zero-write durable state for the same
operation. Verification may extend beyond its base window only while exact source/D1/Sync/Queue activity is
fresh, under an explicit hard poll cap. Terminal errors, stale activity, invalid Coverage, Lark/full-completion
phases and non-Ads targets cannot extend the window. Safe restore remains mandatory on every exit.

Repository implementation passed focused tests and architecture/hygiene gates. It performs no Remote action
and does not authorize a recovery until exact-head CI passes.
