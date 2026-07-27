# Current Task — WooCommerce Integration Wiring

## Authoritative status

```text
TASK_STATUS                         = VERIFICATION_PASS_MERGE_PENDING
CURRENT_PROGRAM                     = WOOCOMMERCE_INTEGRATION_WIRING
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
DRAFT_PR                            = #94 / OPEN / DRAFT
REVIEWED_SOURCE_PR                  = #66 / PASS_FOR_INTEGRATION
REVIEWED_SOURCE_HEAD                = 10cdd910b1083e6ffd5f8a4e118c06cdc6c842ee
SOURCE_IMPORT_PR                    = #92 / INTEGRATION BRANCH ONLY
MIGRATION                           = 0017_woocommerce_commerce.sql / NOT_APPLIED
CURRENT_MAIN                        = 72486da7df8bacef908e286a269de2f943edec7d
FINAL_ALIGNED_CODE_HEAD             = d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
FINAL_BRANCH_VERIFICATION           = #622 / 30246242431 / PASS
BRANCH_BEHIND_MAIN                  = 0
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_OR_DLQ_ACTION                 = NONE
REMOTE_D1_OR_LARK_MUTATION          = NONE
SCHEDULES                           = DISABLED
CUSTOMER_CREDENTIAL                 = NOT_USED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT_RUN
PRODUCTION                          = BLOCKED
MERGE_INTO_MAIN                     = NOT_PERFORMED
```

## Objective

นำ WooCommerce End-to-End ที่ผ่าน `PASS_FOR_INTEGRATION` เข้าสู่ Shared repository contracts โดยจัดเลข Migration, Stable Queue identity, Runtime routing, D1 stores, Lark registry และ default-false flags ให้ครบ โดยยังไม่ดำเนินการกับ Remote infrastructure หรือ Customer source.

Detailed contracts:

```text
docs/tasks/woocommerce-end-to-end.md
docs/tasks/woocommerce-integration-wiring.md
docs/project-brain/woocommerce-integration-wiring-2026-07-27.md
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
- Aligned with the merged Chatwoot foundation and closeout while retaining the WooCommerce Current Task.

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
Branch Verification                #622 / 30246242431 PASS
Aligned code head                  d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
Install locked dependencies        PASS
Syntax / architecture / hygiene    PASS
Focused staged TikTok              4 / 4 PASS
Node Unit / Integration            990 / 990 PASS
Workers runtime                    9 / 9 PASS
Report reliability                 91 / 91 PASS
Dependency audit                   0 vulnerabilities
Wrangler dry-run                   PASS / no deployment
Behind current main                0
Review decision                    VERIFICATION_PASS_MERGE_PENDING
Remote execution                   NOT RUN
```

Focused WooCommerce implementation and Shared-wiring tests run inside the full Node suite. The standard workflow does not expose separate literal steps for `node --test tests/woocommerce/*.test.js` or `git diff --check`; those commands are not recorded as separately executed.

## Audit note

An incorrect connector action briefly created `tmp/placeholder` containing only `x` on `main` at `60f5ce3c9af74f00efea90712786576e251c6672`; it was removed immediately at `4c9334a69ced8b595fa433b780a77452eb7cd940`. No Business fact, code path, Secret or Remote resource was affected, and the final trees contain no placeholder.

## Next gate

Keep PR `#94` Draft and wait for a separate explicit merge decision. Repository verification does not authorize Remote schema inspection, backup, Migration `0017`, deployment, credential validation, Queue execution, Lark UAT, schedules or Production.
