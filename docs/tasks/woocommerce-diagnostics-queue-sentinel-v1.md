# WooCommerce Provider Diagnostics Queue Sentinel Hotfix v1

## Status

```text
TASK_STATUS                     = READY_FOR_FINAL_DOCS_CI
BASE_MAIN_SHA                   = 142d742fd27df9fdd1728a371836dd395dcc88ea
REQUIRED_ANCESTOR               = ab56882e691f93678ee56fbac2cb12f5c8ee95fc
BRANCH                          = codex/woocommerce-diagnostics-queue-sentinel-v1
IMPLEMENTATION_HEAD             = 08fe830c4e38664d2210bcb97d52ee1739bb9ba9
IMPLEMENTATION_PR               = #247 / DRAFT
BRANCH_VERIFICATION             = #1070 / 30471168454 / PASS
REMOTE_ACTION_DURING_IMPL       = 0
LIVE_RERUN                      = NOT_AUTHORIZED
PRODUCTION_DEPLOYMENT           = UNCHANGED
```

## Incident และ Root cause

Cloudflare ปฏิเสธทั้ง Active Preview และ automatic Safe Preview ก่อนสร้าง Worker Version:

```text
code     11001
detail   Queue handler is missing.
```

Root cause ที่ยืนยันจาก Live diagnostics คือ
`apps/sync-worker/src/woocommerce-provider-diagnostics-entry.js` มีเฉพาะ `fetch` handler
ขณะที่ Worker `social-mkt-sync-worker` ถูกลงทะเบียนเป็น Cloudflare Queue consumer.
Cloudflare จึงไม่รับ Worker Version ที่ไม่มี modules-format `queue` handler แม้ Preview config
จะไม่ได้ประกาศ `queues`.

## Safe Live state ก่อน Implementation

```text
previewUrlsRestored        true
workersDevRestoredDisabled true
productionDeployment       unchanged
productionBaselineVersion  8284c076-49ed-4ffc-bba9-f2e0839aa1c5
workerVersionUploadCount   0
providerRequestCount       0
providerMutationCount      0
businessMutationCount      0
queueMessageCount          0
larkRequestCount           0
scheduleMutationCount      0
```

ค่าชุดนี้เป็น Incident evidence เดิม ไม่ใช่การอ่าน Remote state ใหม่ระหว่าง Implementation.

## Sentinel behavior

Preview-only entrypoint เพิ่ม fail-closed handler:

```js
async queue(batch) {
  batch.retryAll();
}
```

Contract:

- เรียก `batch.retryAll()` exactly once;
- ไม่เรียก `batch.ackAll()` หรือ message-level `ack()`;
- ไม่อ่าน body/metadata และไม่วนประมวลผล Queue messages;
- ไม่ import หรือเรียก `routeQueueBatch`, `createSyncWorker`, Business job router,
  Infrastructure หรือ Operational Store;
- ไม่เรียก Provider, D1, Lark, Queue producer, Schedule หรือ Business processing;
- ไม่มี `scheduled` handler;
- `fetch` diagnostics route เดิมคง behavior และ no-store fallback.

หาก Preview Version ถูกผูกกับ Queue consumer โดยไม่ตั้งใจ ข้อความทั้ง batch จะถูกขอ retry
แทนการ acknowledge จึงไม่สูญหายจาก sentinel. Queue retry/DLQ policy ของ consumer เดิมยังเป็น
ผู้กำหนดจำนวนครั้งและปลายทางสุดท้าย; sentinel ไม่เปลี่ยน policy นั้น.

## Preview config isolation

Active และ Safe configs ยังคง:

- ไม่มี `queues`, routes, triggers/crons, D1, Durable Object, KV, R2, service, workflow,
  analytics หรือ asset bindings;
- ใช้ Preview-only entrypoint;
- มีเพียง Secret names `WOOCOMMERCE_CONSUMER_KEY` และ
  `WOOCOMMERCE_CONSUMER_SECRET` โดยไม่คัดลอกค่า;
- มีเฉพาะ target identity, WooCommerce non-secret source และ diagnostics vars ที่จำเป็น;
- Active มี diagnostics flag, attestation และ one-time token digest;
- Safe มี diagnostics flag `false`, Safe attestation และไม่มี token digest;
- ไม่เปลี่ยน Production routes, Queue consumer configuration หรือ Production deployment.

## Verification

Focused Node tests ตรวจ export, exact retry, no ack, no message access, import isolation,
ไม่มี `scheduled`, fetch regression และ config isolation. Workers-runtime test ใช้
Cloudflare `MessageBatch` จริงเพื่อยืนยัน whole-batch retry โดยไม่มี explicit ack.
Active/Safe generated configs ผ่าน `wrangler versions upload --dry-run`.

ผล local verification:

```text
Focused diagnostics Node                       26/26 PASS
Focused Workers-runtime file                   12/12 PASS
Syntax / architecture / repository hygiene     PASS
Full Node Unit/Integration                     1438/1438 PASS
Full Workers runtime                           15/15 PASS
TikTok/Core/Report regression                  PASS
Report reliability                            100/100 PASS
Dependency audit                              0 vulnerabilities
Active diagnostic config dry-run              PASS / no upload
Safe diagnostic config dry-run                PASS / no upload
Repository deployment dry-runs                PASS / no deployment
```

`npm test` ผ่าน Unit ทั้งหมดก่อน Workers runtime ถูก restricted sandbox ปฏิเสธ Wrangler log
และ localhost ด้วย `EPERM`; full Workers suite ผ่านเมื่อ rerun นอก restricted sandbox.
Branch Verification `#1070 / 30471168454` ผ่านทุก step บน Implementation head
`08fe830c4e38664d2210bcb97d52ee1739bb9ba9`. Docs-only closeout head ต้องผ่าน
Branch Verification รอบสุดท้ายก่อน Mark PR Ready for Review.

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

Live rerun ไม่ได้รับอนุญาตจาก Hotfix นี้.

## Remaining risks

- Repository tests และ dry-run พิสูจน์ module/config contract แต่ไม่พิสูจน์ว่า Cloudflare
  จะรับ Live Preview Version จนกว่าจะมี authorization แยกหลัง Merge.
- หาก Preview Version ถูกผูกเป็น consumer จริง sentinel จะ retry ทุก message; การเปิดทิ้งไว้นาน
  อาจเพิ่ม delivery attempts และทำให้ข้อความไป DLQ ตาม policy เดิม แม้ไม่มี message ถูก ack.
- WooCommerce Provider response incident เดิมยังไม่ถูกวินิจฉัยต่อ เพราะ Provider request
  ระหว่าง Implementation เป็นศูนย์.

## Rollback

Revert commit ของ Hotfix นี้เพื่อถอด Queue sentinel, focused tests และ config allowlist.
Rollback จะคืนพฤติกรรมก่อนหน้า ซึ่ง Cloudflare ปฏิเสธ Preview Version ด้วย code `11001`;
ห้ามแก้ Queue consumer configuration หรือใช้ rollback เป็นเหตุอนุญาต Live rerun.
