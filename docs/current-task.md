# Current Task — WooCommerce Integration Wiring

## Authoritative status

```text
TASK_STATUS                         = VERIFICATION_PENDING
CURRENT_PROGRAM                     = WOOCOMMERCE_INTEGRATION_WIRING
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
DRAFT_PR                            = #94
REVIEWED_SOURCE_PR                  = #66 / PASS_FOR_INTEGRATION
REVIEWED_SOURCE_HEAD                = 10cdd910b1083e6ffd5f8a4e118c06cdc6c842ee
SOURCE_IMPORT_PR                    = #92 / Integration branch only
MIGRATION                           = 0017_woocommerce_commerce.sql / NOT_APPLIED
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
SCHEDULES                           = DISABLED
CUSTOMER_CREDENTIAL                 = NOT_USED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT_RUN
PRODUCTION                          = BLOCKED
MERGE_INTO_MAIN                     = NOT_PERFORMED
```

## Objective

นำ WooCommerce End-to-End ที่ผ่าน `PASS_FOR_INTEGRATION` เข้าสู่ Shared repository contracts โดยจัดเลข Migration, Stable Queue identity, Runtime routing, D1 stores, Lark registry และ default-false flags ให้ครบ โดยยังไม่ดำเนินการกับ Remote infrastructure หรือ Customer source.

Detailed contract and audit evidence:

```text
docs/tasks/woocommerce-end-to-end.md
docs/tasks/woocommerce-integration-wiring.md
```

## In scope

- Import exact reviewed PR `#66` implementation into a separate Integration branch.
- Allocate additive Migration `0017_woocommerce_commerce.sql`.
- Register the 14 reviewed WooCommerce Lark logical table keys.
- Promote WooCommerce Connector/Job to protected `uat_pending` / `manualOnly` repository status.
- Add stable Queue operation identity and reference-only continuation.
- Add strict runtime config with every execution and Schedule flag false by default.
- Wire Shared Reliability, lock, generation, Queue retry/DLQ, D1 Coverage, Lark repository and `TableSyncEngine`.
- Preserve every non-WooCommerce route unchanged.
- Add focused regressions and run all repository gates.

## Out of scope

```text
WooCommerce Provider request
Customer Consumer Key/Secret use
Remote D1 migration or Business write
Remote Lark schema or record mutation
Queue send or DLQ action
Worker deployment
Cron/Schedule activation
Customer/Production LIVE UAT
Report D1-primary cutover
Retention/delete
Production
Merge into main without separate approval
```

## Default-false controls

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

## Safety contract

- Queue execution accepts `trigger=manual_uat` only.
- Stable identity is `woocommerce:<operationId>` and must retain exact generation/originalRequestedAt.
- Protected runtime is restricted to `development / integration_workspace / chemistry_k`.
- Connector, D1 and Lark gates must all be true together; Schedule must remain false.
- Full reconciliation requires a separate flag.
- Credential preflight is a separate operator and is not represented as a Queue dry-run.
- Migration `0017` is source-only until separate backup/apply authorization.
- No duplicate Reliability, Queue, D1, Coverage or Lark engine is allowed.

## Verification state

```text
REVIEWED_IMPLEMENTATION_IMPORT       PASS
MIGRATION_0017_ALLOCATION            COMPLETE / SOURCE ONLY
SHARED_ROUTING                       IMPLEMENTED
STABLE_QUEUE_IDENTITY                IMPLEMENTED
SHARED_LARK_REGISTRY                 IMPLEMENTED
DEFAULT_FALSE_CONFIG                 IMPLEMENTED
FOCUSED_TESTS                        ADDED
FULL_REPOSITORY_VERIFICATION         PENDING
CURRENT_MAIN_ALIGNMENT               PENDING FINAL CHECK
REMOTE_EXECUTION                     NOT RUN
```

## Audit note

An incorrect connector action briefly created `tmp/placeholder` containing only `x` on `main`; it was removed immediately by commit `4c9334a69ced8b595fa433b780a77452eb7cd940`. No Business fact, code path, Secret or Remote resource was affected, and the final main tree contains no placeholder.

## Next gate

Complete exact-head repository verification, align with current `main`, inspect review threads and retain PR `#94` as Draft. Passing repository verification does not authorize merge or any Remote phase.
