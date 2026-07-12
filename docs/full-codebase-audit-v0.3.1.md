# Full Codebase Audit — v0.3.1-codebase-audit-hardening

วันที่ตรวจ: 2026-07-11
Baseline ก่อน Audit: `v0.2.8-runtime-customer-profiles`

## ขอบเขตการตรวจ

ตรวจทั้ง Repository ใน `apps`, `packages`, `scripts`, `tests`, Runtime profiles, Deployment examples, Lark HTTP/Pagination/Batch flow, TikTok source adapter, Classification Dictionary, Stable keys, Diff/Upsert, Retry/Timeout, Queue behavior, Date/Timezone, Report payload, Documentation และ Release packaging

รอบนี้ให้ความสำคัญกับการแก้บัค ความถูกต้องของข้อมูล Reliability และ Performance ก่อนการเพิ่มคอมเมนต์ละเอียดทุกบรรทัด ตามคำสั่งของผู้พัฒนา

## ผลตรวจใน Source package

- Unit/Integration/Regression tests: **140/140 ผ่าน**
- Syntax checks: ผ่านทุกไฟล์ `.js`/`.mjs`
- Architecture audit: **38 Source files, 67 Local dependencies, 0 Circular dependencies**
- Coverage ทั้งชุด: **Lines 93.39% / Branches 83.36% / Functions 92.64%** จากคำสั่ง `node --experimental-test-coverage --test tests/**/*.test.js`
- ไม่พบ `.dev.vars`, `node_modules`, Build artifact หรือ Credential จริงใน Release working tree
- Live DEV validation/write ของ v0.3.1 ต้องรันบนเครื่องผู้พัฒนาที่มี Secret และ DEV Base จริง จึงไม่อ้างว่าผ่านจาก Packaging environment
- ZIP integrity ผ่าน และเมื่อนำ Archive ไปแตกใน Directory ใหม่ `npm test`/`npm run check` ผ่านซ้ำ

## Critical / High ที่แก้แล้ว

### 1. Preflight สองตารางก่อน Write แรก

เดิม `MKT_Content` อาจถูกเขียนก่อน `MKT_Content_Daily` ผ่าน Schema preflight ทำให้คำสั่งจบด้วย Error แต่ตารางแรกมีข้อมูลแล้ว

แก้โดยแยก `planByKey()` และ `executePlan()` วางแผน Content/Daily ให้ครบก่อนเริ่ม Write พร้อม Test ยืนยันว่า Daily preflight ล้มแล้วไม่มี Content write

### 2. Create retry ที่อาจสร้างข้อมูลซ้ำ

Batch Create ไม่ Retry ภายใน Request เมื่อเจอ Timeout, Network หรือ 5xx ที่ผลลัพธ์กำกวม เพราะคำขอแรกอาจเขียนสำเร็จแล้ว ระบบให้ Queue/ผู้เรียกรัน Job ใหม่เพื่อ Re-plan จาก Stable Key ก่อนเขียน

Retry ภายใน Create เหลือเฉพาะ Rate limit ที่ Lark ตอบกลับชัดเจน

### 3. Source/Account/Stable-key identity conflict

ก่อนเขียน ระบบตรวจทั้ง:

- Source handle ต้องตรง Customer profile
- `platform + external_content_id` เดิมต้องไม่ผูกกับ `account_id` อื่น
- Record เดิมของ Account เดียวกันต้องไม่ใช้ Stable key รูปแบบเก่า/ผิด
- Daily Snapshot ต้องใช้ Stable key ตรงกับ Account, Video ID และ Metric date เดียวกัน

จึงบล็อกกรณีข้อมูล DEV `@ft.pumkin` ถูกติดชื่อ `chemistry_k` และกรณี Key เก่าค้างในปลายทาง

### 4. TikTok ID precision และ URL identity

- TikTok Video ID ที่ยาวเกิน `Number.MAX_SAFE_INTEGER` ต้องเป็น Text; ปฏิเสธ Number ที่เสีย precision แล้ว
- ปฏิเสธ Decimal/Scientific notation สำหรับ Video ID
- Video ID เป็นข้อมูลบังคับตั้งแต่ Source adapter
- ตรวจ Video ID ใน URL ให้ตรงกับ RAW ID
- ตรวจ Shareable/Embed URL ว่าชี้บัญชีและ Video เดียวกัน
- อ่าน Handle เฉพาะ Domain `tiktok.com` หรือ Subdomain จริง

### 5. Lark schema/cell contract

- Decode Rich text array, URL array/object, Number wrapper และ Structured cell โดยไม่ใช้ `String(object)`
- Serialize URL, DateTime, Number, Select, Multi-select และ Checkbox ตาม Live schema
- ตรวจ Select option ก่อน Write
- Normalize Existing record ให้ Shape ตรงกับ Payload ลด False update
- Cache Schema ต่อ Table และแชร์ Promise เมื่อมีคำขอพร้อมกัน

### 6. Pagination, Rate limit, Timeout และ Token

- Paginator กลางตรวจ `has_more`, missing token, repeated token และ `maxPages`
- คำขอถูกจัด Queue และเว้นช่วงขั้นต่ำ ลด Request burst
- Timeout ครอบทั้ง Header และ Response body
- Retry เฉพาะ Error ชั่วคราว พร้อม Exponential backoff, jitter และ `Retry-After`
- Refresh `tenant_access_token` หนึ่งครั้งเมื่อ Token ถูกปฏิเสธ และแชร์ Token request/cache
- Mask App token จาก Request path ใน Log

### 7. Destination lookup และ Diff performance

- Upsert ค้นเฉพาะ Stable keys ที่เกี่ยวข้อง แทน Full-table scan ของตารางปลายทาง
- แบ่ง OR filter เป็น Chunk และรวมผลด้วย `record_id`
- Normalize/Diff เฉพาะ Incoming fields ไม่เทียบ Formula/Audit field ที่ไม่เกี่ยวข้อง
- Batch normalization และ Stable-key dedupe เป็น O(n)

### 8. Queue และ Runtime config

- ทุก Supported job ต้องผ่าน `MKT_ENV + MKT_CUSTOMER_PROFILE` ก่อนสร้าง Infrastructure
- DEV ใช้ `dev_ft_pumkin`; Production ใช้ `chemistry_k`
- Business flow ไม่อ่าน `process.env` โดยตรง
- Queue Retry เฉพาะ `RuntimeError.retryable=true`
- Invalid job, Config, Schema และ Business rule ถูก Ack เป็น Permanent failure ไม่วน Retry
- Deployment example จำกัด Sync consumer `max_concurrency=1`

### 9. Classification Dictionary และ Data validation

- ตรวจ Enabled dictionary row ที่ผิด Contract และ Duplicate rule key
- รองรับ Structured select cell รวมข้อความคั่น comma
- Compile Regex ครั้งเดียวและมี Heuristic guard ลด Regex ที่เสี่ยง
- ปฏิเสธวันที่ไม่มีจริง, timezone-less datetime, จำนวนติดลบ/ทศนิยมใน Count และ JSON payload ที่สูญเสียข้อมูลเงียบ ๆ

## จุดที่ยังต้องระวัง

1. **ไม่มี Transaction ข้าม Lark tables:** Runtime crash หลัง Content สำเร็จแต่ก่อน Daily สำเร็จยังทำให้ Partial write ได้; rerun จะ Reconcile ด้วย Stable Key
2. **ยังไม่มี Distributed lock:** `max_concurrency=1` ลด Queue race แต่ Manual/local writer หรือ Runtime อื่นยังห้ามเขียนพร้อมกัน
3. **RAW/Dictionary ยัง Full read:** เมื่อข้อมูลโตระดับหลักหมื่นควรเพิ่ม Incremental cursor/window
4. **ยังไม่มี Persisted sync run:** ต้องเพิ่ม `sync_run_id`, `MKT_Sync_Log`, DLQ/System Alert และ Reconciliation summary
5. **Classification field clearing ยังไม่เปิดใช้:** Payload ปัจจุบัน Omit ค่าว่าง หาก Record เคย Match rule แล้วภายหลังไม่ Match ค่าเก่าใน Lark อาจค้าง ต้องยืนยัน Contract การล้าง Cell ของ Lark ก่อนเปลี่ยนเพื่อไม่เสี่ยงลบ/เขียนผิด
6. **ไม่มี Unique constraint ฝั่ง Lark:** Stable-key guard ลด Duplicate แต่ไม่แทน Database unique constraint
7. **Regex guard ไม่ใช่ Sandbox:** สิทธิ์แก้ Dictionary ควรจำกัดเฉพาะผู้ดูแล
8. **Live customer-owned Production ยังไม่ทดสอบ:** Chemistry K ต้อง Deploy ใน Base/App/Cloud/Social assets ของลูกค้า

## Gate หลังติดตั้ง

```bash
npm install
npm test
npm run check
npm run validate:tiktok
```

เมื่อ Dry run ผ่าน:

```bash
CONFIRM_WRITE=YES npm run sync:tiktok
CONFIRM_WRITE=YES npm run sync:tiktok
```

รอบที่สองต้อง `created=0` สำหรับ Stable Key เดิม และจำนวน Record ใน Lark ต้องไม่เพิ่ม
