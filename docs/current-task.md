# Current Task — Shared Work/Codex Handoff

## Task metadata

- **Status:** `ready_for_planning`
- **Baseline:** `v0.9.7-agent-workflow-foundation`
- **Last updated:** `2026-07-15`
- **Owners:** ChatGPT Work (analysis/acceptance/release) + Codex (repository implementation)
- **Current implementation:** none; do not start connector code until this task is updated and approved

## Objective

ใช้ไฟล์นี้เป็นใบงานกลางระหว่าง ChatGPT Work และ Codex เพื่อให้ Scope, Contract, Acceptance criteria, ผล Implementation และความเสี่ยงเดินทางไปกับ Repository แทนการพึ่งความจำของแต่ละแชท

TikTok Organic DEV implementation ปิดแล้วที่ baseline v0.9.6. งาน Operational ที่ยังเฝ้าดูคือ Scheduled Daily/Weekly report และ Weekly complete baseline ซึ่งไม่บล็อกงานถัดไป

## Proposed next workstream

`YouTube Organic Connector — Data Model and Access Preflight`

สถานะยังเป็น **เสนอเพื่อวางแผน** ไม่ใช่คำสั่งให้เริ่ม Coding โดยอัตโนมัติ ก่อน Implementation ต้องให้ผู้ใช้ยืนยัน Scope และทำ Data Model/Lark Blueprint ตามกฎใน `AGENTS.md`

## Planning scope

### In scope

- ตรวจ Access/Credential ที่ใช้ใน DEV สำหรับ YouTube Data API และ YouTube Analytics API
- ระบุ Source entities: Channel, Video, Video statistics/analytics และ account identity
- ออกแบบ Raw/Master/Daily Snapshot/Sync Log/Alert mapping ที่ reuse ระบบกลาง
- กำหนด Stable keys, cursor/checkpoint, historical window, pagination, quota และ token lifecycle
- กำหนด Metric definitions และ null semantics ก่อนสร้าง Report integration
- ตรวจว่าส่วนใด reuse จาก TikTok และส่วนใดต้องเป็น YouTube adapter ใหม่
- จัดทำ Blueprint/Contract และ UAT plan ก่อน Implementation

### Out of scope

- Customer Production setup หรือ Business verification ของลูกค้า
- Ads connector
- Cross-channel attribution
- External dashboard
- การแก้ TikTok logic ที่ผ่าน Live แล้วโดยไม่มี Regression evidence

## Required inputs before implementation

- DEV YouTube channel/account ที่ได้รับอนุญาตให้ใช้ทดสอบ
- Google Cloud project/OAuth client หรือ API credential สำหรับ DEV
- Channel ID และประเภทข้อมูลย้อนหลังที่ต้องการ
- รายการ Metrics ที่ผู้ใช้ต้องการแสดงต่อ Client
- ข้อสรุปว่าจะดึง Public Data, Owner Analytics หรือทั้งสองแบบ

## Required design artifacts

ก่อนเปลี่ยน `Status` เป็น `approved_for_implementation` ต้องมี:

1. Source/API contract พร้อม Auth และ quota constraints
2. Lark table/field blueprint
3. Stable-key และ idempotency contract
4. Daily snapshot และ metric-definition contract
5. Customer-profile/config mapping โดยไม่มี Secret
6. Queue job catalog และ scheduling plan
7. UAT/Failure/Retry/Reconciliation plan
8. Impact review ต่อ Report Engine และ Client Views

## Acceptance criteria for planning

- ไม่มี Field/Metric ที่ความหมายกำกวม
- Missing values มี null semantics ชัดเจน
- Historical range และ quota strategy ชัดเจน
- Multi-account และ identity mismatch behavior ชัดเจน
- Reuse/refactor plan ไม่สร้าง TikTok-specific duplicate logic
- Blueprint ผ่านการตรวจจากผู้ใช้ก่อนเริ่ม Coding

## Implementation instructions for Codex

เมื่อ Status เปลี่ยนเป็น `approved_for_implementation`:

1. อ่าน `AGENTS.md` และ Project Brain ทั้งหมดที่เกี่ยวข้อง
2. ตรวจทั้ง Codebase ก่อนแก้
3. ทำเฉพาะ Scope ที่อนุมัติในไฟล์นี้
4. เพิ่ม/แก้ Tests และรัน Full Gates
5. ห้ามแก้ Live-verified TikTok contracts โดยไม่มี Regression tests
6. เติมผลในหัวข้อ `Implementation result` ด้านล่าง

## Implementation result

- **Status:** `not_started`
- **Files changed:** none
- **Tests added/updated:** none
- **Commands run:** none
- **Live/Sandbox UAT:** not started
- **Remaining risks:** Waiting for next-workstream confirmation and required DEV access
- **Recommended commit:** none

## Work review result

- **Business acceptance:** pending
- **Architecture acceptance:** pending
- **Release decision:** pending
- **Project Brain update:** pending next implementation
