# Full Codebase Audit — v0.3.0-codebase-audit-hardening

วันที่ตรวจ: 2026-07-11
Baseline: `v0.2.8-runtime-customer-profiles`

## ขอบเขตที่ตรวจ

ตรวจ Source code และ Flow ทั้งหมดใน `apps`, `packages`, `scripts`, `tests`, Runtime profiles, Deployment examples, Lark HTTP/Pagination/Batch flow, TikTok normalization, Classification, Stable keys, Retry, Timeout, Queue behavior, Date/Timezone, Report payload, Documentation และ Release packaging

## ผลสรุปก่อน Packaging

- Tests: **98/98 ผ่าน**
- Syntax checks: ผ่านทุก `.js`/`.mjs`
- Architecture audit: **36 Source files, 58 Local dependencies, 0 Circular dependencies**
- ไม่พบ Duplicate file contents
- ไม่พบไฟล์ขนาดใหญ่หรือ Build artifact หลุดใน Working tree
- Secret pattern scan พบเฉพาะ Placeholder/Test fixture ไม่พบ Credential จริง
- Live DEV test ของ v0.3.0 ยังไม่รันจาก Packaging environment และจะไม่อ้างว่าผ่านจนผู้พัฒนารันกับ DEV Base จริง

## Critical — แก้แล้ว

### 1. Partial write จาก Validation ของตารางหลัง

เดิม `MKT_Content` อาจถูกเขียนก่อน `MKT_Content_Daily` ผ่าน Schema preflight ทำให้คำสั่งจบด้วย Error แต่ตารางแรกมีข้อมูลแล้ว

แก้โดยแยก `planByKey()` และ `executePlan()` แล้ววาง Plan ของทั้งสองตารางก่อน Write แรก พร้อม Test ว่าหาก Daily preflight ล้ม จะไม่มี Content write

### 2. Batch Create Retry แบบผลลัพธ์กำกวม

Timeout/Network/5xx หลังส่ง Request อาจหมายถึง Lark สร้าง Record สำเร็จแล้ว หาก Retry Payload เดิมทันทีอาจเกิด Duplicate

แก้โดย Batch Create Retry ภายใน Request เฉพาะ HTTP 429 หรือ Lark `1254290`; Error กำกวมส่งขึ้น Queue ให้ Job ใหม่ Re-plan จาก Stable Key

### 3. Dev/Production identity ปนกัน

แยก Runtime profile `dev_ft_pumkin` และ `chemistry_k`; ตรวจคู่ `MKT_ENV + MKT_CUSTOMER_PROFILE`, Source handle และ Account identity conflict ก่อนเขียน

### 4. Queue job บางชนิดข้าม Customer profile validation

เดิม Metric seed ใน Queue สร้าง Infrastructure ได้โดยไม่ตรวจ Dev/Production profile

แก้โดยให้ Runtime ของทุก Supported job โหลด Customer profile ก่อน Client/Repository และคืน Permanent error code เมื่อ Config ผิด

### 5. Race ระหว่าง Queue consumer หลาย Invocation

แม้ Worker ประมวลผล Message ตามลำดับภายใน Batch แต่ Cloudflare สามารถเปิด Consumer หลาย Invocation พร้อมกันได้ ทำให้สอง Worker อ่าน Stable key เดียวกัน วาง Create plan เหมือนกัน และสร้าง Duplicate ได้

แก้ Deployment example ให้กำหนด `max_concurrency=1` พร้อม Regression test ป้องกันการลบ Guard โดยไม่ตั้งใจ ระหว่างที่ยังไม่มี Distributed lock/Unique reservation กลาง

## High — แก้แล้ว

### 5. Destination full-table scan

เพิ่ม Filtered lookup ตาม Stable Key, Chunk conditions, Pagination guard และ in-memory index เฉพาะ Record ที่เกี่ยวข้อง

### 6. HTTP timeout ครอบไม่ถึง Response body

ย้าย `response.text()` เข้า AbortController scope และเพิ่ม Regression test กรณีได้รับ Header แล้ว Body ค้าง

### 7. Pagination วนไม่จบ

ตรวจ `has_more`, missing token, repeated token และ maximum pages ใน Paginator กลาง

### 8. Retry loop จาก Permanent error

เพิ่ม `RuntimeError.retryable`; Queue Retry เฉพาะ Transient error และ Ack Invalid job/Config/Schema/Business rule

### 9. Lark cell shape และ Diff ไม่คงที่

รองรับ Rich text, URL array/object, Number, DateTime, Select และ Checkbox จาก Schema/Cell จริง พร้อม Normalize ฝั่งอ่านให้ตรง Payload ฝั่งเขียน

แก้ False update จาก:

- URL ที่ต่างกันเพียง Canonical slash
- Multi-select ลำดับต่างกัน
- Multi-select ว่างที่ Lark คืนเป็น Missing field
- Destination-only Formula/Audit fields

### 10. Source identity ปลอมจาก URL Domain อื่น

`extractTikTokHandle()` เดิมตรวจเฉพาะ Path `/@handle/video/` จึงมีโอกาสรับ URL Domain อื่น

แก้โดยยอมรับเฉพาะ `tiktok.com` และ Subdomain จริงก่อนอ่าน Handle

## Medium — แก้แล้ว

- ตรวจวันที่จริง เช่นปฏิเสธ `2026-02-30`
- สร้างวันที่ตาม Timezone ด้วย `formatToParts` ไม่พึ่งรูปแบบ Locale
- รองรับ Timestamp ถึงวินาทีสุดท้ายของปี 2100
- Reject Stable-key component ที่มี `:`
- Escape Separator ของ Report ID เพื่อป้องกัน Key collision
- Normalize bare CTA domain เป็น absolute HTTPS URL
- ไม่ใช้ Post URL เป็น `cta_destination`
- ตรวจ TikTok Count ไม่ติดลบ/ไม่เป็นทศนิยม, Duration clock และ Completion rate
- Reject JSON payload ที่มี Date/Map/Set/undefined/NaN/Infinity/BigInt/Function/Symbol/Circular reference
- แชร์ Lark Token/Schema cache ภายใน Queue batch เดียว
- Parse `.dev.vars` แบบ Quote/Inline comment/Backslash โดยไม่ Execute shell
- ย้าย Date-time utility ไป Shared layerเพื่อลด Dependency inversion
- Compile Regex ครั้งเดียว, เพิ่ม Heuristic ReDoS guard และจำกัดข้อความ Classification
- Execute Sync plan เดิมซ้ำไม่ได้

## Security / Exposure — แก้แล้ว

- ลบ Public `/project-brain` endpoint ที่เปิดเผย Internal implementation rules โดยไม่จำเป็น
- `/health` ไม่เปิดเผย Customer profile หรือ Secret
- Lark App token ถูก Mask จาก Request trace path
- Log ไม่พิมพ์ Environment ทั้งก้อนหรือ Request body ที่มี Credential
- Config/Table errors มี Stable error code และ Safe details

## Maintainability — แก้แล้ว

- เพิ่ม Build version กลางและ Test ให้ตรง `package.json`
- เพิ่ม Architecture audit ถาวรใน `npm run check`
- เพิ่มคอมเมนต์ภาษาไทยใน Module, Function contract และ Logic สำคัญ/เสี่ยง
- เพิ่ม `docs/CODE_COMMENTING_STANDARD_TH.md`
- แยก API/Sync Wrangler examples
- ทำ `.gitignore` ให้ตรงเทคโนโลยีโปรเจกต์และตัด Template ที่ไม่เกี่ยวข้อง
- อัปเดต README, PROJECT_BRAIN, Current State, Environment ownership, Next Actions, CHANGELOG และ Production checklist
- ลบ Dead placeholder/Unused contract files ที่ไม่มีผู้เรียกใช้

## ความเสี่ยงที่ยังเหลือและต้องไม่ปิดบัง

1. **ไม่มี Cross-table transaction:** Runtime crash หลัง Content สำเร็จแต่ก่อน Daily สำเร็จยังทำให้ Partial write ได้ Stable-key rerun จะ Reconcile ส่วนที่ขาด
2. **ยังไม่มี Distributed lock:** Queue ถูกจำกัด `max_concurrency=1` แล้ว แต่ Local/manual writer หรือ Runtime อื่นยังห้ามเขียนพร้อม Queue จนกว่าจะมี Lock/Unique reservation กลาง
3. **RAW source full read:** RAW TikTok และ Classification Dictionary ยังอ่านทั้ง Source; ระดับหลักหมื่นควรเพิ่ม Incremental cursor/window
4. **Regex ไม่ใช่ Sandbox:** มี Heuristic guard แต่ผู้แก้ Dictionary ยังควรมีสิทธิ์จำกัด
5. **ยังไม่มี Persisted Sync run:** `MKT_Sync_Log`, `sync_run_id`, DLQ/System Alert และ Reconciliation summary เป็นงาน Reliability ถัดไป
6. **Production ยังไม่ Live test:** Chemistry K Production ต้องทดสอบใน Base/App/Cloud/Social assets ที่ลูกค้าเป็นเจ้าของ
7. **Package test ไม่แทน Live UAT:** หลังติดตั้ง ZIP ต้องรัน Dry run และ Sync ซ้ำสองรอบกับ DEV Base

## คำสั่ง Gate หลังติดตั้ง

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
