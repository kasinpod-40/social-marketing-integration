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

- `scripts/lib/lark-base-export.js` now parses the actual export envelope directly: `gzipSnapshot`, `gzipExtraInfo`,
  `gzipBaseRole`, `gzipAccessConfig`, `gzipDashboard`, `gzipAutomation`.
- All compressed payloads are gzip/base64 JSON decoded locally.
- Table/Field/Record/View counts are deduped by exported stable IDs; chunked duplicate snapshot entries cannot inflate parity counts.
- Operator contract bumped to `customer_base_full_parity_operator_v4`.
- Exact latest export file name/SHA-256 and structural counts are pinned as the authority.
- `--source-export-audit` no longer asserts Lark/Target config and defaults to the latest Downloads file path when no env path is set.
- `--full-parity-audit` uses local export Source + GET-only Target inspection.
- Live Source 33/33 gate remains removed.
- Write/apply modes remain blocked.
- Regression fixture now matches the real Lark `.base` envelope and proves duplicate snapshot dedupe.
- No Customer Lark mutation has been enabled or executed.

## Safety contract

1. Local export audit = local read-only, zero remote request.
2. Exact SHA mismatch is blocking before Target mutation.
3. Full parity audit = local Source file + GET-only Target inspection.
4. Existing unrelated customer tables must never be overwritten/deleted.
5. Existing `🎵 RAW_TikTok_Creator_Videos` must pass final canonical parity; name alone is insufficient.
6. No Worker/D1/Queue/schedule mutation.
7. No Source mutation.
8. Apply remains blocked until every exported dimension has clone/remap/verify coverage.

## Required tests / gates

- actual `.base` gzip-envelope parsing
- duplicate snapshot stable-ID dedupe
- exact latest SHA/count/table-set comparison
- malformed/missing payload fail closed
- local audit requires no Lark credentials
- unrelated Target tables preserved
- full clone/remap regressions for fields, records, relations, formulas and views
- Filter/Sort/Group/visible fields/timebar/card/forms/dashboards/workflows/roles coverage before Apply
- `npm ci`
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Next closure sequence

1. Exact-head CI.
2. Run local `--source-export-audit`; it must match exact SHA and latest 33/723/35,528/111/... authority without any Lark credential.
3. Adapt normalized local export into existing `consolidate-lark-base.js`; do not build a parallel transport.
4. Add clone/remap coverage for every exported dimension.
5. Preview Target with zero unhandled dimensions and unrelated customer content untouched.
6. One controlled Apply.
7. GET-only canonical Target verifier reports 100% parity for every export-represented dimension.
8. Only then may PR #661 be ready for merge/closeout.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
