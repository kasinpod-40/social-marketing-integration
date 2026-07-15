# Multi-channel Clean Candidate v0.10.2-rc.2

## Status

`v0.10.2-rc.2` เป็น Clean reviewed candidate ที่แก้ Contract และ Release artifact จาก rc.1 แล้ว แต่ยัง **ไม่ใช่ Official baseline** และยังรอผู้ใช้ออนุมัติ YouTube Blueprint.

Official clean baseline ยังคงเป็น `v0.9.7-agent-workflow-foundation`.

## Changes in rc.2

- เพิ่ม Analytics `sort=day,video` ก่อนใช้ `maxResults/startIndex` pagination.
- ใช้ `metric_date` เป็นชื่อเดียวใน cumulative `MKT_Content_Daily` stable key และ mapping.
- แยก Analytics missing-row semantics: Video×Day ที่ไม่เคยมีข้อมูลไม่สร้าง row/zero/warning; Stable key ที่เคยพบแล้วหายตอน re-fetch จึงสร้าง reconciliation warning.
- เปลี่ยน YouTube canonical mapping เป็น field-by-field สำหรับ `MKT_Accounts`, `MKT_Content` และ `MKT_Content_Daily`.
- Source contract เก็บ metadata ครบ 42 fields: required, nullable, key role, source path, semantics, import note และ select options.
- เพิ่ม Workbook/source parity regression test.
- เพิ่ม `.gitignore` และ `.dev.vars.example` แบบ safe placeholders; Release examples fail-closed.
- Release verifier/allowlist ใช้ Blueprint v0.10.2 และ rc.2 document; แก้ D1 sensitive scan ที่เคยเรียกซ้ำ.
- ย้าย Canva-ready schema note รุ่นเก่าไป `docs/archive/` พร้อม Deprecated marker.
- Local `wrangler.sync.jsonc` เพิ่ม `LARK_TABLE_MKT_ACCOUNTS` สำหรับ DEV workspace แต่ไฟล์ดังกล่าวไม่ถูก Commit หรือ Pack.

## Prohibited actions

Release นี้ไม่ทำสิ่งต่อไปนี้:

- Apply Lark Schema
- เรียก YouTube API หรือใช้ DEV credentials
- เพิ่ม/เปิด Worker route หรือ Queue job
- เปิด YouTube schedule
- Deploy Worker
- เริ่ม Meta/WooCommerce/Chatwoot/Ads implementation

## Verification

รัน Gate จาก Source และจาก Clean ZIP ที่แตกใหม่:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.10.2-rc.2.zip
```

ผลจริงของรอบนี้บันทึกใน `docs/current-task.md` และไฟล์ Test report ข้าง Release ZIP.
