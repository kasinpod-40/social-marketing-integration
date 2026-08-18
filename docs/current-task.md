# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = LOCAL_BASE_EXPORT_AUTHORITY_IMPLEMENTED_WRITES_BLOCKED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_AUTHORITY                    = LOCAL_LARK_BASE_EXPORT
SOURCE_EXPORT_FILE                  = Social MKT Data Hub(20260817-033903).base
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
EXPECTED_SOURCE_TABLES              = 33
FULL_PARITY_REQUIRED                = TRUE
SOURCE_LIVE_33_OF_33_GATE           = REMOVED_NOT_AUTHORITY
CUSTOMER_LARK_APPLY                 = BLOCKED_UNTIL_EXPORT_NORMALIZATION_AND_FULL_CLONE_COVERAGE
SOURCE_MUTATION                     = ZERO
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

## Objective

สร้างทรัพยากร Social MKT Data Hub ใน Base ลูกค้า `✨Marketing Content Calendar` ให้ functional/UI parity 100%
กับไฟล์ export `Social MKT Data Hub(20260817-033903).base` แล้วให้ผู้ใช้ย้ายตารางเข้าภายใน
`Setup Phase | Social MKT Data Hub` ได้ภายหลังหาก API สร้างไว้ที่ root.

Generated IDs เช่น `tbl...`, `fld...`, `vew...`, `wkf...` เปลี่ยนได้เฉพาะเมื่อ references ถูก remap แบบ deterministic
และผลลัพธ์เชิงข้อมูล/พฤติกรรม/UI เทียบเท่า Source.

## Source authority decision

ไฟล์ `.base` เป็น Source authority ของ workstream นี้โดยตรง ไม่ใช่ Live Source Base token.

Verified export baseline จากการตรวจไฟล์ก่อนหน้า:

- 33 tables
- 35,373 records
- 723 fields
- 111 views
- 12 relation fields
- 4 formula fields
- 6 dashboards
- 2 automations/workflows
- 4 Advanced Permission roles
- largest table 9,141 rows

Live `Social MKT Data Hub` ที่ credential ปัจจุบันอ่านได้ 17 tables ยังคงเป็น diagnostic evidence เท่านั้นและไม่สามารถ
block การสร้างจากไฟล์ export ได้อีก. `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN` จึงเป็น optional diagnostic,
ไม่ใช่ required migration input.

Official Lark/Feishu Base export contract ระบุว่า `.base` เป็น JSON export และสามารถเก็บโครงสร้างทั้งหมด รวม Tables,
Views, Fields, Dashboards, Automations/Workflows และ Advanced Permission; เมื่อ export แบบ structure+data จะรวม records ด้วย.
สิ่งที่ export format ไม่เก็บ เช่น role member assignments, cloud-doc base permissions/history/comments, share-enabled state
และ third-party plugin credentials ไม่ถือว่าเป็นข้อมูลที่ parser สามารถสร้างกลับจากไฟล์ได้.

## Customer PROD config contract

ไฟล์จริง: `.customer.prod.vars` (Git-ignored)

Template: `.customer.prod.vars.example`

Required:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

Optional diagnostic only:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN`

Default documented Source path:

`/Users/wasanjantawong/Downloads/Social MKT Data Hub(20260817-033903).base`

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
- Forms / Questions
- Dashboards / themes / blocks / layout / data_config
- Workflows/Automation definitions + steps + enabled/disabled state represented in export
- Advanced Permission roles/config represented in export
- attachment-like cells when included

## Implementation result

- Added `scripts/lib/lark-base-export.js` local read-only export reader.
- Reader parses the `.base` JSON container and expands nested gzip+base64 JSON payloads when present.
- Reader inventories tables/fields/records/views/relation/formula/dashboard/workflow/role resources and emits SHA-256,
  counts, names and bounded structural collection diagnostics without making any Lark request.
- Operator contract bumped to `customer_base_full_parity_operator_v3`.
- `--full-parity-audit` now uses the local `.base` export as Source authority and reads only the Target live Base.
- Added `--source-export-audit` for fully local/read-only inspection with `remoteMutationCount=0`.
- Removed live Source 33/33 identity/table-set gate from the migration authority path.
- `.customer.prod.vars.example` now requires `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`; Source app token is optional.
- Added regression for plain JSON + nested gzip/base64 JSON and invalid export fail-closed behavior.
- No Customer Lark mutation has been enabled or executed by this change.

## Safety contract

1. Local export audit = local read-only, zero remote request.
2. Full parity audit = local Source file + GET-only Target inspection.
3. Export must match approved baseline before any write mode may be enabled.
4. Existing unrelated customer tables must never be overwritten/deleted.
5. Existing `🎵 RAW_TikTok_Creator_Videos` must pass the same final parity verifier; name alone is insufficient.
6. No Worker/D1/Queue/schedule mutation.
7. No Source mutation.
8. Apply remains blocked until every exported dimension has clone/remap/verify coverage.

## Required tests / gates

- local `.base` JSON parsing
- nested gzip/base64 JSON expansion
- exact export-baseline comparison
- fail closed on malformed/unrecognized export
- unrelated Target tables preserved
- full clone/remap regressions for fields, records, relations, formulas and views
- new coverage for Filter/Sort/Group/visible fields/timebar/card/forms/dashboards/workflows/roles before Apply is enabled
- `npm ci`
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Next closure sequence

1. Run local `--source-export-audit` on the exact `.base` file and require baseline match.
2. If parser recognition differs from the known baseline, use bounded `candidateCollections` diagnostics to align the reader to the real export schema; do not fall back to Live Source 17 tables.
3. Extend the existing `consolidate-lark-base.js` engine instead of building a new transport: Source becomes normalized local-export adapter; Target remains existing `LarkBitableClient`.
4. Add clone/remap coverage for every exported dimension listed above.
5. Run dry-run/preview against Target proving unrelated customer content untouched and all exported resources handled.
6. One controlled Apply.
7. GET-only canonical Target readback verifier must report 100% parity for all export-represented dimensions.
8. Only then may PR #661 be considered ready for merge/closeout.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
