# Current Task — Shared Work/Codex Handoff

## Task metadata

- **Status:** `clean_candidate_pending_user_blueprint_approval`
- **Baseline:** `v0.10.2-rc.1`
- **Last updated:** `2026-07-15`
- **Owners:** ChatGPT Work (analysis/acceptance/release) + Codex (repository implementation)
- **Current implementation:** ผู้ใช้อนุมัติให้ทำ Multi-channel foundation ทั้ง 6 ส่วนเมื่อ 2026-07-15

## Objective

ใช้ไฟล์นี้เป็นใบงานกลางระหว่าง ChatGPT Work และ Codex เพื่อให้ Scope, Contract, Acceptance criteria, ผล Implementation และความเสี่ยงเดินทางไปกับ Repository แทนการพึ่งความจำของแต่ละแชท

TikTok Organic DEV implementation ปิดแล้วที่ baseline v0.9.6. งาน Operational ที่ยังเฝ้าดูคือ Scheduled Daily/Weekly report และ Weekly complete baseline ซึ่งไม่บล็อกงานถัดไป

## Approved workstream

`Multi-channel Foundation — Clean Release and Configuration Completion`

ผู้ใช้อนุมัติให้ดำเนินงานทั้ง 6 ส่วนแล้ว โดยยังไม่เปิด Connector ที่ไม่มี Credentials หรือ Live UAT และห้ามรายงาน Planned/UAT-pending connector ว่าสำเร็จ

รอบ `v0.10.2-rc.1` จำกัด Scope ที่ Release hygiene, safe examples, YouTube configuration
preflight และ Clean packaging เท่านั้น ห้าม Apply Schema, เรียก Live API, Deploy หรืออนุมัติ Blueprint แทนผู้ใช้

## Planning scope

### In scope

1. จัดทำ YouTube Organic source contract และ Lark Blueprint ก่อนเขียน Connector
2. สร้าง YouTube adapter/client/normalization foundation พร้อม Tests และ Feature flag ปิดโดยค่าเริ่มต้น
3. แยก Generic Organic Sync Pipeline เฉพาะส่วนที่พิสูจน์ร่วมกันได้จาก TikTok และ YouTube
4. สร้าง Meta Graph shared client foundation สำหรับ Facebook Page และ Instagram Business โดยยังไม่เปิดใช้งาน
5. เพิ่ม WooCommerce/Chatwoot source contracts, sanitized test fixtures และ contract validators
6. ออกแบบ Canonical Ads model กลางสำหรับ Account/Campaign/Ad Group/Ad/Creative/Daily metrics พร้อม Stable keys และ Tests
7. กำหนด Auth, pagination, quota/rate-limit, token lifecycle, null semantics, identity mismatch, idempotency และ UAT plan ของแต่ละส่วน
8. อัปเดต Connector/Job status ให้สะท้อน `uat_pending` หรือ `planned` อย่างซื่อสัตย์ ไม่มี fake success

### Out of scope

- Customer Production setup หรือ Business verification ของลูกค้า
- Live activation, OAuth consent หรือ App Review ของแพลตฟอร์มภายนอก
- Ads API adapters และ Live Ads sync
- Cross-channel attribution
- External dashboard
- การแก้ TikTok logic ที่ผ่าน Live แล้วโดยไม่มี Regression evidence

## Required inputs before Live UAT/activation

- DEV YouTube channel/account ที่ได้รับอนุญาตให้ใช้ทดสอบ
- Google Cloud project/OAuth client หรือ API credential สำหรับ DEV
- Channel ID และประเภทข้อมูลย้อนหลังที่ต้องการ
- YouTube public-data credential และ Owner Analytics OAuth หากต้องใช้ private metrics
- Meta App/Page/Instagram test assets และ permissions
- WooCommerce REST credentials กับ DEV store
- Chatwoot DEV account/token
- Ads sandbox/test-account credentials ของแต่ละแพลตฟอร์ม

ข้อมูลเหล่านี้ไม่บล็อกการสร้าง Contract, Code foundation, Fixtures และ Tests แต่บล็อกการประกาศ Connector เป็น `active` หรือ Live-verified

## Required design artifacts

ต้องสร้างและตรวจในงานนี้ก่อนเปิด Connector ใด:

1. Source/API contract พร้อม Auth และ quota constraints
2. Lark table/field blueprint
3. Stable-key และ idempotency contract
4. Daily snapshot และ metric-definition contract
5. Customer-profile/config mapping โดยไม่มี Secret
6. Queue job catalog และ scheduling plan
7. UAT/Failure/Retry/Reconciliation plan
8. Impact review ต่อ Report Engine และ Client Views
9. Meta shared-client contract
10. WooCommerce/Chatwoot fixture contracts
11. Canonical Ads entity and daily-metric contract

## Acceptance criteria

- ไม่มี Field/Metric ที่ความหมายกำกวม
- Missing values มี null semantics ชัดเจน
- Historical range และ quota strategy ชัดเจน
- Multi-account และ identity mismatch behavior ชัดเจน
- Reuse/refactor plan ไม่สร้าง TikTok-specific duplicate logic
- Blueprint ผ่านการตรวจจากผู้ใช้ก่อนเริ่ม Coding
- YouTube code ไม่ถูก route เป็น Active จนกว่า Live DEV UAT ผ่าน
- Meta client ไม่ผูก Facebook/Instagram business mapping เข้าด้วยกันผิดชั้น
- Fixtures ไม่มีข้อมูลส่วนบุคคลหรือ Secret จริง
- Ads model ไม่ผูกชื่อ Entity กับแพลตฟอร์มเดียวและมี Stable key ที่ deterministic
- TikTok regression tests และ Full Gates ผ่านครบ

## Implementation instructions for Codex

เมื่อ Status เป็น `approved_for_implementation`:

1. อ่าน `AGENTS.md` และ Project Brain ทั้งหมดที่เกี่ยวข้อง
2. ตรวจทั้ง Codebase ก่อนแก้
3. ทำเฉพาะ Scope ที่อนุมัติในไฟล์นี้
4. เพิ่ม/แก้ Tests และรัน Full Gates
5. ห้ามแก้ Live-verified TikTok contracts โดยไม่มี Regression tests
6. เติมผลในหัวข้อ `Implementation result` ด้านล่าง

## Implementation result

- **Status:** `clean_candidate_pending_user_blueprint_approval`
- **Files changed:** เพิ่ม YouTube required-table preflight ที่รวม `MKT_Accounts`, ทำ Example config ให้ fail-closed, เพิ่ม archive Blocklist/Allowlist + Secret/DEV ID/Duplicate scan, ลบ Local Blueprint duplicate และย้าย DEV Table IDs ออกจาก Release docs
- **Tests added/updated:** เพิ่ม Config completeness, YouTube missing-account preflight และ Release archive policy regressions; Unit/Integration 347/347, Workers-runtime 6/6 และ Report reliability 51/51 ผ่าน
- **Commands run:** `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --offline`, `npm run deploy:dry-run`, `npm run release:package`, `npm run release:verify -- <archive>`
- **Live/Sandbox UAT:** ยังไม่รันตาม Scope; ไม่มี Credentials และไม่มีการเขียน Lark/D1/Cloudflare จริงในงานนี้
- **Remaining risks:** Blueprint ยังรอ User approval; YouTube Account destination plan/write และ Worker route ยังไม่ Implement; YouTube/Meta/WooCommerce/Chatwoot/Ads ยังไม่ Live-verified
- **Recommended commit:** `chore: harden multi-channel release candidate`

## Work review result

- **Business acceptance:** ผู้ใช้อนุมัติงาน Clean candidate แต่ยังไม่ได้อนุมัติ Blueprint หรือ Live activation
- **Architecture acceptance:** passed — 99 source files / 195 local dependencies / 0 cycles; Repository hygiene และ npm audit ผ่าน 0 vulnerabilities
- **Release decision:** Clean candidate เท่านั้น; Wrangler dry-run 373.74 KiB / gzip 76.31 KiB; Official baseline ยังเป็น v0.9.7 และทุก unverified route ยังคง fail-closed
- **Project Brain update:** updated for v0.10.2-rc.1
