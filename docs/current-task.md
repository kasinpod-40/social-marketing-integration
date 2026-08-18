# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = EXPORT_SOURCE_ADAPTER_READY_WRITES_BLOCKED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_AUTHORITY                    = LOCAL_LARK_BASE_EXPORT
SOURCE_EXPORT_FILE                  = Social MKT Data Hub(20260818-030125).base
SOURCE_EXPORT_SHA256                = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
EXPECTED_SOURCE_TABLES              = 33
FULL_PARITY_REQUIRED                = TRUE
SOURCE_LIVE_33_OF_33_GATE           = REMOVED_NOT_AUTHORITY
PREEXISTING_TARGET_TABLE_POLICY     = ALL_READ_ONLY_IMMUTABLE
REQUIRED_PROTECTED_TARGET_TABLE     = 🎵 RAW_TikTok_Creator_Videos
REQUIRED_PROTECTED_ACTION           = REUSE_EXACT_OR_BLOCK
CUSTOMER_LARK_APPLY                 = BLOCKED_UNTIL_FULL_CLONE_COVERAGE
SOURCE_MUTATION                     = ZERO
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

## Objective

สร้างทรัพยากร Social MKT Data Hub ใน Base ลูกค้า `✨Marketing Content Calendar` ให้ functional/UI parity 100%
กับไฟล์ export ล่าสุด `Social MKT Data Hub(20260818-030125).base`. ผู้ใช้ยอมให้สร้างที่ root ก่อนและจะย้ายเข้า
`Setup Phase | Social MKT Data Hub` ภายหลังหากจำเป็น.

Generated IDs เช่น `tbl...`, `fld...`, `vew...`, `wkf...` เปลี่ยนได้เฉพาะเมื่อ references ถูก remap แบบ deterministic
และผลลัพธ์เชิงข้อมูล/พฤติกรรม/UI เทียบเท่า Source.

## Source authority decision

ไฟล์ `.base` ล่าสุดที่ผู้ใช้อัปโหลดเป็น Source authority โดยตรง ไม่ใช่ Live Source Base token.

Direct inspection ของไฟล์ล่าสุดยืนยัน:

- file size 13,331,288 bytes
- SHA-256 `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- 33 unique tables
- 35,528 unique records
- 723 unique fields
- 111 unique views
- 12 relation fields
- 4 formula fields
- 6 dashboards
- 2 automations/workflows
- 4 Advanced Permission roles
- `gzipSnapshot` มี 34 entries แต่มี 33 unique table IDs เพราะ `📣 MKT_Report_Top_Ads` มี snapshot entry ซ้ำ; parser ต้อง dedupe stable IDs

จำนวน record 35,528 ของไฟล์ล่าสุด supersede baseline เก่า 35,373; ห้ามใช้จำนวนเก่าทำให้ไฟล์ล่าสุด fail.

Live `Social MKT Data Hub` ที่ credential ปัจจุบันอ่านได้ 17 tables เป็น diagnostic evidence เท่านั้นและไม่สามารถ block
การสร้างจากไฟล์ export ได้อีก. `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN` เป็น optional diagnostic.

## Immutable pre-existing Target contract

ทุก Table ที่มีอยู่ใน `✨Marketing Content Calendar` **ก่อน migration เริ่ม** เป็น customer-owned existing resource และต้องเป็น read-only สำหรับ workstream นี้ทั้งหมด ไม่จำกัดแค่ชื่อที่เห็นในภาพหรือชื่อที่รู้ล่วงหน้า.

Latest observed pre-existing set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

กฎบังคับกับ pre-existing Table ทุกตัว:

- ห้าม create ชื่อซ้ำ/ทับ
- ห้าม rename/delete
- ห้าม create/update Field
- ห้าม create/update Record
- ห้าม create/update View, Filter, Sort, Group หรือ View property
- ห้ามเปลี่ยน Sync configuration หรือ customer configuration ใด ๆ
- write fence ต้อง snapshot Table IDs ก่อน migration และ reject write ก่อน OpenAPI request
- migration เขียนได้เฉพาะ Table ใหม่ที่มันสร้างเองหลัง protected snapshot เท่านั้น

`🎵 RAW_TikTok_Creator_Videos` มีเงื่อนไขเพิ่มเพราะอยู่ใน Source export ด้วย: Preview ต้องพิสูจน์ action `reuse_exact`; ถ้าไม่ exact หรือหาย ให้ block ทั้ง Apply โดยห้ามซ่อม/เปลี่ยนของเดิมให้ตรง Source.

Unrelated customer Tables ไม่ต้องมี Source plan entry แต่ยังถูก write fence ป้องกันเต็มรูปแบบ.

Implementation guard: `packages/application/src/use-cases/protect-customer-lark-target.js` contract v2.

## Customer PROD config contract

ไฟล์จริง: `.customer.prod.vars` (Git-ignored)

Template: `.customer.prod.vars.example`

Target modes require:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

Source export path override:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`

Current real operator path supplied by user:

`/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`

Optional diagnostic only:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN`

`--source-export-audit` requires no Lark credential and performs zero remote request.

## Full-parity dimensions

Final acceptance ต้องตรวจทุก dimension ที่มีอยู่ใน export:

- table set / names
- full Field type/ui-type/description/property/formatter/options
- records and cell values
- relations + record/table ID remap
- formulas + field/table ID remap
- every View + type
- visible-field order / hidden state
- Filter
- Group
- Sort
- Timebar
- Card configuration
- Forms / Questions when represented in export
- Dashboards / themes / blocks / layout / data_config
- Workflows/Automation definitions + steps + exported state
- Advanced Permission roles/config represented in export
- attachment-like cells when included

## Implementation result

- `scripts/lib/lark-base-export.js` parses the actual export envelope directly: `gzipSnapshot`, `gzipExtraInfo`,
  `gzipBaseRole`, `gzipAccessConfig`, `gzipDashboard`, `gzipAutomation`.
- All compressed payloads are gzip/base64 JSON decoded locally.
- Table/Field/Record/View counts are deduped by exported stable IDs; chunked duplicate snapshot entries cannot inflate parity counts.
- Exact latest export file SHA-256 and structural counts are pinned as the authority.
- `--source-export-audit` is local-only; user-run exact file passed with `exportAuthority.ok=true`, `remoteRequestCount=0`, `remoteMutationCount=0`.
- Added `scripts/lib/lark-base-export-source-client.js` as a read-only adapter matching the existing consolidator Source interface; no parallel Lark transport was created.
- Source adapter normalizes Tables/Fields/Records/Views and retains raw export metadata/resources for full-parity remap work.
- Added regression for duplicate snapshot chunks, Select/MultiSelect/URL cells, Relation/Formula properties, and rich View metadata.
- Added `protect-customer-lark-target.js` v2: every pre-existing Target table is immutable; only post-snapshot newly-created tables are writable.
- Added regression proving rename/Field/Record/View mutations against all four observed existing tables are rejected before underlying remote write calls.
- Protected plan gate allows unrelated existing tables to remain outside Source plan while requiring any Source-overlap existing table to be `reuse_exact`.
- Write/apply modes remain blocked.
- No Customer Lark mutation has been enabled or executed by these changes.

## Safety contract

1. Local export audit = local read-only, zero remote request.
2. Exact SHA mismatch is blocking before Target mutation.
3. Every pre-existing Target table is immutable/read-only for migration.
4. Existing `🎵 RAW_TikTok_Creator_Videos` = `reuse_exact` read-only or block.
5. Protected-table writes must be rejected before OpenAPI request.
6. Only migration-created post-snapshot tables may receive writes.
7. No delete of customer resources.
8. No Worker/D1/Queue/schedule mutation.
9. No Source mutation.
10. Apply remains blocked until every exported dimension has clone/remap/verify coverage and the immutable-existing-table policy is wired into the only enabled Apply path.

## Required tests / gates

- actual `.base` gzip-envelope parsing
- duplicate snapshot stable-ID dedupe
- exact latest SHA/count/table-set comparison
- malformed/missing payload fail closed
- local audit requires no Lark credentials
- local export Source adapter compatibility
- all pre-existing Target tables immutable write fence
- TikTok `reuse_exact` overlap plan gate
- full clone/remap regressions for fields, records, relations, formulas and views
- Filter/Sort/Group/visible fields/timebar/card/forms/dashboards/workflows/roles coverage before Apply
- `npm ci`
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Next closure sequence

1. Exact-head CI for export Source adapter + all-existing Target protection.
2. Wire export Source adapter into GET-only Preview using existing `consolidate-lark-base.js`.
3. Snapshot/protect every pre-existing Target table before Preview/Apply; any Source overlap must be `reuse_exact`.
4. Ensure consolidator never writes to `reuse_exact` tables; current historical View-write behavior on reused tables must be removed before Apply is enabled.
5. Add clone/remap coverage for every exported dimension.
6. Preview Target with zero unhandled dimensions and all pre-existing customer content untouched.
7. One controlled Apply to newly-created migration tables only.
8. GET-only canonical Target verifier reports 100% parity for every export-represented dimension while all pre-existing Target resources remain unchanged.
9. Only then may PR #661 be ready for merge/closeout.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
