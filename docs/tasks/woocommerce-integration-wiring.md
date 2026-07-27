# WooCommerce Integration Wiring

## Final status

```text
TASK_STATUS                         = MERGED_REMOTE_ROLLOUT_NOT_AUTHORIZED
MERGED_PR                           = #94
MERGE_COMMIT                        = 060977cd9ed2933700fbd121c9236e6578ad571e
REVIEWED_SOURCE_PR                  = #66 / PASS_FOR_INTEGRATION
REVIEWED_SOURCE_HEAD                = 10cdd910b1083e6ffd5f8a4e118c06cdc6c842ee
INTEGRATION_VERIFIED_HEAD           = d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
FINAL_BRANCH_VERIFICATION           = #622 / 30246242431 / PASS
MIGRATION                           = 0017_woocommerce_commerce.sql / SOURCE ONLY
REMOTE_MIGRATION_0017               = NOT_APPLIED
REMOTE_EXECUTION                    = NONE
```

## Merged architecture

PR `#94` imports the reviewed PR `#66` implementation and connects it to existing Shared contracts:

```text
manual_uat WooCommerce Queue job
→ stable operation identity
→ Shared Reliability / lock / generation fence
→ read-only WooCommerce REST source
→ additive Commerce D1 RAW / Canonical / Daily storage
→ Shared Coverage
→ existing TableSyncEngine / Lark destinations
→ reference-only continuation when bounded work remains
```

The top-level WooCommerce route preserves all non-WooCommerce behavior:

```text
YouTube → Google Ads → Meta → TikTok / reports / active fallback
```

## Merged contracts

- Connector and Queue job remain protected `uat_pending`; the job is `manualOnly`.
- Stable identity is `woocommerce:<operationId>`.
- Continuations preserve operation ID, work key, generation and original request time.
- Protected processing is restricted to `development / integration_workspace / chemistry_k`.
- Connector, D1 and Lark gates must all be true; Schedule must remain false.
- Full reconciliation requires a separate flag.
- Consumer credentials are not required or read while the Connector gate is false.
- Credential/identity validation is a separate read-only operator gate.
- Existing Reliability, Queue/DLQ, resumable work, Coverage and `TableSyncEngine` are reused.
- All 14 reviewed WooCommerce Lark logical table keys are registered centrally.
- No duplicate Shared framework or engine was introduced.

## Default-false controls

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

## Migration 0017

Migration `0017_woocommerce_commerce.sql` contains 17 additive `CREATE TABLE IF NOT EXISTS` statements and additive indexes only. It contains no destructive schema/data statement and has not been applied remotely.

## Verification

Branch Verification `#622` passed on the exact reviewed Integration head:

```text
Node Unit / Integration           990 / 990 PASS
Workers runtime                   9 / 9 PASS
Focused staged TikTok             4 / 4 PASS
Report reliability                91 / 91 PASS
Dependency audit                  0 vulnerabilities
Syntax / architecture / hygiene   PASS
Wrangler dry-run                  PASS / no deployment
```

## Remote safe state

Repository merge performed no Provider request, Customer credential use, Remote D1/Lark mutation, Queue/DLQ action, Worker deployment, Schedule activation, LIVE UAT or Production change.

## Next rollout gate

Proceed only by separate approvals in this order: read-only Remote schema/config preflight, backup, Migration `0017`, all-flags-false deployment, credential/identity validation, bounded manual D1-first/Lark UAT, Coverage/idempotency/report validation, and only then a Schedule proposal.
