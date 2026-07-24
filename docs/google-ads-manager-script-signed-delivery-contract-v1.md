# Google Ads Manager Script Signed Delivery Contract v1

## Status and authority

```text
CONTRACT_ID       = google_ads_manager_script_signed_delivery_v1
CONTRACT_STATUS   = APPROVED_2026_07_25
IMPLEMENTATION    = PHASE_1_LOCAL_FOUNDATION_COMPLETE
LIVE_DELIVERY     = DISABLED
BUSINESS_WRITES   = DISABLED
SCHEDULE          = DISABLED
PRODUCTION        = BLOCKED
```

เอกสารนี้กำหนด Transport, Security, Dataset, Identity, Idempotency,
Reliability, Storage และ Rollout ของ Google Ads Manager Script signed delivery
บน `main` ปัจจุบัน การอนุมัติครอบคลุม Local Phase 1: sanitized Script artifact,
Central Connector/Job แบบ `planned` และ pure signed-ingress contract/security
tests เท่านั้น เอกสารนี้ยังไม่อนุญาตให้เพิ่ม Live Endpoint, Migration, Queue
send, Business writer, Secret, Schedule, Deployment หรือ Live request จนกว่า
Boundary ถัดไปจะได้รับการอนุมัติแยกต่างหาก

Draft PR `#17` เป็นหลักฐานเปรียบเทียบเท่านั้น ห้าม merge, cherry-pick หรือใช้เป็น
Implementation baseline เพราะใช้ RAW lineage และ Reliability model รุ่นเก่า

## Objective

รับข้อมูลแบบ read-only จาก Google Ads Manager Script ของบัญชีโฆษณาที่กำหนด
ผ่าน HTTPS + HMAC, ประกอบหก Dataset แบบหลาย Chunk อย่างทน Retry, แล้วส่ง
Reference-only Queue job เข้าสู่ Reliability stack กลางเพื่อเขียน D1-first และ
Shared Lark tables แบบ Idempotent

```text
Manager Script read-only GAQL
→ deterministic dataset rows
→ bounded signed chunks
→ API Worker validation and D1 transport staging
→ exactly-once Queue admission by run identity
→ Sync Worker + shared lock/generation/checkpoint
→ D1 Ads history + Coverage
→ Shared RAW and Canonical Lark upsert
→ reconciliation and terminal audit
```

## Non-goals

- ไม่มี Google Ads create/update/pause/enable/remove หรือ Spend mutation
- ไม่มี direct Google Ads API ingestion ใน v1
- ไม่มี OAuth callback หรือ Customer Connection change
- ไม่มี separate RAW Google tables
- ไม่มี Asset Group, Audience, Keyword, Search term หรือ Conversion-action grain
- ไม่มี Schedule/Cron
- ไม่มี automatic Production cutover
- ไม่มี Lark Schema/View/Formula Apply
- ไม่มีการรวมโค้ดจาก Draft PR `#17`

## Source and reproducibility boundary

Manager Script ต้อง:

- เลือกบัญชีโฆษณาเพียงบัญชีเดียวจาก allowlist ที่กำหนด;
- ตรวจ selected account ซ้ำหลัง `AdsManagerApp.select(...)`;
- ใช้ `AdsApp.search()` และ GAQL แบบ read-only เท่านั้น;
- ไม่มี Builder, mutate, pause, enable, remove, Spreadsheet, Mail หรือ trigger API;
- เริ่มต้นที่ `DRY_RUN`;
- รองรับ `PREVIEW` และ manual one-shot `LIVE` เท่านั้น;
- หยุดแบบ fail-closed เมื่อ Dataset ถูกตัด, Query ล้ม หรือ Identity ไม่ตรง

ก่อนเปิด Signed delivery ต้อง Commit อย่างน้อยหนึ่ง Artifact ที่ทำซ้ำได้:

1. Sanitized Script source ที่แทน Customer-specific value ด้วย Placeholder; และ
2. SHA-256, Script version, exact GAQL manifest และ safety-scan result

Artifact ห้ามมี Customer ID จริง, Secret, Token, Login identity หรือ Sample row
จริง

## Environment and ownership

Integration Workspace ใช้ Runtime เดียว:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

- `customerKey` มาจาก Customer Profile กลาง
- `accountKey` มาจาก Google Ads Connector config กลาง
- Manager/Advertiser Customer ID มาจาก Environment mapping และไม่อยู่ใน Log
- Signing secret อยู่ใน Google Ads Script Properties และ Cloudflare Secret
- Production ใช้ Profile/Worker/D1/Queue/Lark/Secret ที่ลูกค้าเป็นเจ้าของ
- Historical label `uat_chemistry_k` ไม่ใช่ Environment แยก

## HTTP transport

Endpoint:

```text
POST /v1/google-ads/manager-script/deliveries
Content-Type: application/json
```

URL ต้องเป็น HTTPS, Path ต้องตรงทั้งหมด และห้ามมี Query string หรือ Fragment

### Required headers

| Header | Contract |
| --- | --- |
| `x-mkt-key-id` | 1–64 ตัวอักษร `[A-Za-z0-9._-]` |
| `x-mkt-timestamp` | Unix seconds จำนวน 10 หลัก |
| `x-mkt-nonce` | Base64URL ไม่มี padding ของ CSPRNG 16 bytes; 22 ตัวอักษร |
| `x-mkt-idempotency-key` | `google-ads:{runId}:{datasetKey}:{chunkIndex}` |
| `x-mkt-content-sha256` | SHA-256 ของ exact body bytes แบบ lowercase hex 64 ตัว |
| `x-mkt-signature` | `sha256={lowercase HMAC hex 64 ตัว}` |

Header ต้องปรากฏครั้งเดียว Missing, Empty, Duplicate หรือ Comma-joined value
ถูกปฏิเสธแบบ Permanent

### Digest and signature

Canonical signing input มีเจ็ดบรรทัด ไม่มี Trailing newline:

```text
MKT-HMAC-SHA256-V1
POST
/v1/google-ads/manager-script/deliveries
<x-mkt-timestamp>
<x-mkt-nonce>
<x-mkt-idempotency-key>
<x-mkt-content-sha256>
```

- Signature ใช้ HMAC-SHA-256 บน UTF-8 bytes
- Body ใช้ deterministic JSON: UTF-8, ไม่มี BOM, Object key เรียง
  Lexicographic, Array คงลำดับ, ไม่มี `undefined`, `NaN`, `Infinity` หรือ `-0`
- Worker ตรวจด้วย Web Crypto และ Constant-time verify
- HMAC ให้ Integrity/Authenticity แต่ไม่ให้ Confidentiality; HTTPS จึงเป็นข้อบังคับ
- Raw body, Header, Customer ID, URL, Name และ Signature ห้ามเข้า Log/Error

### Key rotation

Runtime รองรับ Current และ Previous key พร้อมกัน:

```text
MKT_GOOGLE_ADS_SIGNING_KEY_ID
MKT_GOOGLE_ADS_SIGNING_SECRET
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET
```

- Secret แต่ละตัวต้องมี Entropy อย่างน้อย 256 bits
- Key ID ไม่เป็น Secret แต่ Log ได้เฉพาะผล Resolve แบบ Boolean
- Previous key ถูกถอดหลัง Manual UAT ด้วย Current key ผ่าน
- DEV และ Production ห้ามใช้ Secret ชุดเดียวกัน

## Replay and request idempotency

- Timestamp skew ยอมรับไม่เกิน `±300` วินาที
- Nonce เก็บเป็น SHA-256 fingerprint เท่านั้น
- Nonce fingerprint ถูก Reserve แบบ Atomic หลัง HMAC ผ่าน
- Nonce retention อย่างน้อย `900` วินาที
- Retry ใช้ Body และ Idempotency key เดิม แต่ Timestamp/Nonce/Signature ใหม่
- Key เดิม + Body digest เดิมคืนสถานะเดิมแบบ Idempotent
- Key เดิม + Body digest ต่างกันเป็น `409` Permanent conflict
- Nonce ซ้ำถูกปฏิเสธ แม้ Body เดิม
- Run ที่ประกอบครบถูก Queue ได้ครั้งเดียวด้วย Atomic transition

## Run and chunk envelope

หนึ่ง HTTP request บรรจุหนึ่ง Dataset chunk:

```json
{
  "schemaVersion": "google_ads_manager_script_signed_delivery_v1",
  "runId": "00000000-0000-4000-8000-000000000000",
  "mode": "PREVIEW",
  "runStartedAt": "2026-01-01T00:00:00.000Z",
  "fetchedAt": "2026-01-01T00:00:01.000Z",
  "managerCustomerId": "0000000000",
  "customerId": "0000000000",
  "customerKey": "profile-derived-value",
  "accountKey": "connector-derived-value",
  "sourceTimezone": "Area/City",
  "manifest": {
    "account": { "totalRows": 1, "chunkCount": 1 },
    "campaigns": { "totalRows": 0, "chunkCount": 0 },
    "adGroups": { "totalRows": 0, "chunkCount": 0 },
    "ads": { "totalRows": 0, "chunkCount": 0 },
    "youtubeAssets": { "totalRows": 0, "chunkCount": 0 },
    "campaignDailyMetrics": { "totalRows": 0, "chunkCount": 0 }
  },
  "dataset": {
    "key": "account",
    "chunkIndex": 0,
    "chunkCount": 1,
    "totalRows": 1,
    "rows": []
  }
}
```

Unknown fields ถูกปฏิเสธทุกระดับ Manifest ต้องเหมือนกันทุก Chunk ใน Run เดียวกัน
และ `dataset.chunkCount/totalRows` ต้องตรง Manifest

- `runId` เป็น UUID v4 และคงเดิมทั้ง Run
- `mode` เป็น `PREVIEW` หรือ `LIVE` และคงเดิมทั้ง Run
- `runStartedAt` เป็น UTC RFC3339 millisecond timestamp และคงเดิมทั้ง Run
- `fetchedAt` เป็น UTC RFC3339 millisecond timestamp ของ Chunk นั้น โดยต้องไม่
  ก่อน `runStartedAt` และไม่เกินเวลารับเกิน Clock-skew contract
- Identity, Timezone และ Manifest คงเดิมทุก Chunk

### Bounds

```text
maximum exact body bytes       = 524,288
maximum rows per chunk         = 500
maximum chunks per run         = 64
run assembly window            = 2 hours
transport payload retry window = 7 days for failed runs only
```

Dataset caps ใน v1 ยึดขอบเขตที่ผ่าน read-only UAT:

| Dataset | Maximum rows |
| --- | ---: |
| `account` | 1 |
| `campaigns` | 500 |
| `adGroups` | 2,000 |
| `ads` | 5,000 |
| `youtubeAssets` | 5,000 |
| `campaignDailyMetrics` | 10,000 |

เมื่อเกิน Cap, Body size, Chunk count หรือ Script time budget ต้อง Fail ทั้ง Run
ด้วย `truncated=true` ใน Local sanitized result และห้ามส่ง Signed Run

Dataset ที่ว่างใช้ `totalRows=0`, `chunkCount=0` และไม่มี Chunk ของ Dataset นั้น
แต่ Manifest ยังต้องมีครบหก Dataset ส่วน `account` ต้องมีหนึ่ง Row เสมอ

## Exact dataset schemas

ทุก Object ปฏิเสธ Unknown field ค่าที่ Source ไม่ส่งหรือไม่รองรับเป็น `null`
Observed zero คงเป็น `0`

### `account`

```text
customerId, descriptiveName, currencyCode, timeZone, status,
isManager, isTestAccount, resourceName
```

- `customerId` ต้องตรง Environment advertiser mapping
- `timeZone` ต้องตรง `sourceTimezone`
- `isManager=false`
- `currencyCode` เป็นตัวพิมพ์ใหญ่สามตัว

### `campaigns`

```text
campaignId, campaignName, status, primaryStatus, servingStatus,
advertisingChannelType, advertisingChannelSubType, startDate, endDate,
biddingStrategyType, campaignBudgetId, campaignBudgetResourceName, resourceName
```

- เรียง Numeric `campaignId`
- ID ไม่ซ้ำ
- `startDate/endDate` เป็น `YYYY-MM-DD` หรือ `null`
- v1 GAQL ส่ง `startDate/endDate=null` จนกว่าจะมี Live Script evidence ใหม่

### `adGroups`

```text
adGroupId, campaignId, adGroupName, status, primaryStatus, type, resourceName
```

- เรียง Numeric `adGroupId`
- ID ไม่ซ้ำ
- `campaignId` ต้องอยู่ใน Dataset `campaigns`

### `ads`

```text
adId, adGroupId, campaignId, adName, status, primaryStatus,
type, finalUrls, displayUrl, resourceName
```

- เรียงด้วย `campaignId`, `adGroupId`, `adId` แบบ Numeric
- Identity `(adGroupId, adId)` ไม่ซ้ำ
- Relation Campaign/Ad Group ต้องตรง
- `finalUrls` เป็น `null` หรือ Array ของ non-empty string ไม่เกิน 20 ค่า

### `youtubeAssets`

```text
assetId, assetName, status, assetType, youtubeVideoId,
youtubeVideoTitle, resourceName
```

- เรียง Numeric `assetId`
- ID ไม่ซ้ำ
- `assetType=YOUTUBE_VIDEO`
- Asset ถูก Normalize เป็น `entity_type=creative`; ไม่ใช่ Organic content

### `campaignDailyMetrics`

```text
metricDate, reportLevel, externalEntityId, campaignId, adGroupId, adId,
advertisingChannelType, advertisingChannelSubType, adChannel, segmentKey,
currency, spendMicros, impressions, clicks, conversions,
conversionValueMicros, videoViews, videoViewRate, averageCpvMicros
```

- เรียง `metricDate`, Numeric `campaignId`
- Identity `(campaignId, metricDate, segmentKey)` ไม่ซ้ำ
- `metricDate` เป็น Account-timezone date
- `reportLevel=campaign`
- `externalEntityId=campaignId`
- `adGroupId/adId=null`
- `segmentKey=all`, `breakdownKey=all`
- `currency` ตรง Account
- Money/count เป็น non-negative safe integer หรือ `null`
- `conversions` เป็น non-negative finite number หรือ `null`
- `videoViewRate` อยู่ในช่วง `0..1` หรือ `null`
- `reach=null` เพราะ Google campaign source v1 ไม่รองรับ
- Aggregate conversion ไม่มี Conversion-action identity จึงไม่เขียน
  `ads_conversion_daily_facts` ใน v1

## Cross-chunk validation

Run ต้องประกอบครบใน D1 ก่อน Business write:

1. Manifest hash เหมือนกันทุก Chunk
2. Chunk index ของแต่ละ Dataset ครบ `0..chunkCount-1`
3. ไม่มี Chunk index ซ้ำที่ Body digest ต่างกัน
4. Sum rows ตรง `totalRows`
5. Total chunks ไม่เกิน 64
6. Global ordering ต่อเนื่องข้าม Chunk
7. ไม่มี Stable identity ซ้ำทั้ง Dataset
8. Parent relations ครบ
9. Identity/Timezone/Currency ตรงทั้ง Run

Incomplete, Expired, Truncated หรือ Cross-chunk mismatch ห้าม Queue

Manager Script ส่งครั้งแรกหนึ่งครั้งและ Retry ไม่เกินสามครั้ง เฉพาะ Network
error, HTTP `429` และ `5xx` ด้วย bounded exponential delay `1/2/4` วินาที
HTTP `4xx` อื่นเป็น Permanent และหยุด Run Retry ทุกครั้งใช้ Body/Idempotency
key เดิมกับ Timestamp/Nonce/Signature ใหม่

## Ingress validation order

ก่อน Queue หรือ Business write:

1. exact method/path และ HTTPS;
2. exact Content-Type และ Header cardinality;
3. body byte limit;
4. body SHA-256;
5. timestamp window;
6. key resolution และ HMAC verification;
7. nonce Atomic reserve;
8. JSON parse และ exact envelope schema;
9. runtime identity match;
10. idempotency header/body match;
11. per-chunk schema/limit/order validation;
12. atomic Run/Chunk reservation;
13. cross-chunk validation เมื่อครบ;
14. atomic Queue admission

Error response มีเฉพาะ bounded code, request status และ opaque `runId`
fingerprint; ไม่คืน Raw provider message

Success/status contract:

- accepted/staged chunk: `202`;
- completed PREVIEW validation: `200`;
- LIVE run accepted/queued หรือ exact retry ที่ยังทำงาน: `202`;
- completed exact retry: `200`;
- invalid method/path/content/schema/auth: `4xx` แบบ Permanent;
- idempotency/manifest/chunk conflict: `409`;
- payload too large: `413`;
- transient ingress dependency failure: `429` หรือ `503`

## D1 transport state

Implementation ต้องเพิ่ม Additive transport tables แยก Grain:

- nonce fingerprints;
- run manifest/status/audit;
- chunk identity/body digest/payload staging

Transport tables ไม่แทน Reliability tables. เมื่อ Run ครบ:

- Queue message ถือ Reference เท่านั้น
- `operationId=runId`
- `workKey=google_ads:{runId}`
- `generation=requestedAt=Date.parse(runStartedAt)`
- Processing ใช้ `sync_work_runs`, `sync_work_phases`,
  `sync_work_units`, generation fence และ distributed lock เดิม

Raw Chunk payload:

- PREVIEW redacted ทันทีหลัง Run validation;
- Completed LIVE redactedหลัง Reconciliation/Completion durable;
- Failed Retryable/Permanent เก็บไม่เกิน 7 วันเพื่อ Controlled redrive;
- Incomplete Run หมดอายุหลัง 2 ชั่วโมงและถูก redact;
- Terminal sanitized audit เก็บ 30 วัน;
- Cleanup เป็น activity-driven จนกว่าจะอนุมัติ Schedule แยก

## Queue and reliability contract

Central Job Catalog เพิ่มชื่อเดียว:

```text
google.ads.manager.signed-delivery.process
```

เริ่มที่ `planned` และเปลี่ยนเป็น `uat_pending` เมื่อ Parser/Store/Normalizer/
Writer tests ผ่าน ห้าม `active` ก่อน Manual Live UAT

Queue payload มีเฉพาะ:

```json
{
  "schemaVersion": 1,
  "type": "google.ads.manager.signed-delivery.process",
  "operationId": "<runId>",
  "workKey": "google_ads:<runId>",
  "generation": 0,
  "originalRequestedAt": 0,
  "requestedAt": "<RFC3339>"
}
```

ไม่มี Raw payload, Customer ID, Signature, Nonce หรือ Secret ใน Queue

Processing ต้องใช้:

- central Job/Connector catalogs;
- shared `runReliableSync`;
- D1 generation fence และ renewable distributed lock;
- `D1ResumableWorkStore` สำหรับ Phase/Chunk checkpoint;
- typed Permanent/Transient errors;
- Main Queue/DLQ และ controlled redrive เดิม;
- Coverage, Sync Log และ System Alert contract เดิม

Invalid auth/schema/identity/relation/idempotency/reconciliation เป็น Permanent
ส่วน D1/Lark/Queue availability, rate limit และ timeout เป็น Retryable

## Destination contract

### D1-first source of history

| Dataset | D1 destination | Grain |
| --- | --- | --- |
| `account` | `ads_entity_state` | account |
| `campaigns` | `ads_entity_state` | campaign |
| `adGroups` | `ads_entity_state` | ad_group |
| `ads` | `ads_entity_state` | ad |
| `youtubeAssets` | `ads_entity_state` | creative |
| `campaignDailyMetrics` | `ads_daily_facts` | campaign × date × all/all |
| all datasets | `data_coverage_runs/entities` | dataset/run/entity |

`ads_conversion_daily_facts` ไม่ถูกเขียนใน v1

Stable keys ฝั่ง D1 ใช้ Storage Contract กลาง:

```text
entity = google_ads:{accountKey}:{entityType}:{externalEntityId}
daily  = google_ads:{accountKey}:campaign:{campaignId}:{metricDate}:all:all
```

Row fingerprint ใช้ deterministic normalized row ที่ตัด `fetchedAt`,
`syncRunId` และ transport metadata ออก Rerun เดิมต้อง `skipped` หรือ update เฉพาะ
Audit ที่ Contract อนุญาต และห้ามสร้าง Duplicate

### Shared RAW Lark

| Dataset | Shared RAW table | Entity type |
| --- | --- | --- |
| account/campaigns/adGroups/ads/youtubeAssets | `RAW_Ads_Entities` | account/campaign/ad_group/ad/creative |
| campaignDailyMetrics | `RAW_Ads_Daily` | campaign |

ห้ามสร้างหรือ Dual-write `RAW_Google_Ads_*`

Shared RAW stable keys ใช้ Source account identity ตาม Blueprint ที่ Apply แล้ว:

```text
raw entity = google_ads:{customerId}:{entityType}:{externalEntityId}
raw daily  = google_ads:{customerId}:campaign:{campaignId}:{metricDate}:all
```

### Canonical Lark

| Dataset | Canonical table |
| --- | --- |
| account | `MKT_Ads_Accounts` |
| campaigns | `MKT_Ads_Campaigns` |
| adGroups | `MKT_Ads_AdGroups` |
| ads | `MKT_Ads_Ads` |
| youtubeAssets | `MKT_Ads_Creatives` |
| campaignDailyMetrics | `MKT_Ads_Daily` |

ไม่มี `MKT_Ads_AssetGroups` write ใน v1 Relations resolve ด้วย External ID +
Canonical Stable key ไม่ใช้ Record ID จาก Payload

Canonical stable keys ใช้ Pre-applied Ads contract:

```text
entity = google_ads:{customerId}:{entityType}:{externalEntityId}
daily  = google_ads:{customerId}:campaign:{campaignId}:{metricDate}
```

Money เก็บ integer micros เป็น Source of truth ค่า Display/CTR/CPC/CPM/ROAS
เป็น Formula ownership ของ Lark และ Connector ห้ามเขียนทับ Formula/Lookup/
Relation นอก Ownership mask

## Write and partial-failure semantics

1. Validate/assemble ทั้ง Run ก่อน Business write
2. Plan ทุก D1/RAW/Canonical destination ก่อน First write
3. D1 business facts เขียนก่อน Lark
4. Lark upsert เป็น Batch จำกัดและใช้ Rate-limit retry กลาง
5. Commit Phase checkpoint หลัง Batch สำเร็จเท่านั้น
6. Retry เริ่มต่อจาก durable checkpoint
7. Business checkpoint/Coverage complete หลังทุก Destination reconcile
8. Partial failure บันทึก Coverage `partial` และไม่ประกาศ Success
9. Reconciliation ต่อ Dataset ต้องพิสูจน์
   `created + updated + skipped = expected` และ `failed=0`
10. Exact rerun ต้องมี Duplicate group เป็นศูนย์และ Business fact count ไม่เพิ่ม

Incoming `null` ไม่ล้าง Protected non-null value เดิม เว้นแต่ Contract ระบุ
Source deletion/absence อย่างชัดเจน

## Modes and feature gates

### `DRY_RUN`

Script query/build/validate Local เท่านั้น ไม่มี HTTP request

### `PREVIEW`

เปิดได้เฉพาะเมื่อ:

```text
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=true
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
```

Worker ตรวจ Signature/Replay/Schema/Identity/Completeness, เก็บ Sanitized counts
แล้ว Redact payload ไม่มี Queue/D1 business/Lark write

### `LIVE`

ต้องเปิดทั้ง Connector, Signed ingress และ Business write ด้วย Manual rollout
ที่ได้รับอนุมัติ:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=true
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=true
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=true
```

ทุกค่า Default `false` ไม่มี Google Ads schedule flag และไม่มี Cron

## Required implementation sequence

1. Commit sanitized Script artifact + GAQL manifest + safety scan
2. Add Google Ads Connector/Job definitions in disabled `planned` state
3. Add pure canonical JSON, HMAC and ingress validation with tests
4. Add additive D1 nonce/run/chunk migration and atomic store tests
5. Add cross-chunk assembly and reference-only Queue admission
6. Add D1-first normalizers, Coverage and resumable processing
7. Add Shared RAW/Canonical plans and bounded writers behind flags
8. Add retry/partial failure/DLQ/redrive/reconciliation tests
9. Run all default gates
10. Request separate Remote rollout approval
11. Apply migration with backup, deploy flags false
12. Run signed PREVIEW and prove zero Business writes
13. Run one manual LIVE, exact replay and controlled failure/recovery
14. Observe clean manual cycles before separate Schedule decision

## Required tests and acceptance

- Signature: valid, tampered body/header, wrong key, previous key, constant-time path
- Timestamp/nonce: past/future skew, nonce race, nonce replay, expiry
- Idempotency: exact retry, changed body conflict, queue-admission race
- Envelope: unknown field, invalid identity, invalid manifest, body/chunk/run cap
- Six datasets: null/zero, ordering, duplicate, relation and each row cap
- Cross-chunk: out-of-order arrival, missing/duplicate/conflicting chunk, expiry
- Queue: reference-only body, stable operation identity, unknown version/type
- D1: additive migration, atomic transitions, payload redaction/retention
- Storage: exact Stable keys, fingerprints, Coverage, revisable Ads daily facts
- Lark: Shared RAW only, Canonical Ownership mask, bounded upsert/retry
- Reliability: checkpoint resume, generation supersede, lock renewal, DLQ/redrive
- Reconciliation: partial failure, exact replay, zero duplicate groups
- Regression: Customer OAuth, YouTube, TikTok, Meta fixtures, reports
- Safety scan: no Ads mutation, no trigger, no secret/customer fixture in source
- Full gates:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Approval gate

Approval of this Contract authorizes only local implementation on a dedicated
branch. It does not authorize Commit, Push, PR, Migration, Secret change,
Deployment, Live PREVIEW/LIVE, Lark write, Schedule หรือ Production action;
แต่ละ Boundary ต้องได้รับคำสั่งชัดเจนตามกฎ Repository
