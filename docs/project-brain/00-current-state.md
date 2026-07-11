# 00 — Current State

## Baseline

`v0.4.0-multi-channel-foundation` — 2026-07-11

## Environment ปัจจุบัน

- DEV Base เป็นของผู้พัฒนา
- TikTok source คือ `@ft.pumkin`
- `MKT_ENV=development`
- `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`
- Production profile `chemistry_k` อยู่ใน Source codeแล้ว แต่ Production จริงยังไม่เปิดใช้งาน
- Production ต้องสร้างใน Lark, Cloudflare และบัญชี Platform ที่ลูกค้าเป็นเจ้าของ

## Verified ก่อน Release นี้

Baseline v0.2.8 เคยผ่าน Live DEV sync:

- RAW TikTok: 20 rows
- `MKT_Content`: created 20
- `MKT_Content_Daily`: created 20
- Key ที่ถูกต้อง: `tiktok:ft_pumkin:*`
- ข้อมูลเก่า `tiktok:chemistry_k:*` ใน DEV Base ถูกลบแล้ว

## เพิ่มใน v0.4.0

- Connector Catalog กลางสำหรับ TikTok, Facebook, Instagram, YouTube, WooCommerce และ Chatwoot
- Runtime feature flags แยกแต่ละ Connector
- Customer profile ของ DEV และ Chemistry K มี Config ทุกช่องทางโดยใช้ชื่อของลูกค้าเมื่อใช้ได้
- Connector Registry ตรวจ `active + enabled` ก่อนสร้าง Infrastructure
- Queue Job Catalog กลางและ Queue schema version 1
- Job ที่วางชื่อรอแต่ยังไม่ Implement จะ Fail แบบ Permanent โดยไม่คืน Fake success
- TikTok handle เปลี่ยนผ่าน `TIKTOK_SOURCE_HANDLE` ได้โดยไม่แก้ Source code
- Health endpoint แสดงเฉพาะ Connector readiness ที่ไม่เปิดเผย Account identity หรือ Secret
- TikTok behavior เดิมยังคงใช้ Sync/Validation path เดิม

## Verified in Package v0.4.0

- Tests: 170/170 ผ่าน
- Syntax checks: ผ่าน
- Architecture audit: 43 source files, 82 local dependencies, 0 cycles
- Coverage: 93.99% lines, 84.37% branches, 93.30% functions
- Live DEV validation/write: ต้องรันบนเครื่องผู้พัฒนาที่มี `.dev.vars` และ Lark Base จริง

## Connector status

| Connector | Code status | Default runtime |
|---|---|---|
| TikTok | active | enabled |
| Facebook Page | planned | disabled |
| Instagram Business | planned | disabled |
| YouTube | planned | disabled |
| WooCommerce | planned | disabled |
| Chatwoot | planned | disabled |

## Gate หลังติดตั้ง Release นี้

1. รักษา `.dev.vars` เดิมไว้
2. เพิ่ม Connector flags ตาม `.dev.vars.example`
3. `npm test`
4. `npm run check`
5. `npm run validate:tiktok`
6. Sync จริงสองรอบ
7. รอบที่สองต้อง `created=0`

## Known residual risks

- ไม่มี Transaction ข้าม Lark tables
- Queue ยังจำกัด `max_concurrency=1` เพราะไม่มี Distributed lock สำหรับ Writer หลาย Runtime
- RAW/Dictionary ยังเป็น Full-source read
- ยังไม่มี Persisted `MKT_Sync_Log`, DLQ alert และ Reconciliation summary แบบครบวงจร
- Classification field ที่กลายเป็นค่าว่างยังไม่ล้างค่าเก่าใน Lark จนกว่าจะยืนยัน Cell-clear contract
- Connector ที่เป็น `planned` ยังไม่มี API/Source contract/Blueprint และห้ามเปิดใช้
- Chemistry K Production ยังไม่ผ่าน Live customer-owned deployment
