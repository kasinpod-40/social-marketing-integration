# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = POLICY_B_LIVE_PREVIEW_PASS_PARITY_COVERAGE_BLOCKED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_AUTHORITY                    = LOCAL_LARK_BASE_EXPORT
SOURCE_EXPORT_FILE                  = Social MKT Data Hub(20260818-030125).base
SOURCE_EXPORT_SHA256                = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
SOURCE_AUTHORITY_TABLES             = 33
CLONE_PARITY_TABLES                 = 32
PROTECTED_EXTERNAL_TABLES           = 1
FULL_PARITY_REQUIRED                = TRUE_FOR_CLONE_SCOPE
SOURCE_LIVE_33_OF_33_GATE           = REMOVED_NOT_AUTHORITY
PREEXISTING_TARGET_TABLE_POLICY     = ALL_READ_ONLY_IMMUTABLE
REQUIRED_PROTECTED_TARGET_TABLE     = 🎵 RAW_TikTok_Creator_Videos
REQUIRED_PROTECTED_ACTION           = PROTECTED_EXTERNAL_REUSE
CUSTOMER_LARK_APPLY                 = BLOCKED_UNTIL_FULL_CLONE_COVERAGE
SOURCE_MUTATION                     = ZERO
TARGET_MUTATION                     = ZERO_TO_DATE
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

## Objective

สร้างทรัพยากร Social MKT Data Hub ใน Base ลูกค้า `✨Marketing Content Calendar` ให้ functional/UI parity 100%
สำหรับ **32 clone-scope Tables** กับไฟล์ export ล่าสุด `Social MKT Data Hub(20260818-030125).base` โดยรักษา
`🎵 RAW_TikTok_Creator_Videos` ของลูกค้าที่มีอยู่แล้วเป็น protected external live source แบบ zero-write.

ผู้ใช้ยอมให้สร้าง Table ใหม่ที่ root ก่อนและจะย้ายเข้า `Setup Phase | Social MKT Data Hub` ภายหลังหาก OpenAPI
ไม่รองรับ internal Base navigation-folder placement. Generated IDs เช่น `tbl...`, `fld...`, `vew...`, `wkf...`
เปลี่ยนได้เฉพาะเมื่อ references ถูก remap แบบ deterministic และผลลัพธ์เชิงข้อมูล/พฤติกรรม/UI เทียบเท่า Source.

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

## Selected migration policy — B: Protected external source

ผู้ใช้เลือก Policy B หลัง GET-only audit ยืนยันว่า Target `🎵 RAW_TikTok_Creator_Videos` เป็น live table ที่ drift จาก
pinned historical export จริง ทั้ง Field representation และ primary-key record set. การบังคับ `reuse_exact` พร้อมกับ
กฎห้ามแตะ Table เดิมจึงทำพร้อมกันไม่ได้โดยไม่แก้หรือปลอม comparison.

Contract ที่ล็อกแล้ว:

- Complete export 33 Tables ยังเป็น immutable authority artifact และต้องผ่าน exact SHA/count gate เหมือนเดิม.
- Clone parity scope = 32 Tables ที่ยังไม่มีใน Target.
- `🎵 RAW_TikTok_Creator_Videos` = `protected_external_reuse`.
- Target live TikTok เป็น authority สำหรับ current records/UI ของ Table นี้.
- TikTok ถูก exclude จาก clone comparison, clone plan, Apply traversal และ clone verifier traversal.
- TikTok ยังอยู่ใน outer pre-existing Target write fence: ห้าม schema/record/view/rename/delete/repair write ทุกชนิด.
- อีก 3 unrelated customer Tables อยู่นอก migration plan และถูกป้องกันเช่นเดียวกัน.

Implementation guard ปัจจุบันคือ `protect-customer-lark-target.js` contract v3 สำหรับ Policy B; legacy caller ที่ไม่เปิด
protected-external policy ยังคง v2 + `reuse_exact` behavior เพื่อไม่ให้เกิด regression ข้ามระบบ.

## Latest real Target GET-only evidence — 2026-08-18

User-run exact Policy-B audit ผ่านแล้วบน approved export และ Target จริง:

- operator contract `customer_base_full_parity_operator_v5`
- `ok=true`, `blockers=[]`
- authority 33 Tables / clone scope 32 / protected external 1
- Target before = 4 pre-existing Tables
- clone-scope Tables present = 0
- plan `createTables=32`, `reuseExactTables=0`, `conflicts=0`, `warnings=0`
- projected Target after = 36 Tables
- clone-scope source totals = 705 Fields / 33,488 Records / 110 Views
- protected plan `ok=true`
- TikTok action = `protected_external_reuse`
- `remoteMutationCount=0`
- `cloneApplyEnabled=false`

ผลนี้ปิด Policy-B live Preview gate แล้ว. ห้ามสั่ง GET-only audit เดิมซ้ำโดยไม่มี code/contract change ใหม่.

## Immutable pre-existing Target contract

ทุก Table ที่มีอยู่ใน `✨Marketing Content Calendar` **ก่อน migration เริ่ม** เป็น customer-owned existing resource และต้อง
เป็น read-only สำหรับ workstream นี้ทั้งหมด ไม่จำกัดแค่ชื่อที่เห็นในภาพหรือชื่อที่รู้ล่วงหน้า.

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

Unrelated customer Tables ไม่ต้องมี Source plan entry แต่ยังถูก write fence ป้องกันเต็มรูปแบบ.

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

## Full-parity dimensions for the 32-table clone scope

Final acceptance ต้องตรวจทุก dimension ที่ export แสดงว่ามีอยู่และเกี่ยวข้องกับ 32 clone-scope Tables:

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
- Timebar / hierarchy where represented
- Card / color / row-height / frozen-column configuration where represented
- Forms / Questions when represented in export
- Dashboards / themes / blocks / layout / data_config
- Workflows/Automation definitions + steps + exported state
- Advanced Permission roles/config represented in export
- attachment-like cells when included

TikTok protected-external records/schema/UI are intentionally outside clone parity and must instead pass zero-write identity protection.

## OpenAPI capability rule

ห้ามเหมารวม exported dimension ว่า `manual/separate` จนกว่าจะตรวจ official Lark/Feishu OpenAPI contract จริง.
Current official API surface confirms at least:

- Views: list/create/update/get/delete under Bitable v1.
- Forms: read/update APIs exist and form is a View type.
- Dashboards: list and copy APIs exist under Bitable v1.
- Workflows: list API exists; platform scopes expose create/update/delete/status capabilities.
- Advanced Permission: role list/create/update/delete and collaborator management APIs exist; Target is already `isAdvanced=true`.

ดังนั้น parity implementation ต้องเป็น capability-driven:

1. official request/response contract รองรับ → implement clone/remap/verify จริงใน shared path;
2. official API อ่านได้แต่เขียนไม่ได้ → verifier ต้องอ่านและ fail closed พร้อม explicit manual blocker;
3. official API ไม่ expose dimension นั้นจริง → เก็บเป็น explicit manual action พร้อม evidence; ห้ามอ้าง 100% automated parity;
4. ห้ามสร้าง endpoint จากการเดา path หรือ response metadata.

## Implementation result

- `scripts/lib/lark-base-export.js` parses actual export envelope: `gzipSnapshot`, `gzipExtraInfo`, `gzipBaseRole`,
  `gzipAccessConfig`, `gzipDashboard`, `gzipAutomation`.
- Compressed payloads are gzip/base64 JSON decoded locally.
- Table/Field/Record/View counts are deduped by exported stable IDs; duplicate snapshot chunks cannot inflate parity counts.
- Exact export SHA/counts are pinned as authority.
- `scripts/lib/lark-base-export-source-client.js` is the read-only adapter for the existing shared consolidator; no parallel transport.
- Adapter supports a deterministic `excludedTableNames` clone projection; direct reads of excluded TikTok fail closed with
  `LARK_BASE_EXPORT_TABLE_OUTSIDE_SCOPE` while the complete export remains separately pinned and inspected.
- Rich export View metadata is retained, including field order, sort, group, column info, hierarchy, card and color state.
- Export resources retain dashboards, workflows, roles/access config for later parity phases.
- `protect-customer-lark-target.js` v3 structurally supports `protected_external_reuse`; protected external names must already
  exist in the protected snapshot and must not appear in clone plan.
- Legacy v2 exact-reuse behavior remains backward-compatible for callers that do not enable Policy B.
- Shared `consolidate-lark-base.js` currently clones Tables, Fields, Records, relation/formula remaps and only the supported
  View subset. Its Apply loop writes Views only on migration-created Tables.
- Current canonical verifier is still insufficient for full parity; Apply remains intentionally disabled.
- No Customer Lark mutation has been enabled or executed by this workstream.

## Known implementation gaps before Apply

- full View field order/sort/group/hierarchy/card/color/row-height/frozen-column parity;
- full Form metadata/question parity when represented;
- dashboard parity using official supported operations and deterministic source→target references;
- workflow definition/state parity using only documented APIs/capabilities;
- Advanced Permission role/member parity with deterministic Table/Field remap;
- attachment-like cell handling if export contains any;
- canonical verifier comparing full Field config, record payloads, relation/formula references and every supported UI resource;
- replace any speculative `/open-apis/base/v3/...` audit paths with documented Bitable/Base endpoints before they become gates;
- remove the current broad `DASHBOARD_AUTOMATION_PERMISSION_PARITY_SEPARATE` manual assumption once capability coverage is classified.

## Safety contract

1. Local export audit = local read-only, zero remote request.
2. Exact SHA mismatch blocks before Target mutation.
3. Every pre-existing Target table is immutable/read-only for migration.
4. Existing `🎵 RAW_TikTok_Creator_Videos` = `protected_external_reuse`, structurally excluded from clone traversal and zero-write.
5. Protected-table writes must be rejected before OpenAPI request.
6. Only migration-created post-snapshot Tables may receive writes.
7. No delete of customer resources.
8. No Worker/D1/Queue/schedule mutation.
9. No Source mutation.
10. Apply remains blocked until every clone-scope exported dimension has clone/remap/verify coverage or an explicit verified manual blocker.
11. PR remains Draft until controlled Apply + GET-only canonical verification are complete.

## Required tests / gates

- actual `.base` gzip-envelope parsing
- duplicate snapshot stable-ID dedupe
- exact latest SHA/count/table-set comparison
- malformed/missing payload fail closed
- local audit requires no Lark credentials
- local export Source adapter compatibility + excluded TikTok scope guard
- all pre-existing Target tables immutable write fence
- Policy-B protected-external plan gate
- legacy v2 `reuse_exact` regression
- full clone/remap regressions for fields, records, relations, formulas and views
- Filter/Sort/Group/visible fields/hierarchy/card/forms/dashboards/workflows/roles coverage before Apply
- canonical verifier coverage for every automated dimension
- `npm ci`
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Next closure sequence

1. Keep the successful Policy-B Target Preview as the current live evidence; do not rerun unchanged GET-only audit.
2. Correct stale repository docs from old `reuse_exact` policy to `protected_external_reuse`.
3. Audit official OpenAPI capability for each remaining exported dimension; remove speculative API paths and broad manual assumptions.
4. Extend the existing shared Lark client/consolidator only where official contracts support clone/remap/verify.
5. Add deterministic canonical verifier coverage for full Field/Record/View plus dashboard/workflow/role/form resources.
6. Run exact-head CI. PR stays Draft and Apply stays disabled.
7. Run one fresh GET-only capability/full-parity Target audit only after the new code exists; require zero blockers/unhandled automated dimensions and zero mutation.
8. Enable one controlled Apply path that is fenced to the 32 migration-created Tables/resources only; TikTok and every pre-existing Table remain zero-write.
9. Run GET-only canonical verifier and prove all 32 clone-scope resources match export semantics while pre-existing Target identities remain unchanged.
10. Manually move cloned Tables into `Setup Phase | Social MKT Data Hub` only if internal folder placement is still unavailable through supported API.
11. Update README/CHANGELOG/Project Brain, then Ready/Merge PR #661 only after all gates above pass.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
