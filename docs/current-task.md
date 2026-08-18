# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = POLICY_B_PREVIEW_PASS_FULL_PARITY_BLOCKED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_AUTHORITY                    = LOCAL_LARK_BASE_EXPORT
SOURCE_EXPORT_FILE                  = Social MKT Data Hub(20260818-030125).base
SOURCE_EXPORT_SHA256                = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
SOURCE_AUTHORITY_TABLES             = 33
CLONE_PARITY_TABLES                 = 32
PROTECTED_EXTERNAL_TABLES           = 1
PREEXISTING_TARGET_TABLE_POLICY     = ALL_READ_ONLY_IMMUTABLE
REQUIRED_PROTECTED_TARGET_TABLE     = 🎵 RAW_TikTok_Creator_Videos
REQUIRED_PROTECTED_ACTION           = PROTECTED_EXTERNAL_REUSE
POLICY_B_PREVIEW_READY              = TRUE
FULL_PARITY_READY                   = FALSE
CUSTOMER_LARK_APPLY                 = DISABLED
SOURCE_MUTATION                     = ZERO
TARGET_MUTATION                     = ZERO_TO_DATE
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

## Objective

สร้างทรัพยากร `Social MKT Data Hub` ใน Base ลูกค้า `✨Marketing Content Calendar` ให้ functional/UI parity
สำหรับ **32 clone-scope Tables** จาก exact approved local export โดยไม่แตะ resource ที่มีอยู่ก่อน migration.

`🎵 RAW_TikTok_Creator_Videos` เป็น protected live external source ของลูกค้าและอยู่นอก clone parity. Generated
Table/Field/Record/View IDs เปลี่ยนได้เฉพาะเมื่อ references ถูก remap แบบ deterministic และ verifier ยืนยัน semantic parity.

## Source authority

Exact approved export:

- file: `Social MKT Data Hub(20260818-030125).base`
- SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- size: 13,331,288 bytes
- 33 Tables
- 723 Fields
- 35,528 Records
- 111 Views
- 12 Relations
- 4 Formulas
- 6 Dashboards
- 2 Workflows/Automations
- 4 Advanced Permission roles
- `📣 MKT_Report_Top_Ads` มี duplicate snapshot chunk แต่ stable exported Table ID เดียว; parser dedupe แล้ว

Live Source Base token ไม่ใช่ authority ของ migration นี้.

## Policy B — Protected External Source

Policy ที่ผู้ใช้เลือกและล็อกแล้ว:

- clone parity scope = 32 Source Tables ที่ยังไม่มีใน Target;
- `🎵 RAW_TikTok_Creator_Videos` = `protected_external_reuse`;
- Target live TikTok เป็น authority สำหรับ current records/schema/UI ของ Table นี้;
- TikTok ถูก exclude จาก clone comparison, plan, Apply traversal และ clone verifier traversal;
- TikTok และ Table ลูกค้าที่มีอยู่ก่อน migration ทุกตัวอยู่ใต้ write fence แบบ zero-write;
- migration ห้าม repair/overwrite existing customer resources ให้ตรง historical export;
- legacy caller ที่ไม่เปิด protected-external policy ยังคง v2 `reuse_exact` contract เดิม.

Latest observed immutable Target set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

Forbidden against every pre-existing Target Table:

- create duplicate by name
- rename/delete
- create/update Field
- create/update Record
- create/update View or View property
- alter Sync/customer configuration

Only resources created by this migration after the protected snapshot may eventually be writable.

## Real Target evidence — v6 GET-only PASS

User-run audit on exact verified v6 baseline proved:

```text
operator                         customer_base_full_parity_operator_v6
ok                               true
policyBPreviewReady              true
fullParityReady                  false
remoteMutationCount              0
cloneApplyEnabled                false
source authority                 33 Tables
clone scope                      32 Tables
protected external              1 Table
Target before                    4 Tables
clone-scope Target present       0
plan createTables                32
plan reuseExactTables            0
conflicts                        0
warnings                         0
clone Source Fields              705
clone Source Records             33,488
clone Source Views               110
```

View features represented in the **32-table clone scope**:

```text
view type                        grid 110/110
hiddenFields                     11 Views
filterInfo                       78 Views
fieldOrder                       110 Views
sortInfo                         41 Views
group                            4 Views
colInfos                         94 Views
rowHeightLevel                   110 Views
frozenColCount                   110 Views
hierarchyConfig                  1 View
cardViewSetting                  0 Views
colorInfo                        0 Views
Form Views                       0
```

Do not rerun this unchanged Target audit merely to reproduce the same Policy-B evidence.

## Implemented parity coverage

### Shared clone path

Existing `consolidate-lark-base.js` remains the only table migration engine. It already covers:

- create clone-scope Tables
- ordinary Fields
- deterministic Relation/Formula remap
- Records and Relation record-ID remap
- basic View creation
- supported hidden/filter View mutation
- no View write to reused/existing protected Tables

### Canonical verifier

`verify-lark-base-clone-canonical-parity.js`

Contract: `customer_base_clone_canonical_verifier_v1`

Implemented and CI-verified coverage:

- full readable Field config
- Select option generated-ID canonicalization
- Date default canonicalization
- Relation target Table-ID remap
- Formula Table/Field-ID remap
- all readable Record field values
- Relation record-ID remap
- View name/type/public/hidden/filter with Field-ID remap
- unrelated customer Target Tables ignored
- GET-only / zero mutation

The verifier is **not yet wired into an enabled controlled Apply path**, so these dimensions remain wiring blockers rather than readiness passes.

### Documented View hierarchy parity

Official Lark/Feishu OpenAPI explicitly documents updating a View with:

`property.hierarchy_config.field_id`

Implemented components:

- connector decorator reusing existing authenticated/retried Bitable transport;
- exact hierarchy GET/readback;
- idempotent PATCH only when Target differs;
- Source Field-ID → Source field name → Target Field-ID remap;
- post-write GET verification;
- `updateViewHierarchy` added to immutable pre-existing Target write fence;
- post-consolidation phase exists but is not wired to the customer operator.

No other View property mutation is inferred from response metadata.

## View properties still blocked by API-contract evidence

The current approved export represents these properties:

- field order: 110 Views
- sort: 41 Views
- group: 4 Views
- column config: 94 Views
- row height: 110 Views
- frozen columns: 110 Views

Current official documentation proves generic View CRUD and a concrete `hierarchy_config` request, but this workstream has not
found a safe documented request contract for the six properties above. Therefore they are classified as
`documented_write_contract_not_proven`, not as ordinary missing implementation.

Rules:

1. do not invent request keys from exported response metadata;
2. do not send undocumented View properties to customer Target;
3. keep full parity blocked until a documented mechanism or explicit manual parity procedure is proven.

Card/color/Form parity does not block this export because those features are not represented in the 32-table clone scope.

## Dashboard / Workflow / Advanced Permission capability classification

### Dashboards — 6 represented

Official Bitable API exposes:

- list dashboards;
- copy an existing dashboard by `block_id`.

No documented export-payload → create-dashboard-in-existing-Base contract has been proven. A whole-Base copy creates another Base,
which does not satisfy migration into the existing customer Target. Dashboard materialization therefore stays fail-closed.

### Workflows — 2 represented

Official Bitable API exposes workflow listing and workflow-related permission scopes. A complete documented definition-replay request
contract for creating/updating an arbitrary workflow from the local export payload has not yet been proven. Do not guess endpoints.

### Advanced Permission roles — 4 represented

Target reports Advanced Permission v2. Official v2 API documents:

`POST /open-apis/base/v2/apps/:app_token/roles`

with `role_name`, `table_roles`, optional `block_roles`, and optional `base_rule`.

This is potentially automatable, but implementation remains blocked until:

- exact `gzipBaseRole` export structure is inventoried;
- source Table/Dashboard references can be deterministically remapped;
- pre-existing Target roles/resources are snapshotted and protected from update/delete;
- role creation/readback verifier exists.

## Local-only export resource shape audit

Added `scripts/customer-base-export-resource-shape-audit.mjs` plus value-redacted structural inspector.

Purpose: learn the exact shapes of `gzipDashboard`, `gzipAutomation`, `gzipBaseRole`, `gzipAccessConfig` and `gzipExtraInfo`
without leaking primitive values and without any Lark request.

The operator:

- pins the exact approved SHA and all structural counts;
- stops on any authority mismatch;
- prints only property paths, types, array lengths and reference-key counts;
- does not print role member IDs, workflow text, resource IDs/tokens or other primitive values;
- performs `remoteRequestCount=0` and `remoteMutationCount=0`.

## Apply gate

`cloneApplyEnabled` must remain `false` until all of the following are closed:

- canonical verifier wired into the only controlled Apply sequence;
- documented hierarchy phase wired into that sequence;
- fieldOrder/sort/group/colInfos/rowHeight/frozen parity resolved by documented API or explicit verified manual parity;
- 6 Dashboard parity resolved;
- 2 Workflow parity resolved;
- 4 Advanced Permission roles remapped/protected/verified;
- Base-level resources receive the same pre-existing-resource protection principle as Tables;
- exact-head CI passes after final wiring.

No Customer Lark Apply is authorized yet.

## Safety contract

1. Source export is immutable authority.
2. SHA/count mismatch blocks before any Target mutation.
3. Every pre-existing Target Table is immutable.
4. TikTok = `protected_external_reuse`, zero-write and outside clone traversal.
5. Protected writes are rejected before OpenAPI request.
6. No customer resource delete.
7. No Worker/D1/Queue/schedule mutation in this workstream.
8. No Source mutation.
9. No undocumented request payloads or guessed endpoint paths.
10. PR #661 remains Draft until controlled Apply + canonical verification close successfully.

## Required repository gates

- `npm ci`
- `npm run check`
- `npm test`
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`
- diff whitespace/diagnostics

## Next closure sequence

1. Exact-head CI for the canonical verifier, hierarchy parity phase, resource-shape audit and documentation refresh.
2. Run the **local-only value-redacted export resource shape audit once** on the exact approved `.base` file.
3. Use that output to implement only provable Dashboard/Workflow/Advanced Permission remap coverage; keep unsupported capabilities fail-closed.
4. Add Base-level pre-existing resource protection before any Dashboard/Workflow/Role write capability can be enabled.
5. Build one controlled orchestration around the existing shared consolidator → documented parity phases → canonical verifier.
6. Keep customer operator Apply disabled until `fullParityReady=true` by contract.
7. One controlled customer Apply to migration-created resources only.
8. GET-only canonical verification and explicit UI/manual evidence for any API-unexposed dimensions.
9. Only then Ready/Merge PR #661.

Detailed workstream record: `docs/project-brain/customer-base-consolidation-v1.md`.
