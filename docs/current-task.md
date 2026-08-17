# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = FULL_PARITY_AUDIT_IMPLEMENTED_WRITES_BLOCKED
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
BRANCH_VERIFICATION                 = PASS_HEAD_717a54b288209a8eacdb5e73fb00ad724db4fb6b_RUN_32041900752_JOB_95422578196
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
  forms, dashboards, workflows และ advanced-permission roles; ห้ามยึดสมมติฐานเก่าว่า folder/Dashboard/Workflow/Role
  ต้องปิดแยกโดยอัตโนมัติ.
- Native table-copy endpoint copy ได้เฉพาะภายใน Base เดียวกัน จึงไม่ใช้เป็น cross-Base migration engine.
- ก่อนเพิ่ม Apply logic ต้องรัน GET-only Full-Parity Audit เพื่อ inventory Source/Target state จริงและ capability/scope gaps.
- Customer PROD credential ต้องแยกจาก `.dev.vars`: operator อ่าน `.customer.prod.vars` เป็น default และไฟล์จริงต้องถูก Git ignore.

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

## Safety contract

1. `node scripts/customer-base-consolidation-operator.mjs` และ `--full-parity-audit` = GET-only เท่านั้น.
2. Legacy `--provision-missing`, `--preview`, `--apply`, `--verify` ถูก operator block โดยตรง.
3. Remote mutation count ต้องเป็น 0 จน Full-Parity clone/remap/verifier contract ครบทุก dimension.
4. API/resource ใดอ่านไม่ได้ต้องเป็น blocker; ห้ามตีความว่า resource ไม่มี.
5. Existing customer tables/folders/content/dashboard/workflow/role ห้าม overwrite/delete เพื่อทำให้ parity ผ่าน.
6. Source Base mutation = 0.
7. Secret/token อยู่ `.customer.prod.vars`/process environment เท่านั้น; output ใช้ hashed Base identity.
8. Final verifier ต้อง fail closed เมื่อมี mismatch แม้เพียง dimension เดียว.

## Required tests

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

- Added `audit-lark-base-full-parity.js` GET-only inventory.
- Audit reads Source and Target table/field/record/view state plus Base v3 block tree, View detail and
  filter / visible_fields / group / sort / timebar / card subresources, Forms/Questions, Dashboards/Blocks,
  Workflows and Advanced Permission roles.
- Strict read interceptor makes any OpenAPI read failure a global blocker; audit emits counts/digests without exposing Base tokens and reports remote mutation 0.
- Customer operator defaults to Full-Parity audit and actively rejects old partial write/preview/verify modes.
- Customer credential source is isolated from DEV: `.customer.prod.vars.example` is tracked as template, `.customer.prod.vars` is Git-ignored, and operator reads the customer PROD file by default.
- Config preflight requires the 4 Customer PROD keys above and reports only missing key names/file guidance, never values.
- Exact head `717a54b288209a8eacdb5e73fb00ad724db4fb6b` passed Branch Verification run `32041900752`, job `95422578196`: locked install, architecture/hygiene, focused Report/Meta/Woo/Chatwoot/TikTok, Unit/Workers, Report Reliability, dependency audit, Wrangler dry-run and diff check all passed.
- No Customer Lark mutation has been run from this full-parity change.

## Acceptance criteria

Repository work is not complete merely because 33 Tables exist. Final completion requires:

1. create local `.customer.prod.vars` from the tracked template and fill the 4 required values;
2. live GET-only Full-Parity Audit reads Source/Target successfully;
3. audit proves the actual Source resource inventory and identifies any scope/API gaps;
4. clone/remap implementation covers every Source dimension present in that audit;
5. one controlled Apply is allowed only after a dry-run/preview proves zero unhandled dimensions and no collision with unrelated customer content;
6. post-Apply GET-only canonical verifier reports 100% functional/UI parity across all required dimensions;
7. only then may PR #661 be considered ready for merge/closeout.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
