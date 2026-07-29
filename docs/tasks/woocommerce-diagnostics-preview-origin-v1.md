# WooCommerce Diagnostics Deterministic Preview Origin Hotfix v1

## Status

```text
TASK_STATUS                     = READY_FOR_CI
BASE_MAIN_SHA                   = 78aaf1416f5f7fc528c0c4bbfc2da409bb169a34
REQUIRED_ANCESTOR               = 1002cc9cfad0f07fdd1103f2601d642339e08686
BRANCH                          = codex/woocommerce-diagnostics-preview-origin-v1
REMOTE_ACTION_DURING_IMPL       = 0
LIVE_RERUN                      = NOT_AUTHORIZED
PRODUCTION_DEPLOYMENT           = UNCHANGED
```

## Live evidence และ Safe state

หลักฐาน Live ล่าสุดหลัง Queue sentinel fix ยืนยันว่า Cloudflare รับทั้ง Active Preview และ
automatic Safe Preview upload สำเร็จ แต่ operator หยุดก่อน Provider request เพราะ Wrangler
4.110.0 structured `version-upload` record ไม่มี URL ใน array shape ที่ parser เดิมรองรับ:

```text
code                         WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID
workerVersionUploadCount     2
previewUrlCount              0
aliasedPreviewUrlCount       0
providerRequestAttemptCount  0
providerRequestCount         0
providerMutationCount        0
businessMutationCount        0
queueMessageCount            0
larkRequestCount             0
scheduleMutationCount        0
productionBaselineVersion    8284c076-49ed-4ffc-bba9-f2e0839aa1c5
productionDeployment         unchanged
previewUrlsRestored          true
workersDevRestoredDisabled   true
previewSettingMutations      2
productionTrafficChange      false
```

ค่าชุดนี้เป็นหลักฐาน Incident เดิม ไม่ใช่ Remote read ใหม่ระหว่าง Implementation.

## Root cause

`scripts/lib/woocommerce-diagnostics-preview-upload.js` เดิมยอมรับ upload เมื่อมี
`version-upload` exactly one และ Worker version ID ถูกต้อง แต่บังคับให้หา Preview URL จาก
array fields `preview_urls`, `previewUrls`, `targets` หรือ `urls`. เมื่อ Wrangler output ไม่มี
URL ใน shape เหล่านั้น operator จึงรายงาน URL invalid ทั้งที่ Worker Version upload สำเร็จ.

## Deterministic origin contract

Preview origin สร้างจากข้อมูลที่ตรวจสอบแล้วเท่านั้น:

```text
https://<PREVIEW_ALIAS>-<WORKER_NAME>.<ACCOUNT_WORKERS_DEV_SUBDOMAIN>.workers.dev
```

Contract:

- Preview alias, Worker name และ account workers.dev subdomain ต้องเป็น lowercase DNS-safe
  label;
- combined `<PREVIEW_ALIAS>-<WORKER_NAME>` ต้องยาวไม่เกิน 63 characters;
- protocol ต้องเป็น `https`;
- structured Wrangler output ยังเป็น authority สำหรับ `version-upload` exactly one และ
  Worker version ID ที่ถูกต้อง;
- Wrangler URL เป็น optional cross-check: ไม่มี URL ได้, URL ที่ parse ได้ต้องตรง deterministic
  origin ทุกตัว, malformed/custom-domain/HTTP/mismatch/ambiguous evidence ต้อง fail closed;
- success/error/evidence ไม่พิมพ์ raw origin หรือ raw account subdomain; เปิดเผยได้เฉพาะ SHA-256
  fingerprint และจำนวน cross-check.

Active, normal Safe และ automatic Safe ใช้ alias, Worker name และ account subdomain ชุดเดียวกัน
จึง probe origin เดียวกันแบบ deterministic. Provider diagnostic ยังคงถูกจำกัดไว้ไม่เกินหนึ่ง
authenticated GET.

## Account subdomain API

Existing Preview URL window wrapper เป็นเจ้าของ read-only lookup หลัง resolve account/auth เดิม:

```http
GET /accounts/{account_id}/workers/subdomain
```

Response ต้องมี `success=true` และ exact `result={subdomain:"<dns-label>"}`. Wrapper:

- ใช้ bearer auth ที่ resolve แล้วโดยไม่สร้าง auth resolver ใหม่;
- ไม่ส่ง request body และไม่ใช้ mutation method;
- ไม่พิมพ์หรือ persist account ID, bearer token, raw response หรือ raw subdomain;
- ส่งต่อเฉพาะ validated label ผ่าน
  `MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN`;
- ไม่ inject token ที่ได้จาก wrapper auth resolver เข้า child env ใหม่; child คงใช้ Wrangler auth
  environment เดิมตามที่จำเป็น.

## Command-failed evidence correction

Evidence launcher แยกสองความหมาย:

```text
capturedOutputFileCount = จำนวน ephemeral output files ที่อ่านได้
failures                = เฉพาะ file ที่มี command-failed อย่างน้อยหนึ่ง record
```

Successful `version-upload` ไม่ถูกนับเป็น failure และ child exit nonzero จาก application-level
error ไม่สร้าง Wrangler failure ปลอม. Raw stdout/stderr/NDJSON ยังคงไม่ persist และ redaction
contract เดิมไม่ลดลง.

## Runtime isolation retained

- Preview-only Queue sentinel ยังคง `batch.retryAll()` exactly once โดยไม่ ack/read/process;
- Active/Safe configs ไม่มี Production routes, Queue config, Cron, D1, Lark, storage หรือ
  Business bindings;
- Production active version และ flags ยังถูก pin/check ก่อน ระหว่าง และหลัง diagnostics;
- ไม่มี `wrangler deploy`, Queue send, Remote D1/Lark, Schedule หรือ Secret mutation path เพิ่ม;
- implementation/tests ใช้เฉพาะ local parsing, generated-config dry-run และ runtime simulation.

## Verification

Required verification:

```text
Focused Node behavior tests
Focused Workers-runtime Queue sentinel regression
npm run check
npm test
npm run test:report-reliability
npm audit
Active generated Preview config dry-run
Safe generated Preview config dry-run
npm run deploy:dry-run
Branch Verification on exact PR head
```

## Remote boundary

Implementation และ CI นี้ทำ Remote action เท่ากับ `0`:

```text
Preview URL mutation       0
Worker Version upload      0
Worker deployment          0
Provider request           0
Queue message              0
Remote D1 write/migration  0
Lark request/mutation      0
Secret mutation            0
Schedule mutation          0
Production traffic change  0
```

Live rerun, Preview URL setting window, Version upload, Provider diagnostic, Merge และ
Production action ไม่ได้รับอนุญาตจากงานนี้.

## Remaining risks

- Repository tests/dry-run ไม่พิสูจน์ account subdomain response และ deterministic origin กับ
  Live tenant จนกว่าจะมี authorization แยกหลัง Merge.
- หาก Cloudflare เปลี่ยน account subdomain response shape หรือ Wrangler ส่ง parseable URL
  ที่ไม่ตรง contract operator จะ fail closed ก่อน Provider request.
- Preview URL setting ยังเป็น temporary public window ตาม contract เดิมและต้อง restore ใน
  `finally`.
- Queue sentinel อาจเพิ่ม delivery attempt หาก Preview Version ถูกผูกเป็น consumer โดยไม่ตั้งใจ;
  sentinel ไม่ ack แต่ Queue retry/DLQ policy เดิมยังมีผล.

## Rollback

Revert Hotfix commit เพื่อคืน parser ที่ต้องพึ่ง Wrangler URL array และถอด account-subdomain
lookup/evidence filter tests. Rollback จะทำให้ Incident `previewUrlCount=0` กลับมาอีก และไม่ใช่
เหตุอนุญาต Live rerun, Preview setting mutation หรือ Production change.
