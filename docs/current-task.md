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
POLICY_B_PREVIEW_READY              = TRUE
FULL_PARITY_READY                   = FALSE
CUSTOMER_LARK_APPLY                 = DISABLED
SOURCE_MUTATION                     = ZERO
TARGET_MUTATION                     = ZERO_TO_DATE
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

## Objective and authority

Create exact functional/UI parity for the 32 clone-scope Tables from the approved local `.base` export inside customer Base
`✨Marketing Content Calendar`, preserving every resource that existed in Target before migration.

Exact authority:

- SHA-256 `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- 33 Tables / 723 Fields / 35,528 Records / 111 Views
- 12 Relations / 4 Formulas / 6 Dashboards / 2 Workflows / 4 Advanced Permission roles
- clone scope = 32 Tables / 705 Fields / 33,488 Records / 110 Views
- `🎵 RAW_TikTok_Creator_Videos` = immutable `protected_external_reuse`; Target live state is authoritative for this Table only

Latest observed immutable Target set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

## Closed read-only evidence

Do **not** rerun unchanged v6, permission semantic audit, or View manifest.

Real Target GET-only v6 proved:

- Policy-B preview ready
- Target before = 4 Tables
- clone-scope Target present = 0
- plan create = 32 / reuse = 0 / conflicts = 0 / warnings = 0
- remote mutation = 0
- Apply disabled

## Implemented automatic parity

Existing `consolidate-lark-base.js` remains the only Table migration engine. No parallel clone engine is allowed.

Implemented and CI-verified:

- Table / Field / Record clone
- deterministic Relation / Formula remap
- Relation record-ID remap
- basic Views
- hidden fields + filters
- documented View `hierarchy_config.field_id` phase
- canonical GET-only Field/Record/Relation/Formula/View verifier
- immutable pre-existing Target Table write fence

Automatic parity still needs controlled Apply wiring; implementation itself is not the blocker.

## View manual parity — procedure + verifier implemented

Retained safe View manifest evidence:

- file `customer-base-view-manual-parity.json`
- SHA-256 `7dabe74dd30291623e1620127f49f31fb2bb5d8131b36fcffe1884b5b089dc10`
- 32 Tables / 110 Views
- 0 remote request / 0 mutation

Ownership:

- automatic-owned: hidden fields 11 Views / 85 assignments, filters 78 Views, hierarchy 1 View
- manual-owned: field order 110 Views, sort 41, group 4, explicit non-null widths 70 Views / 898 assignments, row height 110, frozen columns 110
- row-height level = 1 for all 110 Views
- frozen-column count = 1 for all 110 Views
- sort state collapses to 8 profiles
- all 4 group states are `platform DESC`

Implemented / CI-verified contracts:

- `customer_base_view_manual_parity_execution_plan_v1`
- `customer_base_view_manual_parity_verifier_v1`
- parity classifier `customer_base_clone_parity_coverage_v4`

Manual View execution happens only after migration-owned Tables/Views exist. Post-configuration verification uses semantic names and
ignores unrelated customer Tables plus automatic-owned hidden/default-width metadata.

## Advanced Permission — implementation complete, Apply wiring pending

Exact semantic audit proved:

- roles: Reader / General / Editor / Client
- members = 0
- dashboard role rules = 0
- no field/record fine-grained rules
- current Source Table rules = 17 per role = 68 total
- 6 orphaned historical Table references repeated across all 4 roles = 24 forensic-only entries; never materialize them
- permission values = 0 / 1 / 2 / 4
- schemaVersion = 2
- exported baseRule values = 1

Implemented / CI-verified:

- read-only role planner
- current Source Table-name → Target Table-ID remap
- orphan-reference forensic retention
- pre-existing Target role immutable fence
- documented role list/create transport only
- GET-only expected role/table-permission verifier

Remaining role work: controlled Apply wiring + explicit idempotent partial-role recovery before role writes can be enabled.

## Dashboard / Workflow exact resource evidence

User-run local resource manifest v1 was structurally successful against the exact Source authority and performed zero remote operations.
Its uploaded file SHA-256 is `ef1b84d6a3e9a5da35c3b586a7685d67b2bd62efc0209a1ab1007c4484940d40`.

**Security classification:** that v1 output is forensic input only, **not a retained-safe artifact**. Review found that it still emitted some
internal auth/tenant/user/base/generated-step/Select-option identifiers. No such raw values are copied into repository documentation.

Safe structural facts extracted from v1:

```text
Dashboards                         6
Dashboard charts                  75
Dashboard chart counts            13 / 10 / 11 / 8 / 11 / 22
Dashboard advanced-perm enabled   false for all 6
Dashboard snapshots               6 opaque fingerprints
Chart snapshots                   75 opaque fingerprints
Workflows                         2
Mapped Table references           26
Mapped Field references           131
Parsed JSON strings               4
Opaque string fingerprints        81
Unresolved reference-like values  0
Remote request                    0
Remote mutation                   0
Target read/write                 false / false
Apply                             disabled
```

Workflow semantic evidence:

1. `AI Materialization → MKT_AI_Report_Runs`
   - trigger `setRecord`
   - export status `1`
   - steps: `SetRecordTrigger` → four `GenerateAiTextWithSkyLarkAction` steps → `SetRecordAction`
2. `Eligible AI Run → Lark Group Notification`
   - trigger `addRecordV2`
   - export status `0`
   - exported Draft steps: `AddRecordTrigger` → `Delay` (1 minute)

Dashboard snapshots are opaque in the export manifest, so their full visual/chart semantics cannot be reconstructed safely from this
artifact alone. Dashboard parity therefore requires supported UI/source-reference reconstruction after Target clone resources exist.

Workflow definitions are substantially parseable and have zero unresolved Table/Field references, so they can drive a deterministic
manual checklist. They still must **not** be replayed as internal `FlowSchema`/`Draft` OpenAPI payloads without a documented write contract.

## Resource manifest redaction v2

Root cause fixed in repository after reviewing v1 output:

- redact `authKey` values
- redact tenant/user/base identity tags
- redact generated Workflow step/state IDs, including embedded expressions
- map Select option IDs to semantic Table/Field/option names when defined
- redact unknown generated reference-like values by fingerprint only
- distinguish generated `rec/trig/...` identities from ordinary words such as `recommendations` / `trigger_name`
- regression tests assert raw identifiers cannot survive serialization

Contracts upgraded:

- `customer_base_resource_manual_parity_manifest_v2`
- `customer_base_resource_manual_parity_operator_v2`

The v1 file does **not** need to be rerun merely to recover its structural evidence. v2 exists to prevent future unsafe output and must
pass exact-head CI before any further use.

## Dashboard / Workflow capability rule

- Do not infer request bodies from export snapshots or response metadata.
- Generic create/update permission scopes are not a definition-replay contract.
- Dashboard list/copy capability is not treated as proven cross-Base export-definition replay.
- Keep Dashboard/Workflow writes disabled unless a documented request contract is proven.
- Otherwise use exact manual UI/source-reference procedures after automatic clone Apply.

## Apply gate

`cloneApplyEnabled` remains `false` until:

- one resumable controlled orchestration is implemented around the existing consolidator
- documented hierarchy phase is wired
- Advanced Permission phase is wired with partial-role recovery
- canonical verifier is wired post-Apply
- automatic/manual ownership is frozen before mutation
- Dashboard/Workflow manual procedures and post-configuration verification criteria are explicit
- exact-head CI passes

Planned controlled order:

`protected Target snapshot → consolidation → hierarchy parity → Advanced Permission → canonical GET-only verifier → manual View/Dashboard/Workflow UI parity → post-configuration verification → manual folder placement`

No Customer Apply is authorized yet.

## Safety contract

1. Exact local export remains authority.
2. Every pre-existing Target Table/resource is immutable.
3. TikTok protected external remains zero-write and outside clone traversal.
4. No customer resource delete.
5. No Source mutation.
6. No Worker/D1/Queue/schedule/deploy mutation in this workstream.
7. No undocumented request payloads or guessed endpoint paths.
8. PR #661 stays Draft until controlled Apply + verification close.
9. Files known to expose internal identifiers are never committed as evidence artifacts.

## Next closure sequence

1. Pass exact-head CI for resource-manifest redaction v2.
2. Convert the two Workflow definitions and six opaque Dashboard identities into explicit manual post-Apply verification procedures without storing raw internal IDs.
3. Implement/test one resumable controlled Apply orchestration around existing shared components only.
4. Keep Apply disabled until failure/recovery behavior is proven.
5. One controlled customer Apply to migration-created resources only.
6. GET-only canonical verification.
7. Execute manual View/Dashboard/Workflow parity.
8. Export/verify Target manual View state and retain safe UI evidence for Dashboard/Workflow.
9. Move cloned Tables under `Setup Phase | Social MKT Data Hub` manually if no supported folder API exists.
10. Ready/Merge PR #661 only after all parity gates pass.

Detailed record: `docs/project-brain/customer-base-consolidation-v1.md`.