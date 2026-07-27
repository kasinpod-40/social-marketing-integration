# WooCommerce Integration Wiring — 2026-07-27

## Repository decision

```text
DRAFT_PR                            = #94 / OPEN / DRAFT
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
SOURCE_REVIEW                       = PR #66 / PASS_FOR_INTEGRATION
SOURCE_IMPORT                       = PR #92 / INTEGRATION BRANCH ONLY
MIGRATION                           = 0017 / SOURCE ONLY
CURRENT_MAIN                        = 72486da7df8bacef908e286a269de2f943edec7d
FINAL_ALIGNED_CODE_HEAD             = d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
FINAL_BRANCH_VERIFICATION           = #622 / 30246242431 PASS
BRANCH_BEHIND_MAIN                  = 0
MERGE_INTO_MAIN                     = NOT PERFORMED
REMOTE_EXECUTION                    = NONE
```

## Shared architecture

The Integration branch imports the exact reviewed WooCommerce End-to-End implementation and connects it to existing Shared contracts:

```text
WooCommerce manual_uat Queue job
→ stable operation identity
→ Shared Reliability / distributed lock / generation fence
→ read-only WooCommerce REST source
→ additive Commerce D1 RAW / Canonical / Daily storage
→ Shared Coverage
→ existing TableSyncEngine / Lark tables
→ reference-only continuation when bounded work remains
```

Every non-WooCommerce job continues through the existing guarded chain:

```text
YouTube → Google Ads → Meta → TikTok / Reports / active fallback
```

## Locked contracts

- Connector/Job status is `uat_pending`; the Queue job is manual-only.
- Work identity is `woocommerce:<operationId>`.
- The exact generation and original request time survive continuations.
- The protected route requires `development / integration_workspace / chemistry_k`.
- Connector, D1 and Lark gates must all be true; Schedule must remain false.
- Full reconciliation uses a separate explicit gate.
- Consumer credentials are not read while the Connector gate is false.
- Credential validation is a separate read-only operator, not a Business Queue dry-run.
- Existing Reliability, lock, Queue retry/DLQ, resumable work, Coverage and `TableSyncEngine` are reused.
- No duplicate Shared engine/framework was created.

## Default-false controls

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

## Migration and parallel-workstream ownership

WooCommerce Integration owns additive Migration `0017_woocommerce_commerce.sql`. It has not been applied remotely. The merged Chatwoot foundation recognizes this ownership and treats its later runtime migration as provisional `0018` until PR `#94` is resolved.

## Verification

```text
Branch Verification               #622 PASS
Node Unit / Integration           990 / 990 PASS
Workers runtime                   9 / 9 PASS
Focused staged TikTok             4 / 4 PASS
Report reliability                91 / 91 PASS
Dependency audit                  0 vulnerabilities
Wrangler dry-run                  PASS / no deployment
Review threads                    NONE
Temporary apply artifacts         NONE IN FINAL DIFF
```

## Remote safe state

No Provider request, Customer credential use, Worker deployment, Remote D1/Lark mutation, Queue/DLQ activity, Schedule, LIVE UAT, Production change or merge into `main` occurred.

## Audit note

A temporary `tmp/placeholder` containing only `x` was accidentally created on `main` at `60f5ce3c9af74f00efea90712786576e251c6672` and immediately removed at `4c9334a69ced8b595fa433b780a77452eb7cd940`. The final trees contain no placeholder and no Business fact, Secret, runtime configuration or Remote infrastructure was affected.

## Next separate authorization

PR `#94` must receive an explicit merge decision. Remote schema preflight, backup, Migration `0017`, flags-false deployment, credential validation, manual D1-first/Lark UAT, report validation and Schedule activation remain separate later gates.
