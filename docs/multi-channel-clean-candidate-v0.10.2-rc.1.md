# Multi-channel Clean Candidate v0.10.2-rc.1

## Status

`v0.10.2-rc.1` เป็น Clean candidate ระหว่างรอผู้ใช้อนุมัติ
`docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx` เท่านั้น ไม่ใช่ Official baseline
และไม่อนุญาตให้ Apply Schema, เรียก Live API, Deploy หรือเปิด Connector/Schedule ใหม่

Blueprint v0.10.2 แก้ Channel/Video latest-state grain, hidden subscriber semantics,
non-destructive reconciliation, Pacific-day Owner Analytics query/units และ Canonical mapping แล้ว.
Owner Analytics ยังคง RAW-only ใน Phase 1 และ Artifact ยังรอ User approval.

## Configuration completion

- `.dev.vars.example` และ `wrangler.sync.example.jsonc` ปิด Connector/Schedule ทั้งหมดเป็นค่าเริ่มต้น
- Customer profile, TikTok handle, D1 name, setting keys และ Table IDs ใช้ Placeholder
- YouTube activation table contract บังคับ:
  - `mktAccounts`
  - `rawYouTubeChannels`
  - `rawYouTubeVideos`
  - `rawYouTubeAnalyticsDaily`
  - `mktContent`
  - `mktContentDaily`
- Missing `LARK_TABLE_MKT_ACCOUNTS` จบที่ Config preflight ก่อน Source request แรกของ Future route
- Account destination plan/write และ Worker route ยังไม่ Implement; ห้ามตีความ Config readiness ว่า Connector เสร็จแล้ว

## Clean release tooling

```bash
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.10.2-rc.1.zip
```

Package tool ใช้เฉพาะ Tracked/Non-ignored Source files แล้วสร้าง:

- Clean source ZIP
- `RELEASE_MANIFEST.txt` ภายใน ZIP
- Manifest copy ภายนอก
- SHA-256 file
- JSON verification report

Verifier บล็อก Local config, Secret files, `.git`, `.wrangler`, `node_modules`, macOS metadata,
Coverage/temporary outputs/logs และตรวจ Required files, Credential patterns, DEV D1/Lark IDs,
duplicate binary artifacts และ Manifest consistency ก่อนคืน `ok=true`.

## Release decision

หลัง Full gates และ extracted-archive retest ผ่าน Artifact ยังคงมีสถานะ
`clean_candidate_pending_user_blueprint_approval`. เมื่อผู้ใช้อนุมัติ Blueprint แล้วจึงเสนอรุ่น
`v0.10.2-multi-channel-foundation-approved` และเลื่อน Official baseline.

## Source verification

```text
Clean npm ci                 passed
Unit / Integration          347/347
Workers runtime               6/6
Report reliability           51/51
Architecture          99 files / 195 dependencies / 0 cycles
Repository hygiene          passed
npm audit online/offline    0 vulnerabilities
Wrangler dry-run            373.74 KiB / gzip 76.31 KiB
```

TypeScript, separate lint และ production-build commands เป็น N/A เพราะ Repository นี้เป็น JavaScript
และไม่มี Script ดังกล่าว; Syntax/Architecture/Hygiene กับ Wrangler bundle เป็น Gate ที่ใช้จริง.
