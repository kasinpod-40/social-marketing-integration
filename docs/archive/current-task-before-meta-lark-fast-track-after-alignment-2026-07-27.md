# Current Task — WooCommerce Chemistry K Customer Data to Lark Read-only Preflight

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_INTEGRATION_REVIEW
CURRENT_PROGRAM                     = WOOCOMMERCE_CUSTOMER_DATA_TO_LARK_ROLLOUT
BASE_MAIN_SHA                       = 025a2f68800d3c4115676c644b28384eacacdc7f
BRANCH                              = integration/woocommerce-customer-data-lark-rollout
DRAFT_PR                            = #118 / OPEN / DRAFT / UNMERGED
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
VERIFIED_IMPLEMENTATION_HEAD        = 17211c975e2de29e299854870cc4a9506ede3dd7
BRANCH_VERIFICATION                 = #689 / 30288449765 / PASS
REMOTE_EXECUTION_AUTHORIZED         = READ_ONLY_PREFLIGHT_AFTER_MERGE_ONLY
REMOTE_ACTIONS                      = NONE_DURING_IMPLEMENTATION
MIGRATION_0017_STATE                = UNRESOLVED_REMOTE_TRUTH
WOOCOMMERCE_PROVIDER_REQUEST        = NOT_RUN
LARK_METADATA_REQUEST               = NOT_RUN
REMOTE_D1_MUTATION                  = NONE
LARK_MUTATION                       = NONE
QUEUE_OR_DLQ_ACTION                 = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Objective completed

Implemented and verified the guarded read-only readiness chain:

```text
WooCommerce GET-only source
→ D1 durable commerce facts
→ Lark RAW and Canonical commerce tables
→ parity / rerun / incremental UAT
```

Operator phases:

```text
plan
remote-preflight
provider-preflight
lark-preflight
summary
```

The implementation reuses the existing WooCommerce REST client, Shared Queue, Reliability, D1-first
writer, Coverage and Lark engines. It adds no replacement runtime.

## Locked facts

- Migration `0017_woocommerce_commerce.sql`: 17 tables and 13 indexes.
- Remote pending set may be empty or exactly `0017`.
- Remote preflight is SELECT-only and requires zero active Work/locks.
- Provider preflight is GET-only and persists no raw customer records or credential values.
- Lark preflight reads metadata only and requires 14 unique Commerce Table IDs.
- No Remote execution occurred during Repository implementation.

## Verification

```text
NODE_UNIT_INTEGRATION                = 1092 / 1092 PASS
WORKERS_RUNTIME                      = 11 / 11 PASS
REPORT_RELIABILITY                   = 91 / 91 PASS
WOOCOMMERCE_PREFLIGHT_TESTS          = 11 / 11 INCLUDED
DEPENDENCY_AUDIT                     = 0 vulnerabilities
WRANGLER_DRY_RUN                     = PASS / NO DEPLOYMENT
```

## Safe state

```text
REMOTE_D1_QUERY                      = NOT_RUN
REMOTE_D1_BACKUP_OR_MIGRATION        = NOT_RUN
WOOCOMMERCE_PROVIDER_GET             = NOT_RUN
LARK_METADATA_READ                   = NOT_RUN
LARK_SCHEMA_OR_RECORD_MUTATION       = NONE
QUEUE_MESSAGE                        = NONE
WORKER_DEPLOYMENT                    = NOT_RUN
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
```
