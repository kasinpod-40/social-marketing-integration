# Meta D1-only Processing Guarded Rollout Operator

## Status

```text
PROGRAM                             = META_D1_ONLY_PROCESSING_GUARDED_ROLLOUT
CONTRACT_VERSION                    = meta-d1-only-rollout-v1
BRANCH                              = integration/meta-d1-only-rollout-operator
BASE_MAIN_SHA                       = 7f06ae8729dd24c3bd6f548332bfe17ba374c8ab
REMOTE_EXECUTION                    = NOT_AUTHORIZED
PRODUCTION                          = BLOCKED
```

## Objective

เพิ่ม Guarded Operator สำหรับทดสอบ Meta End-to-End แบบ D1-only ทีละ Source หลัง Chemistry K
read-only Provider validation ผ่านครบแล้ว โดยใช้ Runtime, Queue identity, Reliability,
resumable-work, D1 History และ Coverage contracts ที่มีอยู่เดิมทั้งหมด

Operator ต้องทำให้แต่ละ Source มี Backup, deployment provenance, exact operation identity,
D1/Coverage reconciliation, same-operation idempotent rerun และ all-flags-false restore
ของตนเอง โดยไม่เขียน Lark ไม่เปิด Report/Schedule และไม่เปลี่ยน Production

## Approved targets

Operator หนึ่ง Evidence chain เลือกได้เพียง Target เดียว:

```text
facebook
instagram
chemistry_k2
chemistry_k3
```

Target mapping:

| Target | Connector | Job type | Work key |
| --- | --- | --- | --- |
| `facebook` | `facebook` | `facebook.page.organic.sync` | `facebook:<operationId>` |
| `instagram` | `instagram` | `instagram.business.organic.sync` | `instagram:<operationId>` |
| `chemistry_k2` | `meta_ads` | `meta.ads.sync` | `meta_ads:chemistry_k2:<operationId>` |
| `chemistry_k3` | `meta_ads` | `meta.ads.sync` | `meta_ads:chemistry_k3:<operationId>` |

ทุก Job ใช้:

```text
trigger=manual_uat
dryRun=false
d1Only=true
generation=originalRequestedAt
```

## Existing Runtime reused

- `createMetaTokenConnectionRuntime()`
- `createMetaEndToEndJobRouter()`
- `processJobWithMetaEndToEnd()`
- `processMetaEndToEndSync()`
- `processMetaEndToEndGeneration()`
- `createStableQueueOperationBody()`
- `runReliableSync()`
- `D1ResumableWorkStore`
- `D1MarketingHistoryStore`
- `D1OrganicHistoryGateway`
- existing Queue retry/continuation/DLQ ownership
- existing Storage Foundation and Coverage tables from Migration `0009`

ไม่มี Meta Connector, Graph client, Queue framework, Reliability runner, resumable store,
D1 writer, Coverage engine หรือ Lark sync engine ชุดใหม่

## D1-only boundary

Runtime เดิมทำงานตามลำดับ:

```text
bounded Provider GET
→ durable source staging
→ D1 write phase
→ Coverage
→ lark_gate_disabled
```

เมื่อ D1 phase จบและ `MKT_META_LARK_WRITE_ENABLED=false`:

- `sync_runs.status=success`;
- `meta_end_to_end_d1_write_v1.complete=1`;
- ไม่มี `meta_end_to_end_lark_write_v1`;
- ไม่มี `meta_end_to_end_completion_v1`;
- Work lifecycle ยังเป็น `active` และ `completed_at` เป็น `NULL`;
- ไม่มี active lock;
- Coverage ของ operation ต้องไม่มี failed row และใช้สถานะที่ยอมรับได้;
- Operator ต้องถือ boundary นี้เป็น D1-only success ไม่ใช่ full end-to-end completion

## Approved flag window

Safe configuration ต้องมี execution flag ทุกตัวเป็น `false`

Active configurationเปิดได้เพียงสาม Flag:

```text
<selected connector flag>=true
MKT_META_SOURCE_READ_ENABLED=true
MKT_META_D1_WRITE_ENABLED=true
```

ตลอด Active window ต้องคง:

```text
MKT_META_LARK_WRITE_ENABLED=false
MKT_META_REPORT_READ_ENABLED=false
all schedules=false
all unrelated connectors=false
MKT_DLQ_REDRIVE_ENABLED=false
Production=false
```

Operator สร้าง Active config ชั่วคราวจาก Safe config และตรวจ normalized diff ว่ามีเฉพาะสาม Flag
ที่ได้รับอนุมัติ Active config ชั่วคราวต้องถูกลบทันทีหลังคำสั่ง Wrangler จบ

## Read-only validation prerequisite

Preflight ต้องอ่าน sanitized `summary.json` ของ contract
`meta_read_only_validation_v1` และตรวจว่า:

- `accepted=true`;
- `validationCount=4`;
- Facebook, Instagram, ChemistryK2 และ ChemistryK3 เป็น `identity_validated`;
- target เป็น `development / integration_workspace / chemistry_k`;
- execution/schedule flags เป็น false;
- business writes และ Queue messages เป็นศูนย์

Summary SHA-256 ถูกผูกเข้ากับ D1-only target fingerprint แต่ Token และ raw secret ไม่ถูกอ่านหรือ
persist ใน Evidence

## Operator phases

```text
plan
preflight
backup
deploy-safe-baseline
verify-safe-baseline
deploy-d1-only-gates
verify-d1-only-deployment
snapshot-before
send-one-d1-only
verify-d1-only
resend-same-operation
verify-idempotent-rerun
restore-all-false
verify-restore
summary
```

ทุก executable phase มี confirmation token แยกและ Evidence SHA-256 ต่อ chain

## Preflight requirements

- exact reviewed full Git SHA;
- clean Working Tree;
- exact Worker, D1, main Queue, DLQ, environment/profile/customer identity;
- current Worker มี Active version เดียวที่ traffic 100%;
- local Safe และ generated Active bundle dry-run ผ่าน;
- required Worker Secret name มีอยู่ โดยอ่านเฉพาะชื่อ;
- Storage Foundation/Operational tables ที่ต้องใช้มีครบ;
- operationId/workKey/syncRunId ใหม่และยังไม่ถูกใช้;
- ไม่มี active scoped lock;
- pending migrations ต้องว่าง หรือมีเพียง unrelated Chatwoot `0018_chatwoot_analytics.sql`;
- ไม่มี Provider request หรือ Remote mutation

## Backup

ก่อน Deploy หรือ Queue send ต้อง export Remote D1 แบบ read-only ลง private local Evidence directory
และเก็บขนาดกับ SHA-256 Operator ไม่ apply migration และไม่ใช้ Backup เป็นข้ออ้างให้ลบข้อมูล

## Queue and continuation contract

Operator ส่ง initial Queue message ครั้งเดียวและเก็บ attempt record ก่อนเรียก Cloudflare API
เพื่อป้องกัน accidental resend

Source/D1 continuation หลังจากนั้นเป็นของ Shared Worker และ Shared Queue ตาม Runtime เดิม
Operator ไม่ส่ง continuation เอง

หลัง D1-only verification ผ่าน Operator ส่ง same exact operation อีกครั้งเพียงครั้งเดียวเพื่อพิสูจน์:

- Queue attempt เพิ่ม;
- target Business counts ไม่เปลี่ยน;
- operation-scoped Business counts ไม่เปลี่ยน;
- Coverage run/entity counts ไม่เปลี่ยน;
- ไม่มี Lark/completion phase;
- ไม่มี active lock

## D1 and Coverage scope

Existing D1 targets:

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
ads_entity_state
ads_daily_facts
data_coverage_runs
data_coverage_entities
```

Verification ใช้ exact `syncRunId`, `workKey`, `customerKey`, `platform` และ `accountKey`
เพื่อไม่รวม Business facts ของ Source อื่น

Coverage ต้องมี `failed_rows=0` และสถานะอยู่ใน:

```text
complete
no_data_confirmed
revisable
```

## Restore

`restore-all-false` ต้องใช้งานได้หลัง Active deployment แม้ Send/Verify ล้ม โดยผูกกับ Activation
Evidence ที่หาได้ล่าสุด หลัง Restore ต้องตรวจ Remote Active version, Flag set และ Queue topology ใหม่

## Evidence safety

Evidence ห้ามเก็บ:

- Token, Authorization header, password หรือ secret value;
- raw config, raw URL/origin หรือ raw Provider response;
- Cloudflare API token;
- payload ข้อมูลลูกค้า

Evidence อนุญาตเฉพาะ sanitized target, fingerprints, counts, statuses, version IDs,
operation aliases และ command output hashes

## Out of scope

```text
Remote execution during implementation
Remote D1 mutation
Queue send
Worker deployment
Lark preflight/write
Report read/materialization
Schedule activation
DLQ redrive
Retention/delete
Production
PR merge
```

## Acceptance criteria

- plan-only เป็น default;
- exact per-phase confirmations;
- one-target-per-chain;
- exact read-only summary prerequisite;
- exact three-flag active window;
- Safe/Active config diff fail-closed;
- stable Queue identity จาก Shared contract;
- D1-only completion classification ถูกต้อง;
- Coverage failure ถูก block;
- Lark/completion phase ถูก block;
- same-operation rerun zero count drift;
- evidence hashing/tamper detection;
- guarded all-false restore;
- Unit, Workers, architecture, reliability, audit และ Wrangler dry-run ผ่าน;
- ไม่มี Remote action ระหว่าง Implementation

## Required verification

```bash
npm ci
node --test tests/application/meta-d1-only-rollout-operator.test.js
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Remote phases ต้องได้รับ explicit approval ใหม่หลัง PR review และ merge เท่านั้น
