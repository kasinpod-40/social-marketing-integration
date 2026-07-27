# WooCommerce Integration Wiring

## Final repository status

```text
TASK_STATUS                         = VERIFICATION_PASS_MERGE_PENDING
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
DRAFT_PR                            = #94 / OPEN / DRAFT
REVIEWED_SOURCE_PR                  = #66 / PASS_FOR_INTEGRATION
SOURCE_IMPORT_PR                    = #92 / INTEGRATION BRANCH ONLY
MIGRATION                           = 0017_woocommerce_commerce.sql / SOURCE ONLY
CURRENT_MAIN                        = 72486da7df8bacef908e286a269de2f943edec7d
FINAL_ALIGNED_CODE_HEAD             = d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9
FINAL_BRANCH_VERIFICATION           = #622 / 30246242431 / PASS
BRANCH_BEHIND_MAIN                  = 0
REMOTE_EXECUTION                    = NONE
MERGE_INTO_MAIN                     = NOT PERFORMED
```

## Integrated architecture

The exact reviewed WooCommerce implementation from PR `#66` is imported through Integration-only PR `#92` and connected to existing Shared contracts:

```text
manual_uat WooCommerce Queue job
→ stable operation identity
→ Shared Reliability / distributed lock / generation fence
→ read-only WooCommerce REST source
→ additive Commerce D1 RAW / Canonical / Daily storage
→ Shared Coverage
→ existing TableSyncEngine / Lark destinations
→ reference-only continuation when bounded work remains
```

The top-level route preserves every non-WooCommerce path:

```text
YouTube → Google Ads → Meta → TikTok / reports / active fallback
```

## Shared wiring completed

- WooCommerce Connector and Queue job are `uat_pending`; the job is `manualOnly`.
- Stable work identity is `woocommerce:<operationId>`.
- Continuation retains the original operation/generation and contains no credential or Source payload.
- Shared Reliability, lock, generation, retry/DLQ, resumable work and Coverage are reused.
- D1 Commerce/report stores are lazy and route-scoped.
- All 14 reviewed WooCommerce Lark logical table keys are centrally registered.
- Consumer credentials are not required or read while the Connector gate is false.
- Credential/identity preflight remains a separate GET-only operator gate.
- No duplicate Reliability, Queue, D1, Coverage, Lark client or sync engine was created.

## Default-false controls

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_REPORT_READ_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

## Migration ownership

Migration `0017_woocommerce_commerce.sql` contains 17 additive `CREATE TABLE IF NOT EXISTS` statements and additive indexes only. It contains no `DROP TABLE`, `DELETE FROM` or `ALTER TABLE`, and it has not been applied remotely.

WooCommerce owns Migration `0017`. The merged Chatwoot foundation closeout records its later runtime migration as provisional `0018` pending resolution of this PR.

## Final verification

Branch Verification `#622` on `d0ce3399177b5d6c8fcdb6c56eadd77851ae29e9` passed:

```text
Install locked dependencies       PASS
Syntax / architecture / hygiene   PASS
Focused staged TikTok             4 / 4 PASS
Node Unit / Integration           990 / 990 PASS
Workers runtime                   9 / 9 PASS
Report reliability                91 / 91 PASS
Dependency audit                  0 vulnerabilities
Wrangler deployment dry-run       PASS / no deployment
Diagnostics upload                PASS
```

The branch is aligned to `main` `72486da7df8bacef908e286a269de2f943edec7d` with `behind_by=0`. No unresolved review thread exists. The final diff contains no one-shot workflow, temporary apply script, build output or placeholder file.

## Remote safe state

No WooCommerce Provider request, credential read, Worker deployment, Remote D1 migration/query/write, Remote Lark mutation, Queue/DLQ activity, Schedule activation, Customer LIVE UAT, Production change or merge into `main` occurred.

## Repository audit note

An incorrect connector action briefly created `tmp/placeholder` containing only `x` on `main` at `60f5ce3c9af74f00efea90712786576e251c6672`. It was removed immediately at `4c9334a69ced8b595fa433b780a77452eb7cd940`. The final trees contain no placeholder and no Business fact, Secret, runtime configuration or Remote resource was affected.

## Separately authorized next gates

1. explicit repository merge decision;
2. authenticated read-only Remote D1 schema/config preflight;
3. Remote D1 backup;
4. separately authorized Migration `0017` apply/read-back;
5. all-flags-false Worker deployment;
6. read-only WooCommerce credential and exact Store identity validation;
7. controlled manual D1-first/Lark UAT;
8. Coverage, revision, exact-rerun and report-shadow validation;
9. Schedule proposal only after all earlier gates pass.

Repository verification or merge authorizes none of these Remote phases automatically.
