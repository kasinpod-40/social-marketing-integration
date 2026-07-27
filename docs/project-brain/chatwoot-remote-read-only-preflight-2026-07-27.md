# Chatwoot Remote Read-only Preflight — 2026-07-27

## Repository status

```text
WORKSTREAM                  = CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT
BASE_MAIN                   = f3e330339b114536c3a1a9ee7567abf5a76fa78b
BRANCH                      = integration/chatwoot-remote-read-only-preflight
RUNTIME_PR                  = #97 / MERGED
CLOSEOUT_PR                 = #108 / MERGED
MIGRATION_0017              = APPLIED / DO_NOT_RERUN
MIGRATION_0018              = SOURCE_ONLY / EXPECTED_PENDING
REMOTE_EXECUTION            = NOT_RUN
REMOTE_MUTATION             = NONE
PRODUCTION                  = BLOCKED
```

## Decision

ก่อน Backup หรือ Apply Migration `0018_chatwoot_analytics.sql` ต้องมี Remote preflight ที่ใช้
Remote responses จริงและอ่านอย่างเดียว. Local `wrangler.sync.jsonc` หรือ example config ไม่ใช่
หลักฐานว่า active Worker ปลอดภัย.

เพิ่ม Operator contract:

```text
chatwoot-remote-read-only-preflight-v1
plan → preflight
```

Default คือ `plan`; phase `preflight` ต้องใช้ `--execute`, exact confirmation, exact reviewed Git
HEAD และ clean Working Tree.

## Remote evidence required

- active Worker version ตรง expected version ที่ traffic 100%;
- all six Chatwoot Connector/D1/Lark/Report/Schedule/Webhook flags เป็น false;
- Chatwoot Base URL และ external Account ID ตรง approved SHA-256 fingerprints;
- `CHATWOOT_API_ACCESS_TOKEN` มีอยู่ใน Secret-name list โดยไม่อ่านค่า;
- Migration `0017` อยู่ใน applied ledger;
- Migration `0018` ยังไม่ applied และเป็น pending migration เพียงรายการเดียว;
- Main Queue/DLQ มี Consumers;
- Worker script มีอยู่, Cron ตรง contract และ workers.dev ปิด;
- local strict dry-run bundle มี SHA-256;
- Evidence ระบุ Remote mutation, Provider request และ Secret-value read เป็นศูนย์.

## Safety boundary

Operator ไม่มี path สำหรับ:

```text
Chatwoot Provider/API request
Secret value read/rotation
Remote D1 backup/write/migration apply
Remote Lark request/mutation
Queue send/retry/DLQ
Worker deploy
Schedule/route/workers.dev mutation
LIVE UAT
Production
```

Cloudflare API token ใช้เฉพาะ read-only metadata requests และไม่ถูกบันทึก. Raw Worker vars,
Base URL, Account ID, account ID ของ Cloudflare, Authorization header และ raw response body ห้ามอยู่
ใน Evidence.

## Files

```text
scripts/chatwoot-read-only-preflight-operator.mjs
scripts/lib/chatwoot-read-only-preflight-operator.js
tests/application/chatwoot-read-only-preflight-operator.test.js
docs/tasks/chatwoot-remote-read-only-preflight.md
```

## Remaining gate

Repository implementation ต้องผ่าน focused/full verification และ Draft PR review ก่อน. แม้ Merge
แล้วก็ยังไม่อนุญาต Remote run. Actual preflight ต้องได้รับ authorization แยกและรันใน Environment
ที่มี exact target inputs กับ read-only Cloudflare credentials.
