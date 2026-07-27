# WooCommerce Integration Wiring — 2026-07-27

## Repository decision

```text
DRAFT_PR                            = #94
INTEGRATION_BRANCH                  = integration/woocommerce-safe-wiring
SOURCE_REVIEW                       = PR #66 / PASS_FOR_INTEGRATION
MIGRATION                           = 0017 / SOURCE ONLY
CODE_VERIFICATION                   = #618 PASS
CURRENT_MAIN_ALIGNMENT              = BEHIND 0
MERGE_INTO_MAIN                     = NOT PERFORMED
REMOTE_EXECUTION                    = NONE
```

## Shared architecture

The Integration branch imports the exact reviewed WooCommerce end-to-end implementation and connects it to existing Shared contracts:

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
YouTube
→ Google Ads
→ Meta
→ TikTok / Reports / active fallback
```

## Safety state

- WooCommerce Connector and Job are `uat_pending` and manual-only.
- All Connector, D1, Lark, Report, full-reconciliation and Schedule flags default to `false`.
- Consumer Key/Secret are not read while the Connector gate is false.
- A manual Queue job requires `development / integration_workspace / chemistry_k`, all write gates and Schedule false.
- Full reconciliation has a separate gate.
- Credential preflight is a separate read-only operator and cannot be represented as Queue `dryRun`.
- Migration `0017` is additive, replay-safe and not applied remotely.
- No Provider call, Worker deployment, Queue send, Remote D1/Lark mutation, Schedule or LIVE UAT occurred.

## Verification

Branch Verification `#618` passed on `ed8d24aff59281eb8cac9842722fbbb51e573f20`:

```text
Syntax / architecture / hygiene   PASS
Focused staged TikTok             4 / 4 PASS
Full Node / Workers               965 / 965 PASS
Report reliability                91 / 91 PASS
Dependency audit                  0 vulnerabilities
Wrangler dry-run                  PASS / no deployment
```

## Next separate authorization

Repository merge, Remote schema preflight/backup, Migration `0017`, all-flags-false deployment, customer credential validation, D1-first/Lark UAT, report validation and Schedule activation are separate decisions. No phase is authorized automatically by this record.
