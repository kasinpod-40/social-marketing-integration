# Multichannel Report Live Closure Framework v1

## Status

```text
FRAMEWORK_STATUS=READY
FIRST_ADOPTER=youtube
CHANNEL_DESCRIPTORS=ALL_SUPPORTED
YOUTUBE_STATUS=READY_FOR_LIVE_AUDIT
REMOTE_WRITE_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```

Repository implementation is complete and exact-head CI is green. Meta PR #421 remains the active Remote lock owner. No Live command may be executed until an Audit Workstream verifies that lock is released, completes the authorized read-only YouTube assessment and binds the reviewed shared adapters.

## Ownership and overlap gate

The branch starts from `main@fac11f0f95b56ab0944da02dcb0360d2f5c43710` and remains `behind_by=0` after final verification.

PR #421 changed-file inventory was inspected before implementation and rechecked after CI. This workstream does not modify any PR #421 path, Meta connector/use-case/operator/test, Lark Native AI implementation, `docs/current-task.md`, retained Meta evidence, README, CHANGELOG or PROJECT_BRAIN.

No migration is added. Existing `report_materializations`, Report finalizer, D1 readers, Coverage, Lark writer, Reliability/Lock/Queue/DLQ and Stable-key authorities remain the required runtime adapters.

## Shared pipeline

```text
Repository gate
→ Runtime/Safe-state gate
→ Source readiness
→ Coverage validation
→ Report identity planning
→ 1/3/7/30 materialization plan
→ D1 persistence
→ Lark write
→ D1/Lark parity
→ Same-input replay
→ Zero-drift verification
→ Safe restore
→ Sanitized evidence
```

The framework is dependency-injected. Channel behavior is selected by Descriptor; shared persistence, Lark, Coverage, Reliability and finalization authorities are adapters. Channel-specific `if/else` branching is not permitted in the closure runner.

## Supported descriptors

- TikTok / YouTube / Instagram / Facebook Organic
- Meta Ads / Google Ads / TikTok Ads
- WooCommerce Commerce
- Chatwoot Customer Service
- Operations
- Executive aggregation

Every descriptor declares platform, capability, source reader, top-entity type, currency mode, exact supported windows, readiness authority, Coverage authority, metric projection, required Lark outputs and safe runtime flags.

## Identity and stable-key contract

Identity dimensions remain:

- `customer_key`
- `customer_profile`
- `platform`
- `capability`
- `account_id`
- `period_kind`
- `window_days`
- `report_setting_key`
- `metric_scope`

Stable keys remain:

- `report_id`
- `report_metric_key`
- `report_content_key`
- `report_ad_key`

Dimensioned outputs retain `dimension_type`, `dimension_value` and `rank` through the injected projection/output adapters.

## Window and missing-value contract

Only `1`, `3`, `7`, `30` are accepted. The current Lark Metric path must not receive `9`, `15` or `90`.

- unavailable/missing → `null` + `N/A`
- incomplete → `null` + partial metadata
- covered empty → `no_data_confirmed`
- observed zero → `0`

## YouTube first adopter

The reviewed terminal produces four exact Report identities and a plan-only exact Live command. It remains fail-closed under either condition:

1. Meta Remote lock is not explicitly released.
2. Reviewed shared runtime adapters are not bound by the Audit Workstream.

The repository and CI did not execute Provider calls, Remote readiness reads, Remote D1/Lark writes, Queue actions, Worker uploads/deployments, Live materialization or Production actions. `YOUTUBE_STATUS=READY_FOR_LIVE_AUDIT` means the implementation and command are prepared for the separately authorized read-only audit; it is not a claim that Remote readiness has already passed.

## Exact future command

Do not run while PR #421 owns the Remote lock.

```bash
MKT_META_REMOTE_LOCK_RELEASED=true \
CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE \
node scripts/multichannel-report-live-closure-terminal.mjs \
  --platform=youtube \
  --capability=organic \
  --execute
```

The command intentionally stops with `REPORT_LIVE_CLOSURE_EXECUTION_AUTHORITY_NOT_BOUND` until the Audit Workstream binds reviewed existing D1 reader, Report finalizer, Lark writer, Coverage and safe-runtime adapters.

## Verification

Exact verified Head before this documentation-only evidence commit:

```text
1c5d0e19db97ef9921632e495dfafa88165bb545
```

Branch Verification:

```text
workflow       Branch Verification
run number     1819
run ID         30784745965
conclusion     success
```

Successful steps included:

- locked dependency installation
- syntax, architecture and repository hygiene
- focused Meta history finalizer regression
- focused Woo completed-state race recovery regression
- focused Chatwoot final UAT regression
- focused staged TikTok regression
- Unit and Workers runtime tests
- Report reliability regression
- dependency audit
- Wrangler dry run
- verification diagnostics upload

Required command contract:

```bash
npm ci
npm run check
node --test tests/application/report-live-closure-framework.test.js
node --test tests/scripts/multichannel-report-live-closure-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository and CI execution preserved zero Provider, Queue, Remote D1, Remote Lark, Worker deployment, Schedule and Production actions.
