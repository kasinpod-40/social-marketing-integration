# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = LATEST_LOCAL_BASE_EXPORT_AUTHORITY_PINNED_WRITES_BLOCKED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_AUTHORITY                    = LOCAL_LARK_BASE_EXPORT
SOURCE_EXPORT_FILE                  = Social MKT Data Hub(20260818-030125).base
SOURCE_EXPORT_SHA256                = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
EXPECTED_SOURCE_TABLES              = 33
FULL_PARITY_REQUIRED                = TRUE
SOURCE_LIVE_33_OF_33_GATE           = REMOVED_NOT_AUTHORITY
PROTECTED_TARGET_TABLE              = 🎵 RAW_TikTok_Creator_Videos
PROTECTED_TARGET_TABLE_POLICY       = REUSE_EXACT_READ_ONLY_OR_BLOCK
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

## Protected Target table contract

`🎵 RAW_TikTok_Creator_Videos` ที่มีอยู่ใน Target เป็น Protected Existing Table.

กฎบังคับ:

- ห้าม create table ชื่อนี้ซ้ำ/ทับ
- ห้าม rename table นี้
- ห้าม create/update Field
- ห้าม batch create/update Record
- ห้าม create/update View, Filter หรือ View property
- ห้ามลบหรือเปลี่ยน Cross-Base Sync configuration
- Preview ต้องพิสูจน์ได้เฉพาะ action `reuse_exact`; ถ้าไม่ exact ให้ block ทั้ง Apply โดยห้ามแก้ของเดิมให้เข้ากับ Source
- protected write fence ต้อง reject ก่อน OpenAPI request เพื่อให้ remote mutation = 0 สำหรับ Table นี้แม้ logic ชั้นบนพลาด

Implementation guard: `packages/application/src/use-cases/protect-customer-lark-target.js`.

## Customer PROD config contract

ไฟล์จริง: `.customer.prod.vars` (Git-ignored)

Template: `.customer.prod.vars.example`

Target modes require:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

Source export path is optional for local audit because operator v4 defaults to:

`/Users/wasanjantawong/Downloads/Social MKT Data Hub(20260818-030125).base`

Override key when needed:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`

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
- Operator contract is `customer_base_full_parity_operator_v4`.
- Exact latest export file name/SHA-256 and structural counts are pinned as the authority.
- `--source-export-audit` no longer asserts Lark/Target config and defaults to the latest Downloads file path when no env path is set.
- `--full-parity-audit` uses local export Source + GET-only Target inspection.
- Live Source 33/33 gate remains removed.
- Added `protect-customer-lark-target.js` hard write fence for `🎵 RAW_TikTok_Creator_Videos`.
- Added regression proving create-by-name and Field/Record/View mutations on the protected table are rejected before remote call.
- Added protected-plan gate requiring `reuse_exact`; any create/conflict/missing plan is blocking.
- Write/apply modes remain blocked.
- No Customer Lark mutation has been enabled or executed by these changes.

## Safety contract

1. Local export audit = local read-only, zero remote request.
2. Exact SHA mismatch is blocking before Target mutation.
3. Full parity audit = local Source file + GET-only Target inspection.
4. Existing unrelated customer tables must never be overwritten/deleted.
5. Existing `🎵 RAW_TikTok_Creator_Videos` is immutable to this migration: `reuse_exact` read-only or block.
6. Protected table writes must be rejected before OpenAPI request.
7. No Worker/D1/Queue/schedule mutation.
8. No Source mutation.
9. Apply remains blocked until every exported dimension has clone/remap/verify coverage and the protected-table policy is wired into the final Apply path.

## Required tests / gates

- actual `.base` gzip-envelope parsing
- duplicate snapshot stable-ID dedupe
- exact latest SHA/count/table-set comparison
- malformed/missing payload fail closed
- local audit requires no Lark credentials
- unrelated Target tables preserved
- protected TikTok target table write fence + `reuse_exact` plan gate
- full clone/remap regressions for fields, records, relations, formulas and views
- Filter/Sort/Group/visible fields/timebar/card/forms/dashboards/workflows/roles coverage before Apply
- `npm ci`
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Next closure sequence

1. Exact-head CI after protected-table guard.
2. Adapt normalized local export into existing `consolidate-lark-base.js`; do not build a parallel transport.
3. Wire `protectCustomerLarkTarget` and `assertProtectedTargetTablePlan` into Preview/Apply so `🎵 RAW_TikTok_Creator_Videos` can only be reused exact and never mutated.
4. Add clone/remap coverage for every exported dimension.
5. Preview Target with zero unhandled dimensions and unrelated customer content untouched.
6. One controlled Apply.
7. GET-only canonical Target verifier reports 100% parity for every export-represented dimension while the protected TikTok table remains unchanged.
8. Only then may PR #661 be ready for merge/closeout.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
