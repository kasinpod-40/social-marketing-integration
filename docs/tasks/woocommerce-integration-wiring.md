# WooCommerce Integration Wiring

## Status

```text
TASK_STATUS                         = VERIFICATION_PENDING
CURRENT_PROGRAM                     = WOOCOMMERCE_INTEGRATION_WIRING
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
DRAFT_PR                            = #94
REVIEWED_SOURCE_PR                  = #66 / PASS_FOR_INTEGRATION
REVIEWED_SOURCE_HEAD                = 10cdd910b1083e6ffd5f8a4e118c06cdc6c842ee
SOURCE_IMPORT_PR                    = #92 / merged into Integration branch only
MIGRATION                           = 0017_woocommerce_commerce.sql / source only
REMOTE_D1_MIGRATION                 = NOT_APPLIED
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
REMOTE_LARK_MUTATION                = NONE
SCHEDULE                            = DISABLED
CUSTOMER_CREDENTIAL                 = NOT_USED
LIVE_UAT                            = NOT_RUN
PRODUCTION                          = BLOCKED
MERGE_INTO_MAIN                     = NOT_PERFORMED
```

## Objective

Integrate the reviewed WooCommerce end-to-end implementation into Shared repository contracts while preserving an all-flags-false safe state. This task prepares repository wiring only; it does not authorize a Provider request, Remote migration, Business write, Lark change, Queue send, deployment, Schedule or LIVE UAT.

## Imported reviewed implementation

PR `#66` supplies:

- read-only WooCommerce REST client;
- privacy-minimized Store, Order, line, Product, Variation, Category, Customer, Coupon and Refund models;
- exact signed integer micros and currency isolation;
- durable pagination and immutable continuation scope;
- source-revision gating and atomic Order-line replacement;
- D1 RAW/Canonical/Daily stores and report source;
- Coverage-backed report status;
- existing `TableSyncEngine` delivery.

The exact reviewed head was imported into the Integration branch through PR `#92`; PR `#66` remains Draft and unmerged into `main`.

## Shared wiring

- Allocated additive Migration `0017_woocommerce_commerce.sql` from the reviewed 17-table proposal.
- Registered all 14 WooCommerce Lark logical table keys in the Shared registry; actual table IDs remain Environment inputs.
- Changed WooCommerce Connector and Queue job from `planned` to `uat_pending` and marked the job `manualOnly`.
- Added stable Queue identity `woocommerce:<operationId>` and reference-only continuation serialization.
- Added strict WooCommerce runtime config with all execution and Schedule flags defaulting to `false`.
- Added a protected Integration Workspace runtime that requires Connector, D1 and Lark gates together while Schedule remains false.
- Added lazy Shared infrastructure getters for the WooCommerce Commerce store and report source.
- Added a top-level WooCommerce router that preserves the existing YouTube → Google Ads → Meta → TikTok fallback chain for every non-WooCommerce job.
- Added the dedicated manual route through existing Reliability, lock, generation, Queue retry, DLQ, D1 Coverage and Lark engines.

No duplicate Reliability engine, Queue framework, D1 writer, Coverage store, Lark client or sync engine was created.

## Runtime contract

Manual Queue execution requires:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=true
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=true
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=true
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
trigger=manual_uat
stable operation identity present
```

Full reconciliation additionally requires `MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=true`.

Credential preflight remains a separate operator gate. The Queue route rejects `dryRun=true` rather than mixing a read-only credential check with Business processing.

## Default-false controls

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

## Migration contract

Migration `0017` is additive and replay-safe:

- 17 `CREATE TABLE IF NOT EXISTS` statements;
- additive indexes only;
- no `DROP TABLE`, `DELETE FROM` or `ALTER TABLE`;
- no Remote apply in this task.

## Verification requirements

- locked dependency install;
- syntax, architecture and repository hygiene;
- focused WooCommerce wiring tests;
- full Unit and Workers runtime tests;
- report reliability regression;
- dependency audit;
- Wrangler deployment dry-run without deployment;
- branch alignment with current `main`;
- no unresolved review thread.

## Repository audit note

During branch setup, an incorrect connector action briefly created `tmp/placeholder` on `main`. It contained only `x` and was removed immediately in cleanup commit `4c9334a69ced8b595fa433b780a77452eb7cd940`. The final `main` tree contains no placeholder, and no Business fact, runtime code, Secret, infrastructure configuration or Remote resource was affected.

## Next separately authorized gates

After repository verification and merge approval, work must remain separated:

1. authenticated read-only Remote D1 schema/config preflight;
2. Remote D1 backup;
3. separately authorized additive Migration `0017` apply;
4. all-flags-false Worker deployment;
5. WooCommerce read-only credential/identity preflight;
6. controlled manual D1-first/Lark UAT;
7. Coverage and idempotent rerun validation;
8. report shadow validation;
9. Schedule proposal only after all prior gates pass.

Repository merge alone authorizes none of these Remote phases.
