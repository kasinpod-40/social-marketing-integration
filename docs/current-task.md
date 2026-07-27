# Current Task — WooCommerce Integration Wiring

## Authoritative status

```text
TASK_STATUS                         = VERIFICATION_PASS_MERGE_PENDING
CURRENT_PROGRAM                     = WOOCOMMERCE_INTEGRATION_WIRING
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
DRAFT_PR                            = #94
REVIEWED_SOURCE_PR                  = #66 / PASS_FOR_INTEGRATION
REVIEWED_SOURCE_HEAD                = 10cdd910b1083e6ffd5f8a4e118c06cdc6c842ee
SOURCE_IMPORT_PR                    = #92 / Integration branch only
MIGRATION                           = 0017_woocommerce_commerce.sql / NOT_APPLIED
CODE_VERIFIED_HEAD                  = ed8d24aff59281eb8cac9842722fbbb51e573f20
BRANCH_VERIFICATION                 = #618 / 30245402685 / PASS
MAIN_ALIGNMENT                      = 844c09e4f1ad8113c66e47fddf79d3e1e8dea76d / BEHIND 0
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

Detailed contract and verification evidence:

```text
docs/tasks/woocommerce-end-to-end.md
docs/tasks/woocommerce-integration-wiring.md
```

## Completed repository scope

- Imported exact reviewed PR `#66` implementation through Integration-only PR `#92`.
- Allocated additive Migration `0017_woocommerce_commerce.sql` without Remote apply.
- Registered 14 WooCommerce Lark logical table keys.
- Promoted the Connector/Job to protected `uat_pending` / `manualOnly` status.
- Added stable Queue identity `woocommerce:<operationId>` and reference-only continuation.
- Added strict runtime config with all execution and Schedule gates false by default.
- Added lazy D1 Commerce/report stores and a top-level route preserving all non-WooCommerce behavior.
- Reused Shared Reliability, lock, generation, Queue retry/DLQ, Coverage, Lark repository and `TableSyncEngine`.
- Added focused regression coverage.
- Aligned with current `main` while retaining Meta closeout facts and the WooCommerce Current Task.

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
- Stable identity preserves exact operation ID, work key, generation and original request time.
- Protected runtime is restricted to `development / integration_workspace / chemistry_k`.
- Connector, D1 and Lark gates must all be true together; Schedule must remain false.
- Full reconciliation requires a separate flag.
- Credential preflight remains a separate read-only operator gate.
- Migration `0017` remains source-only until backup/apply authorization.
- No duplicate Reliability, Queue, D1, Coverage or Lark engine was created.

## Verification result

```text
Branch Verification                #618 / 30245402685 PASS
Code head                          ed8d24aff59281eb8cac9842722fbbb51e573f20
Install locked dependencies        PASS
Syntax / architecture / hygiene    PASS
Focused staged TikTok              4 / 4 PASS
Full Node / Workers                965 / 965 PASS
Report reliability                 91 / 91 PASS
Dependency audit                   0 vulnerabilities
Wrangler dry-run                   PASS / no deployment
Behind current main                0
Review decision                    VERIFICATION_PASS_MERGE_PENDING
Remote execution                   NOT RUN
```

## Audit note

An incorrect connector action briefly created `tmp/placeholder` containing only `x` on `main`; it was removed immediately by commit `4c9334a69ced8b595fa433b780a77452eb7cd940`. No Business fact, code path, Secret or Remote resource was affected, and the final main tree contains no placeholder.

## Next gate

Keep PR `#94` Draft, run the documentation-closeout verification on the final head, inspect review threads, and wait for a separate explicit merge decision. Passing repository verification does not authorize any Remote phase.
