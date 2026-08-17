# Current Task — Customer Base Consolidation v1

## Status

```text
TASK_STATUS                         = ROOT_TABLE_PROVISIONING_IMPLEMENTED_CI_PENDING
CURRENT_PROGRAM                     = CUSTOMER_BASE_CONSOLIDATION_ROOT_PROVISION_THEN_MOVE_V1
SOURCE_BASE                         = Social MKT Data Hub
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
EXPECTED_SOURCE_TABLES              = 33
REMOTE_TABLE_CREATE                 = PROVISION_ONLY_EXPLICIT_CONFIRMATION
SOURCE_MUTATION                     = BLOCKED
CUSTOMER_LARK_PROVISION             = NOT_RUN
CUSTOMER_LARK_APPLY                 = NOT_RUN
DRAFT_PR                            = 661
BRANCH_VERIFICATION                 = PENDING_EXACT_HEAD
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
NEXT_AUTOMATIC_SCHEDULED_EVIDENCE   = 2026-08-24T08:30:00+07:00
TIKTOK_ADS                          = DEFERRED_NOT_CURRENT_BLOCKER
DLQ_REDRIVE                         = BLOCKED_OFF
```

## Objective

ย้าย Table-level structure/data จาก `Social MKT Data Hub` เข้า Base เดิมของลูกค้า `✨Marketing Content Calendar`
โดยให้ Table ทั้ง 33 รายการสุดท้ายอยู่ใต้ internal Base folder `Setup Phase | Social MKT Data Hub` และรักษา
field/record/relation/formula/view fidelity ให้มากที่สุดโดยไม่สร้าง Base/engine ใหม่และไม่ใช้ Cross-Base Sync
เป็นตัวแทนของ schema จริง.

ผู้ใช้อนุญาตล่าสุดให้ operator สร้างเฉพาะ Blank Table ที่ขาดใน Target Base ที่ root/default placement ก่อน แล้วผู้ใช้
จะย้าย Table เหล่านั้นเข้า `Setup Phase | Social MKT Data Hub` ด้วย Lark UI เองก่อน Consolidation Apply.

## In scope

- Read-only source/target preflight ผ่าน Lark OpenAPI
- exact contract 33 source table names
- ใช้ existing central `LarkBitableClient`
- explicit `--provision-missing` mode สำหรับสร้างเฉพาะ destination table names ที่ยังไม่มีใน Target Base
- provisioning ใช้ safe empty one-field shell, rerun ต้อง idempotent และ existing table ต้องไม่ถูก overwrite
- duplicate target table name หรือ table-limit violation ต้อง fail closed ก่อน create
- หลัง provisioning ผู้ใช้ย้าย Table เข้า target folder ด้วย Lark UI เพราะ OpenAPI ไม่มี folder-placement primitive
- Consolidation Apply ยังใช้ preplaced-table safety adapter: empty shell ถูก claim ด้วย `updateField`/`updateView`
  แล้วใช้ existing field/record/relation/formula/view migration path
- reuse existing target table ได้เฉพาะเมื่อ generic parity preflight ยืนยันว่าเข้ากันได้
- source read-only; ไม่มี delete; ไม่มี schedule/automation/runtime mutation
- Apply ต้องมี explicit confirmation ว่า Table ทั้งหมดถูกวางใต้ target folder แล้ว

## Out of scope

- สร้าง/ลบ Target Base
- ย้าย internal Base folder ผ่าน API (API ไม่ expose primitive นี้)
- สร้าง Table ระหว่าง Consolidation Apply
- Dashboard, Automation/Workflow และ Advanced Permission parity ใน operator นี้
- Production Worker/D1/Queue deployment หรือ schedule change
- TikTok Ads
- Automatic Weekly evidence ซึ่งยังรอตามเวลาจริง 2026-08-24

## Safety contract

1. Preview/Verify = GET-only, remote mutation 0.
2. `--provision-missing` เป็น write mode แยก ต้องมี `CONFIRM_WRITE=YES`,
   `CONFIRM_CUSTOMER_BASE_TABLE_PROVISION=YES` และ `CONFIRM_TARGET_BASE=MARKETING_CONTENT_CALENDAR`.
3. Provisioning อ่าน Target table list ก่อนและสร้างเฉพาะ exact expected names ที่หาย; rerun ต้อง create 0 เมื่อครบแล้ว.
4. Duplicate destination name หรือ table-limit violation ต้อง block ก่อน mutation.
5. Apply fail-closed ถ้า destination table 33 รายการยังมีไม่ครบใน Target Base.
6. Folder membership ตรวจผ่าน OpenAPI ไม่ได้ จึงต้องใช้ `CONFIRM_TARGET_FOLDER_PLACEMENT=YES` ก่อน Apply.
7. Underlying Lark client's `createTable()` ต้องไม่ถูกเรียกจาก Consolidation Apply path.
8. Source Base mutation = 0; delete table/field/record = 0.
9. Existing non-empty/non-exact target table ต้อง block แทน overwrite.
10. Secrets/App tokens อ่านจาก environment เท่านั้นและ output แสดงเฉพาะ SHA-256 identity.

## Required tests

- provisioning creates only missing shell tables
- provisioning rerun is idempotent
- duplicate destination names block before any create call
- missing preplaced destination table blocks Apply path
- empty preplaced shell is claimed without underlying `createTable()` during Apply
- existing non-empty table remains visible for exact/conflict parity preflight
- ordinary fields/records, relation IDs, formula IDs and supported view properties retain existing consolidation coverage
- focused tests + `npm run check` + `npm test` + `npm run test:report-reliability` + `npm audit` + `npm run deploy:dry-run`

## Implementation result

Draft PR #661 now contains the user-authorized root/default-placement provisioning path and has not mutated customer Lark.

- Extended the existing `preplaced-lark-base-target` module with idempotent missing-table provisioning instead of adding
  another Lark transport or migration engine.
- Added `--provision-missing` to the existing customer consolidation operator.
- Provisioning requires explicit write confirmations, creates only missing expected table names as empty one-field shells,
  preserves every existing table, and fails closed on duplicate names or table-limit overflow.
- Consolidation Apply remains unchanged in safety semantics: it cannot remotely create a missing table and still requires
  explicit confirmation that all 33 destination tables have been moved into `Setup Phase | Social MKT Data Hub`.
- Added focused regressions for create-only-missing, idempotent rerun, duplicate-name fail-closed, and retained Apply guards.
- No customer App token, Lark write, source mutation, Worker deploy, D1/Queue mutation or schedule change has been run from
  this implementation work.
- Exact-head Branch Verification is required before live provisioning.

## Acceptance criteria

Remaining live closure sequence:

- exact-head Branch Verification passes;
- run one controlled `--provision-missing` against the customer Target Base;
- verify expected table names are present and no existing table was replaced;
- user moves the newly created root/default-placement tables into `Setup Phase | Social MKT Data Hub` in Lark UI;
- run GET-only preview against actual source/target credentials;
- prove all 33 source names and all 33 target names are present with no blocking conflict;
- run one controlled Apply only after folder-placement confirmation;
- run GET-only post-Apply field/record/view parity verification;
- close Dashboard/Automation/Advanced Permission parity separately.

Detailed workstream record:
`docs/project-brain/customer-base-consolidation-v1.md`.

Repository-wide closeout/Weekly scheduled evidence authority before this explicit customer workstream remains archived
in `docs/project-brain/repository-final-closeout-2026-08-17.md`; this branch does not replay or replace the
2026-08-24 automatic Weekly evidence gate.
