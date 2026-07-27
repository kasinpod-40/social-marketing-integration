# Chatwoot Remote Read-only Preflight

## Status

```text
TASK_STATUS                 = REPOSITORY_OPERATOR_IMPLEMENTATION
WORKSTREAM                  = CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT
BRANCH                      = integration/chatwoot-remote-read-only-preflight
BASE_MAIN                   = f3e330339b114536c3a1a9ee7567abf5a76fa78b
MIGRATION_0017              = APPLIED / DO_NOT_RERUN
MIGRATION_0018              = SOURCE_ONLY / EXPECTED_PENDING
REMOTE_EXECUTION            = NOT_RUN
REMOTE_MUTATION_AUTHORIZED  = false
PRODUCTION                  = BLOCKED
```

## Objective

เพิ่ม Operator สำหรับตรวจ Remote Integration Workspace แบบอ่านอย่างเดียวก่อนอนุญาต Backup หรือ
Apply Migration `0018_chatwoot_analytics.sql` โดยต้องยืนยัน Worker version, Remote flags,
Chatwoot identity fingerprints, Secret names, D1 migration ledger, Queue consumers, Cron และ
workers.dev state จาก Remote responses จริง โดยไม่ใช้ local config เป็นหลักฐานแทน Remote state.

งานนี้ไม่ใช่ Chatwoot Provider credential/API preflight และไม่เรียก Chatwoot API.

## Operator contract

```text
contractVersion = chatwoot-remote-read-only-preflight-v1
phases          = plan → preflight
plan            = default / no Remote action
preflight       = explicit --execute + exact confirmation
```

Execution confirmation:

```text
CONFIRM_CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT=PREFLIGHT_CHATWOOT_REMOTE_READ_ONLY
```

Evidence path:

```text
outputs/chatwoot-read-only-preflight/preflight.json
```

`outputs/` ถูก Ignore และ Evidence ต้องมี permission แบบ private. ห้าม Commit Evidence.

## Exact target

```text
MKT_ENV                         = development
MKT_CUSTOMER_PROFILE            = integration_workspace
MKT_CONNECTION_CUSTOMER_KEY     = chemistry_k
accountKey                      = chemistry_k
Worker                          = social-mkt-sync-worker
D1                              = social-mkt-state-dev / MKT_STATE_DB
Main Queue                      = social-mkt-sync-jobs
DLQ                             = social-mkt-sync-dlq
Migration 0017                  = must already be applied
Migration 0018                  = must be the only pending migration
```

Chatwoot Base URL และ external Account ID ต้องเทียบแบบ SHA-256 fingerprint เท่านั้นใน Evidence:

```text
MKT_CHATWOOT_PREFLIGHT_EXPECTED_BASE_URL_SHA256
MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACCOUNT_ID_SHA256
```

ค่าจริงใช้เฉพาะ Environment ของ Operator และห้ามพิมพ์ลง Log, PR, Evidence หรือเอกสาร.

## Required Remote reads

อนุญาตเฉพาะ:

1. `wrangler deployments status` เพื่อยืนยัน exact active version และ 100% traffic;
2. `wrangler versions view` เพื่ออ่าน Remote bindings/plain-text vars;
3. `wrangler secret list` เพื่ออ่านเฉพาะชื่อ Secret;
4. `wrangler d1 migrations list --remote`;
5. Remote D1 `SELECT name FROM d1_migrations ORDER BY id`;
6. Main Queue และ DLQ consumer metadata;
7. Worker script list, Cron schedules และ workers.dev state ผ่าน Cloudflare read-only API;
8. Local `wrangler deploy --dry-run --strict` เพื่อ hash bundle โดยไม่ Deploy.

## Required all-false Chatwoot controls

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

หากค่าใดหาย, malformed หรือไม่ใช่ `false` ต้อง Fail closed.

## Secret-name contract

Required:

```text
CHATWOOT_API_ACCESS_TOKEN
```

Optional/future Lark parity:

```text
LARK_APP_ID
LARK_APP_SECRET
```

Operator อ่านได้เฉพาะชื่อและจำนวน ห้ามอ่านหรือ Persist ค่า Secret.

## Migration ledger contract

```text
0017_woocommerce_commerce.sql = present in applied ledger
0018_chatwoot_analytics.sql   = absent from applied ledger
0018_chatwoot_analytics.sql   = exactly one pending migration
unexpected pending migration  = none
```

ความผิดปกติทุกแบบต้องหยุดก่อน Backup/Apply.

## Queue and trigger contract

- Main Queue และ DLQ ต้องมี Consumer อย่างน้อยหนึ่งรายการ.
- Queue identity ต้องตรงกับ Integration Workspace เมื่อ Remote payload ให้ชื่อ Queue.
- Worker `social-mkt-sync-worker` ต้องอยู่ใน account script list.
- Cron ต้องตรงกับ Repository contract:

```text
*/5 * * * *
50 0,6,12,18 * * *
```

- `workers.dev` ต้องปิด.
- Operator ไม่แก้ Cron, route, workers.dev, consumer หรือ binding.

## Evidence contract

Evidence เก็บได้เฉพาะ:

- exact repository SHA และ target fingerprint;
- active Worker version/traffic;
- local bundle SHA-256;
- Chatwoot flag fingerprint;
- Base URL/Account ID SHA-256 fingerprints;
- Secret-name count/fingerprint;
- Migration names/status;
- Queue consumer count/fingerprint;
- Cron count/fingerprint และ workers.dev boolean;
- explicit zero counts สำหรับ Remote mutation, Provider request และ Secret-value read.

ห้ามเก็บ:

```text
CLOUDFLARE_API_TOKEN
Chatwoot API token value
Authorization header
raw Worker vars/bindings
raw Base URL
raw Chatwoot Account ID
raw Cloudflare Account ID
raw response bodies
Lark credentials
```

## Required environment

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
MKT_CHATWOOT_PREFLIGHT_ACCOUNT_KEY=chemistry_k
MKT_CHATWOOT_PREFLIGHT_WORKER_NAME=social-mkt-sync-worker
MKT_CHATWOOT_PREFLIGHT_DATABASE_NAME=social-mkt-state-dev
MKT_CHATWOOT_PREFLIGHT_MAIN_QUEUE=social-mkt-sync-jobs
MKT_CHATWOOT_PREFLIGHT_DLQ=social-mkt-sync-dlq
MKT_CHATWOOT_PREFLIGHT_REPOSITORY_HEAD=<exact reviewed full SHA>
MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACTIVE_VERSION=<exact active Worker version UUID>
MKT_CHATWOOT_PREFLIGHT_WRANGLER_CONFIG=wrangler.sync.jsonc
MKT_CHATWOOT_PREFLIGHT_EXPECTED_BASE_URL_SHA256=<64 lowercase hex>
MKT_CHATWOOT_PREFLIGHT_EXPECTED_ACCOUNT_ID_SHA256=<64 lowercase hex>
CLOUDFLARE_ACCOUNT_ID=<authorized environment only>
CLOUDFLARE_API_TOKEN=<read-only permissions only>
```

สร้าง fingerprint โดยไม่บันทึกค่าจริงลงไฟล์:

```bash
printf %s "$CHATWOOT_BASE_URL" | shasum -a 256
printf %s "$CHATWOOT_ACCOUNT_ID" | shasum -a 256
```

## Commands

Plan only:

```bash
npm run rollout:chatwoot-read-only
```

Executable preflight หลังได้รับ authorization แยก:

```bash
export CONFIRM_CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT=PREFLIGHT_CHATWOOT_REMOTE_READ_ONLY
npm run rollout:chatwoot-read-only:preflight
unset CONFIRM_CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT
```

## Prohibited actions

```text
Chatwoot Provider/API request
Customer Token value read or rotation
Remote D1 backup
Migration 0018 apply
Remote D1 Business write
Remote Lark read/write/schema mutation
Queue send/retry/DLQ action
Worker deployment
Schedule/route/workers.dev mutation
Customer LIVE UAT
Production
PR merge
```

## Acceptance criteria

- Operator defaults to plan-only.
- Executable preflight requires exact confirmation, exact HEAD and clean Working Tree.
- Exact Worker version at 100% traffic is proven from Remote status.
- All six Chatwoot flags are present and false in the active version.
- Base URL and external Account ID match approved SHA-256 fingerprints.
- Required Secret name exists without reading its value.
- Migration `0017` is applied and `0018` is the only pending migration.
- Queue/Cron/workers.dev state matches the protected Integration Workspace.
- Evidence contains zero Remote mutations, zero Provider requests and zero Secret-value reads.
- Unit tests, full repository gates and exact-head Branch Verification pass.
- Remote execution remains a separate authorization after Repository merge.
