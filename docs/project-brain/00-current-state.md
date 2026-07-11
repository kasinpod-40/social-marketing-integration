# 00 — Current State

## Baseline

`v0.3.1-codebase-audit-hardening` — 2026-07-11

## Environment ปัจจุบัน

- DEV Base เป็นของผู้พัฒนา
- TikTok source คือ `@ft.pumkin`
- `MKT_ENV=development`
- `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`
- Production profile `chemistry_k` มีใน Source code แต่ยังไม่เปิดใช้งาน
- Production จริงต้องสร้างใน Lark/Cloud/Social accounts ของลูกค้า

## Verified ก่อน Release นี้

Baseline v0.2.8 เคยผ่าน Live DEV sync:

- RAW TikTok: 20 rows
- `MKT_Content`: created 20
- `MKT_Content_Daily`: created 20
- Key ที่ถูกต้อง: `tiktok:ft_pumkin:*`
- ข้อมูลเก่า `tiktok:chemistry_k:*` ใน DEV Base ถูกลบแล้ว

## Verified ใน Package v0.3.1

- Tests: 140/140 ผ่าน
- Syntax checks: ผ่าน
- Architecture audit: 38 Source files, 67 Local dependencies, 0 cycles
- Secret/package scan: ไม่พบ Secret/Build artifact และ ZIP extraction test ผ่าน
- Live DEV validation ของ v0.3.1: ยังไม่รันจาก Packaging environment

## Next gate

1. ติดตั้ง ZIP ใหม่โดยรักษา `.dev.vars` เดิมไว้
2. `npm test`
3. `npm run check`
4. `npm run validate:tiktok`
5. Sync จริงสองรอบ
6. รอบที่สองต้อง `created=0`
7. ตรวจ Content/Daily count ใน Lark ไม่เพิ่มจาก Stable Key เดิม

## Known residual risks

- ไม่มี Transaction ข้าม Lark tables
- Queue ถูกจำกัด `max_concurrency=1` แต่ยังไม่มี Distributed lock สำหรับ Writer หลาย Runtime
- RAW/Dictionary ยังเป็น Full-source read
- ยังไม่มี Persisted `MKT_Sync_Log`/DLQ alert flow
- Classification field ที่กลายเป็นค่าว่างยังไม่ล้างค่าเก่าใน Lark จนกว่าจะยืนยัน Cell-clear contract
- Chemistry K Production ยังไม่ผ่าน Live customer-owned deployment
