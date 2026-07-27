# Current Task — WooCommerce Chemistry K Customer Data to Lark Read-only Preflight

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_INTEGRATION_REVIEW
CURRENT_PROGRAM                     = WOOCOMMERCE_CUSTOMER_DATA_TO_LARK_ROLLOUT
BASE_MAIN_SHA                       = 025a2f68800d3c4115676c644b28384eacacdc7f
BRANCH                              = integration/woocommerce-customer-data-lark-rollout
DRAFT_PR                            = #118 / OPEN / DRAFT / UNMERGED
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
CHATWOOT_WORKSTREAM                 = STOPPED_IN_THIS_CHAT
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

The preceding Meta merge-closeout task is referenced by immutable commit/blob provenance at:

```text
docs/archive/current-task-before-woocommerce-customer-data-lark-rollout-2026-07-27.md
```

## Objective completed

Implemented and verified the first guarded gate for the Chemistry K WooCommerce end-to-end path:

```text
WooCommerce GET-only source
→ D1 durable commerce facts
→ Lark RAW and Canonical commerce tables
→ parity / rerun / incremental UAT
```

This Repository task adds the read-only evidence chain only. It does not execute a Remote phase or
import customer data yet.

## Existing runtime retained

```text
WooCommerce REST client
Shared Queue + stable operation identity
Shared Reliability / lock / retry / DLQ
Resumable work and continuation
D1-first commerce writer
Derived commerce facts
Coverage engine
Shared Lark repository and sync engine
```

No replacement runtime, Queue, Reliability, D1, Coverage or Lark engine was introduced.

## Implemented operator phases

```text
plan
→ remote-preflight
→ provider-preflight
→ lark-preflight
→ summary
```

Every executable phase requires its own exact confirmation and passed target-bound evidence.

## Locked contracts

- Integration Workspace / Chemistry K / Worker / D1 target identity is exact and fingerprinted.
- Migration `0017_woocommerce_commerce.sql` source must contain exactly 17 additive tables and 13 indexes.
- Remote pending set may be empty or exactly Migration `0017`; any additional pending migration fails.
- Remote preflight is SELECT-only and requires zero active work and locks.
- Ledger/schema drift fails closed.
- Provider preflight performs GET-only store identity and one-row samples for orders, products and customers.
- Provider evidence stores only minimized identity/count metadata, never raw records or credentials.
- Lark preflight reads table/field metadata only and requires all 14 unique WooCommerce table IDs.
- Summary returns either a separately gated Migration path or readiness for guarded manual D1/Lark backfill.

## Lark target tables

```text
RAW_Commerce_Stores
RAW_Commerce_Orders
RAW_Commerce_Order_Items
RAW_Commerce_Products
RAW_Commerce_Product_Variations
RAW_Commerce_Categories
RAW_Commerce_Customers
RAW_Commerce_Coupons
RAW_Commerce_Refunds
MKT_Commerce_Orders
MKT_Commerce_Products
MKT_Commerce_Customers
MKT_Commerce_Daily
MKT_Commerce_Product_Daily
```

## Repository verification

Implementation head `17211c975e2de29e299854870cc4a9506ede3dd7` passed Branch Verification
`#689` / run `30288449765`:

```text
INSTALL_LOCKED_DEPENDENCIES          = PASS
SYNTAX_ARCHITECTURE_HYGIENE          = PASS
FOCUSED_STAGED_TIKTOK                = 4 / 4 PASS
NODE_UNIT_INTEGRATION                = 1092 / 1092 PASS
WORKERS_RUNTIME                      = 11 / 11 PASS
REPORT_RELIABILITY                   = 91 / 91 PASS
WOOCOMMERCE_PREFLIGHT_TESTS          = 11 / 11 INCLUDED IN FULL SUITE
DEPENDENCY_AUDIT                     = 0 vulnerabilities
WRANGLER_DRY_RUN                     = PASS / NO DEPLOYMENT
DIAGNOSTICS_ARTIFACT                 = 8661809676
DIAGNOSTICS_DIGEST                   = sha256:2dbefce519777fec6361120947c2bb459b7a37598350eb5ece6146ff1212084e
```

## Remote safe state

```text
REMOTE_D1_QUERY                      = NOT_RUN
REMOTE_D1_BACKUP_OR_MIGRATION        = NOT_RUN
WOOCOMMERCE_PROVIDER_GET             = NOT_RUN
LARK_METADATA_READ                   = NOT_RUN
LARK_SCHEMA_OR_RECORD_MUTATION       = NONE
QUEUE_MESSAGE                        = NONE
DLQ_ACTION                           = NONE
WORKER_DEPLOYMENT                    = NOT_RUN
MANUAL_BACKFILL                      = NOT_RUN
SCHEDULE                             = DISABLED
PRODUCTION                           = BLOCKED
```

## Remaining gate

The documentation-aligned final head must pass exact-final-head Branch Verification and Integration
Review. PR #118 remains Draft and unmerged.

After merge, the first eligible execution is `remote-preflight` only. Provider GET-only and Lark
metadata preflight each require their own later confirmation and prior passed evidence. Backup,
Migration `0017` apply, Worker deployment, Queue send, D1/Lark customer-data backfill, parity, rerun,
incremental UAT, Schedule and Production all remain separately gated.
