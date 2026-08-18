# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = LIVE_IDENTITY_PREFLIGHT_FIX_IMPLEMENTED_WRITES_BLOCKED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_BASE                         = Social MKT Data Hub
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
EXPECTED_SOURCE_TABLES              = 33
FULL_PARITY_REQUIRED                = TRUE
PARTIAL_TABLE_MIGRATION             = BLOCKED
REMOTE_TABLE_PROVISION              = BLOCKED
CUSTOMER_LARK_APPLY                 = BLOCKED
SOURCE_MUTATION                     = BLOCKED
CUSTOMER_PROD_CONFIG_FILE           = .customer.prod.vars
CUSTOMER_PROD_CONFIG_TEMPLATE       = .customer.prod.vars.example
DRAFT_PR                            = 661
BRANCH_VERIFICATION                 = PENDING_EXACT_HEAD_AFTER_LIVE_AUDIT_DIAGNOSIS
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

## Objective

ทำให้ทรัพยากร Social MKT Data Hub ที่ย้ายเข้า Base ลูกค้า `✨Marketing Content Calendar` มี functional/UI parity
กับ Source 100% โดยปลายทางสุดท้ายอยู่ใต้ `Setup Phase | Social MKT Data Hub` และไม่กระทบทรัพยากรอื่นของลูกค้า.

คำว่า 100% ใน workstream นี้หมายถึง configuration/data parity หลัง remap Lark-generated IDs ใหม่อย่าง deterministic;
ไม่บังคับให้ `tbl...`, `fld...`, `vew...`, `wkf...` และ generated IDs อื่นมีค่า byte-identical กับ Source.

## Full-parity dimensions

Acceptance gate เดียวต้องครอบคลุมทั้งหมด:

- Base block tree / folder placement
- 33 Tables และชื่อ
- Fields ทุก field: type, ui-type, description, property, formatter/options และ dependency
- Records และ cell values ทั้งหมด
- Relations และ Formula references หลัง ID remap
- Views ทุกตัวและ view type
- View visible-field order / hidden state
- View Filter
- View Group
- View Sort
- View Timebar
- View Card configuration
- Forms และ Questions
- Dashboards: theme, blocks, layout และ data_config
- Workflows/Automation: definition, steps และ enabled/disabled state
- Advanced Permission roles และ full role configuration
- Attachment-like cells ต้องถูกตรวจและมี copy contract ก่อน Apply

## Architecture decision

- ใช้ existing `LarkBitableClient`/existing repository contracts เป็นฐาน; ไม่สร้าง transport/queue/worker ใหม่.
- Existing table/field/record consolidator ถือเป็น implementation บางส่วนเท่านั้นและห้ามใช้เป็น final Apply จน coverage ครบ.
- Current Base v3 APIs มี resource-specific read/write สำหรับ block tree/folder, view property subresources,
  forms, dashboards, workflows และ advanced-permission roles; การเรียกต้องยึด official request contract จริง.
- Native table-copy endpoint copy ได้เฉพาะภายใน Base เดียวกัน จึงไม่ใช้เป็น cross-Base migration engine.
- ก่อน Deep Full-Parity Audit ต้องผ่าน GET-only Base identity + exact Source table-set preflight ก่อนเสมอ.
- Customer PROD credential แยกจาก `.dev.vars`: operator อ่าน `.customer.prod.vars` เป็น default และไฟล์จริงถูก Git ignore.

## Customer PROD config contract

ไฟล์จริงบน operator Mac: `.customer.prod.vars`

Template ที่ commit ได้: `.customer.prod.vars.example`

Required keys:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

`LARK_APP_ID`/`LARK_APP_SECRET` ต้องเป็น Customer-owned Lark application ที่มีสิทธิ์อ่านทั้ง Source และ Target Base.
Secret/token ห้าม commit และห้ามนำค่าจริงลง docs/log.

## Live audit evidence — 2026-08-18

รอบ GET-only แรกจบ fail closed โดย `remoteMutationCount = 0`.

Source ที่ credential ปัจจุบันมองเห็นมีเพียง:

- 17 tables
- 367 fields
- 22,901 records
- 87 views
- 8 relation fields
- 4 formula fields

จึงไม่ตรงกับ authority contract 33 tables และขาด 16 expected tables. ผลนี้ยังไม่พิสูจน์ว่า token ผิดตัวเพียงสาเหตุเดียว;
เป็น Source identity/table-set mismatch ที่ต้องยืนยันด้วย Base metadata + exact table-set preflight ก่อน Deep Audit รอบถัดไป.

Target ปัจจุบันมี 4 tables: customer content 3 tables และ protected `🎵 RAW_TikTok_Creator_Videos` 1 table.
Customer content ทั้ง 3 table ไม่ถูกแก้ไข และไม่มี Remote mutation จาก audit.

Read diagnostics แยกเป็นสองกลุ่ม:

1. Official endpoint path ถูก แต่ caller capability/scope ยังไม่พอใน Live tenant เช่น Base blocks, Forms และ Roles.
   Operator รอบใหม่จะ annotate required scopes (`base:block:read`, `base:form:read`, `base:role:read`) และ Role requirement.
2. Workflow list path ใน audit เดิมผิด contract: เดิมใช้ GET `/workflows`; official contract ใช้ POST `/workflows/list`.
   Operator v2 มี compatibility correction ก่อนส่ง request.

View property code `800010502` ยังไม่ถูกประกาศ Root cause; ต้องตรวจ applicability/capability หลัง Source authority ผ่านก่อน.

## Safety contract

1. `node scripts/customer-base-consolidation-operator.mjs` และ `--full-parity-audit` = GET-only เท่านั้น.
2. Legacy `--provision-missing`, `--preview`, `--apply`, `--verify` ถูก operator block โดยตรง.
3. Deep audit ห้ามเริ่มถ้า Source Base metadata/table set ยังไม่ตรง exact 33-table authority.
4. Remote mutation count ต้องเป็น 0 จน Full-Parity clone/remap/verifier contract ครบทุก dimension.
5. API/resource ใดอ่านไม่ได้ต้องเป็น blocker; ห้ามตีความว่า resource ไม่มี.
6. Existing customer tables/folders/content/dashboard/workflow/role ห้าม overwrite/delete เพื่อทำให้ parity ผ่าน.
7. Source Base mutation = 0.
8. Secret/token อยู่ `.customer.prod.vars`/process environment เท่านั้น; output ใช้ hashed Base identity.
9. Final verifier ต้อง fail closed เมื่อมี mismatch แม้เพียง dimension เดียว.

## Required tests

- Customer Base identity preflight uses canonical GET Base metadata and exact table-set comparison.
- A 17/33 Source table subset fails before Deep Audit.
- Source/Target Base name mismatch fails closed.
- Full-Parity audit inventory covers table/field/record/view/filter/sort/group/visible/timebar/card/forms/dashboard/workflow/role dimensions.
- Read failure on any required resource fails closed.
- Missing target table never enables partial Apply.
- Legacy provisioning/apply paths remain blocked while full parity is incomplete.
- Customer PROD config path defaults to `.customer.prod.vars`; missing required keys fail closed without exposing values.
- Existing relation/formula/record migration regressions remain passing.
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Implementation result

- Added `preflight-customer-base-full-parity.js` as GET-only identity/table-set gate using canonical Bitable v1 Base metadata plus existing `listTables()`.
- Operator v2 stops before Deep Audit when Source name/table set is not the exact 33-table authority, eliminating noisy hundreds-of-subresource reads on a known-invalid Source identity.
- Operator v2 preserves target read-only inspection and emits safe Base metadata without exposing app tokens/secrets.
- Corrected the Deep Audit Workflow list request through a compatibility shim to official `POST .../workflows/list` semantics.
- Strict read diagnostics now annotate known required scopes for Base block, Form, Workflow, Role and View resources; Role also notes Advanced Permission/Base-admin requirement.
- View-property `800010502` remains fail-closed evidence and is not reclassified until a valid 33-table Source reaches that stage.
- Added unit regression for exact authority success, 17/33 Source subset failure, and Source/Target Base name mismatch.
- No Customer Lark mutation has been run from this full-parity change.

## Acceptance criteria

Repository work is not complete merely because Tables exist. Final completion requires:

1. exact-head CI passes for the identity-preflight repair;
2. rerun GET-only operator with current `.customer.prod.vars` and use the new metadata/table-set output to prove whether configured Source is the imported 33-table authority;
3. if Source is not 33/33, set only `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN` to the actual imported 33-table Source Base and rerun;
4. Deep Full-Parity Audit reads Source/Target successfully or reports exact capability/scope blockers;
5. clone/remap implementation covers every Source dimension present in the valid audit;
6. one controlled Apply is allowed only after a dry-run/preview proves zero unhandled dimensions and no collision with unrelated customer content;
7. post-Apply GET-only canonical verifier reports 100% functional/UI parity across all required dimensions;
8. only then may PR #661 be considered ready for merge/closeout.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
