# Current Task — Customer Base Consolidation v1

## Status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTATION_VERIFIED_LIVE_PREVIEW_REMAINS
CURRENT_PROGRAM                     = CUSTOMER_BASE_CONSOLIDATION_PREPLACED_TABLES_V1
SOURCE_BASE                         = Social MKT Data Hub
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
EXPECTED_SOURCE_TABLES              = 33
REMOTE_TABLE_CREATE                 = BLOCKED
SOURCE_MUTATION                     = BLOCKED
CUSTOMER_LARK_APPLY                 = NOT_RUN
DRAFT_PR                            = 661
BRANCH_VERIFICATION_RUN             = 32024949257
BRANCH_VERIFICATION_JOB             = 95372300469
BRANCH_VERIFICATION                 = PASS
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
NEXT_AUTOMATIC_SCHEDULED_EVIDENCE   = 2026-08-24T08:30:00+07:00
TIKTOK_ADS                          = DEFERRED_NOT_CURRENT_BLOCKER
DLQ_REDRIVE                         = BLOCKED_OFF
```

## Objective

ย้าย Table-level structure/data จาก `Social MKT Data Hub` เข้า Base เดิมของลูกค้า `✨Marketing Content Calendar`
โดยให้ Table ทั้ง 33 รายการอยู่ใต้ internal Base folder `Setup Phase | Social MKT Data Hub` และรักษา
field/record/relation/formula/view fidelity ให้มากที่สุดโดยไม่สร้าง Base/engine ใหม่และไม่ใช้ Cross-Base Sync
เป็นตัวแทนของ schema จริง.

## In scope

- Read-only source/target preflight ผ่าน Lark OpenAPI
- exact contract 33 source table names
- ใช้ existing central `LarkBitableClient`
- Table ปลายทางต้องถูก pre-create/move ใน Lark UI ก่อน Apply เพราะ OpenAPI ไม่มี folder-placement primitive
- operator ห้าม remote `createTable`; empty one-field destination tables เป็น shell ที่ claim ด้วย `updateField`
  และ `updateView` แล้วค่อยใช้ existing field/record/relation/formula/view migration path
- reuse existing target table ได้เฉพาะเมื่อ generic parity preflight ยืนยันว่าเข้ากันได้
- source read-only; ไม่มี delete; ไม่มี schedule/automation/runtime mutation
- Apply ต้องมี explicit confirmation ว่า Table ทั้งหมดถูกวางใต้ target folder แล้ว

## Out of scope

- สร้าง/ลบ Target Base
- สร้าง Table ใหม่ผ่าน OpenAPI
- ย้าย internal Base folder ผ่าน API (API ไม่ expose primitive นี้)
- Dashboard, Automation/Workflow และ Advanced Permission parity ใน operator นี้
- Production Worker/D1/Queue deployment หรือ schedule change
- TikTok Ads
- Automatic Weekly evidence ซึ่งยังรอตามเวลาจริง 2026-08-24

## Safety contract

1. Preview/Verify = GET-only, remote mutation 0.
2. Apply fail-closed ถ้า destination table 33 รายการยังมีไม่ครบใน Target Base.
3. Folder membership ตรวจผ่าน OpenAPI ไม่ได้ จึงต้องใช้ `CONFIRM_TARGET_FOLDER_PLACEMENT=YES` ก่อน Apply.
4. Underlying Lark client's `createTable()` ต้องไม่ถูกเรียกใน customer operator path.
5. Source Base mutation = 0; delete table/field/record = 0.
6. Existing non-empty/non-exact target table ต้อง block แทน overwrite.
7. Secrets/App tokens อ่านจาก environment เท่านั้นและ output แสดงเฉพาะ SHA-256 identity.

## Required tests

- missing preplaced destination table blocks
- empty preplaced shell is claimed without underlying `createTable()`
- existing non-empty table remains visible for exact/conflict parity preflight
- ordinary fields/records, relation IDs, formula IDs and supported view properties retain existing consolidation coverage
- focused tests + `npm run check` + `npm test` + `npm run test:report-reliability` + `npm audit` + `npm run deploy:dry-run`

## Implementation result

Repository implementation is complete on Draft PR #661 and has not mutated customer Lark.

- Added `preplaced-lark-base-target` safety adapter. It hides only safe empty destination shells from the generic
  planner and intercepts its table-provisioning call as an in-place primary-field/default-view update. The
  underlying real target client's `createTable()` is never called.
- Customer operator now requires all 33 destination names to already exist in the target Base, reports
  `remoteTableCreates: 0`, and requires `CONFIRM_TARGET_FOLDER_PLACEMENT=YES` before Apply.
- Existing non-empty target tables remain visible to the existing exact/conflict preflight. This preserves the
  already-synced `RAW_TikTok_Creator_Videos` only if parity is acceptable; otherwise the run fails closed.
- Added focused regression proving missing preplaced table blocking, safe shell claim, underlying create-table
  call count zero, record copy, and preservation of existing non-empty tables for parity inspection.
- Exact Branch Verification run `32024949257`, job `95372300469`, head
  `896d63518ebe44143652a17764abf980b5de982e` passed every step: install, syntax/architecture/hygiene,
  all focused integration suites, full Unit/Workers runtime, Report Reliability, dependency audit,
  Wrangler dry-run, diff check and diagnostics upload.
- No customer App token, Lark write, source mutation, Worker deploy, D1/Queue mutation or schedule change was run.

## Acceptance criteria

Repository implementation/CI criteria are passed. Remaining live closure is deliberately customer-owned:

- run GET-only preview against the actual source/target credentials;
- prove all 33 source names and all 33 preplaced target names are present;
- confirm all destination tables are under `Setup Phase | Social MKT Data Hub` in the UI;
- run one controlled Apply only after target ownership/credential verification;
- run GET-only post-Apply field/record/view parity verification;
- close Dashboard/Automation/Advanced Permission parity separately.

Detailed workstream record:
`docs/project-brain/customer-base-consolidation-v1.md`.

Repository-wide closeout/Weekly scheduled evidence authority before this explicit customer workstream remains archived
in `docs/project-brain/repository-final-closeout-2026-08-17.md`; this branch does not replay or replace the
2026-08-24 automatic Weekly evidence gate.
