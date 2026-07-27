# Meta Lark Parity Fast-Track Runbook

## Purpose

รัน Lark readiness พร้อมกับ Meta D1 rollout และต่อแต่ละ Target เข้า Lark ทันทีเมื่อ D1 ของ Target
นั้นผ่าน โดยไม่เรียก Provider ซ้ำและไม่รอครบสี่ Target

## Global safety

- Integration Workspace only: `development / integration_workspace / chemistry_k`.
- One target and one evidence chain at a time.
- One Integration-owned Worker deployment window at a time.
- No schedules, Reports, DLQ redrive, retention/delete or Production.
- Never print or persist Token/Secret values.
- Stop after every phase and review sanitized evidence.
- If an active-window phase fails, restore all flags false before any other rollout.

## Parallel lane A — Lark metadata readiness

This phase can run immediately, before D1 processing:

```bash
CONFIRM_META_LARK_PREFLIGHT=READ_ONLY_META_LARK_PREFLIGHT \
npm run rollout:meta-lark:preflight
```

The target/environment bundle must include the exact Meta Lark Table IDs. The phase performs:

```text
1 listTables request
15 listFields requests
0 record reads
0 record writes
0 schema writes
```

Acceptance:

- all 15 tables exist;
- all IDs are unique;
- every stable-key Field exists;
- Env mappings equal Safe Wrangler mappings;
- no credential values in evidence.

The same metadata result is reusable across target chains only while the repository/config/table
fingerprint remains unchanged. Each chain still records its own target-bound evidence.

## Parallel lane B — D1 target rollout

Use the merged Meta D1-only runbook. Target order:

```text
facebook
instagram
chemistry_k2
chemistry_k3
```

Do not wait for all four. As soon as a target produces an accepted D1 summary and verified all-false
restore, begin that target's Lark chain.

## Target environment

The Lark operator reuses the exact D1 operation identity. Required non-secret values include:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
MKT_META_LARK_TARGET=<target>
MKT_META_LARK_ACCOUNT_KEY=chemistry_k
MKT_META_LARK_REPOSITORY_HEAD=<exact reviewed main SHA>
MKT_META_LARK_EXPECTED_ACTIVE_VERSION=<current 100% Worker version>
MKT_META_LARK_WRANGLER_CONFIG=<safe all-false config path>
MKT_META_LARK_READ_ONLY_SUMMARY=<accepted provider summary path>
MKT_META_LARK_D1_SUMMARY=<accepted exact target D1 summary path>
MKT_META_LARK_OPERATION_ID=<same D1 operation ID>
MKT_META_LARK_ORIGINAL_REQUESTED_AT=<same D1 timestamp>
MKT_META_LARK_PERIOD_START=<same D1 period start>
MKT_META_LARK_PERIOD_END=<same D1 period end>
MKT_META_LARK_WORKER_NAME=social-mkt-sync-worker
MKT_META_LARK_DATABASE_NAME=social-mkt-state-dev
MKT_META_LARK_MAIN_QUEUE=social-mkt-sync-jobs
MKT_META_LARK_DLQ=social-mkt-sync-dlq
```

Queue ID/account ID and credential values remain local Secret inputs.

## Phase sequence per D1-ready target

### 1. D1 readiness

```bash
CONFIRM_META_LARK_D1_READY=VERIFY_META_D1_READY_FOR_LARK \
npm run rollout:meta-lark:d1-ready
```

Reads D1 only and validates exact D1 summary. No write.

### 2. Safe baseline deployment

```bash
CONFIRM_META_LARK_DEPLOY_SAFE=DEPLOY_META_LARK_SAFE_BASELINE \
npm run rollout:meta-lark:deploy-safe
```

### 3. Verify safe baseline

```bash
CONFIRM_META_LARK_VERIFY_SAFE=VERIFY_META_LARK_SAFE_BASELINE \
npm run rollout:meta-lark:verify-safe
```

Requires all execution flags false and exact Queue/DLQ topology.

### 4. Deploy Lark gates

```bash
CONFIRM_META_LARK_DEPLOY_ACTIVE=DEPLOY_META_LARK_GATES \
npm run rollout:meta-lark:deploy-active
```

Exactly selected Connector + Meta source + D1 + Lark flags true.

### 5. Verify active deployment

```bash
CONFIRM_META_LARK_VERIFY_ACTIVE=VERIFY_META_LARK_DEPLOYMENT \
npm run rollout:meta-lark:verify-active
```

### 6. Snapshot before

```bash
CONFIRM_META_LARK_SNAPSHOT=SNAPSHOT_META_LARK_BASELINE \
npm run rollout:meta-lark:snapshot
```

### 7. Send same-operation continuation

```bash
CONFIRM_META_LARK_SEND=SEND_META_LARK_CONTINUATION \
npm run rollout:meta-lark:send
```

The payload reuses the D1 operation and omits `d1Only`; it must not create a new Work identity.

### 8. Verify Lark parity

```bash
CONFIRM_META_LARK_VERIFY=VERIFY_META_LARK_COMPLETION \
npm run rollout:meta-lark:verify
```

Acceptance includes zero D1/Coverage drift, complete Lark reconciliation and completed Work.

### 9. One same-operation rerun

```bash
CONFIRM_META_LARK_RESEND=RESEND_SAME_META_LARK_OPERATION \
npm run rollout:meta-lark:resend
```

### 10. Verify idempotent rerun

```bash
CONFIRM_META_LARK_VERIFY_RERUN=VERIFY_META_LARK_IDEMPOTENT_RERUN \
npm run rollout:meta-lark:verify-rerun
```

### 11. Restore all false

```bash
CONFIRM_META_LARK_RESTORE=RESTORE_META_LARK_ALL_FALSE \
npm run rollout:meta-lark:restore
```

### 12. Verify restore

```bash
CONFIRM_META_LARK_VERIFY_RESTORE=VERIFY_META_LARK_RESTORE \
npm run rollout:meta-lark:verify-restore
```

### 13. Summary

```bash
CONFIRM_META_LARK_SUMMARY=SUMMARIZE_META_LARK_ROLLOUT \
npm run rollout:meta-lark:summary
```

## Pipeline scheduling

After Facebook Lark active deployment completes, restore all false before changing target. D1 data
collection for another target may be prepared concurrently only when it does not deploy the same Worker
or send to the shared Queue during the active Lark window.

Recommended fast sequence:

```text
Lark metadata preflight
Facebook D1 complete
Facebook Lark complete + restore
Instagram D1 complete
Instagram Lark complete + restore
chemistry_k2 D1 complete
chemistry_k2 Lark complete + restore
chemistry_k3 D1 complete
chemistry_k3 Lark complete + restore
```

D1 source/read-only/preflight work that does not mutate the shared Worker may overlap. Deployment and
Queue-send windows are serialized.

## Emergency restore

Any failure after `deploy-lark-gates` requires:

```text
restore-all-false
verify-restore
```

Do not proceed to another target until remote flags and Queue topology are verified safe.
