# Meta D1-only Rollout Operator — 2026-07-27

## Repository state

```text
BRANCH                              = integration/meta-d1-only-rollout-operator
BASE_MAIN_SHA                       = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
CONTRACT                            = meta-d1-only-rollout-v1
META_READ_ONLY_PROVIDER_VALIDATION  = PASS / 4 TARGETS
REMOTE_EXECUTION                    = NOT_RUN
REMOTE_MUTATION                     = NONE
PRODUCTION                          = BLOCKED
```

## Why this operator exists

Chemistry K Meta identity and permission validation passed for Facebook, Instagram and both Meta Ads
accounts using GET-only Provider calls. The next approved architecture boundary is D1-only
processing, but the Repository previously had no rollout operator that bound Backup, deployment
provenance, exact Queue operation, D1/Coverage reconciliation, idempotent rerun and safe restore.

The existing Meta Runtime already supports `d1Only=true`. This branch adds the guarded orchestration
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

## Remaining gates

1. complete Branch Verification;
2. review Draft PR and merge separately;
3. refresh exact main/Worker/D1/Queue state;
4. separately approve one target's plan/preflight;
5. separately approve Backup and Safe deployment;
6. separately approve one D1-only active window and same-operation rerun;
7. restore all false;
8. repeat with a fresh chain for the next target;
9. after all four targets pass, open a separate Lark parity task

This document authorizes none of the Remote phases above.
