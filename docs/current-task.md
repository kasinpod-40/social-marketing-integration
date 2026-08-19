# Current Task — Customer Base Full Parity v1

## Status

```text
TASK_STATUS                         = CONTROLLED_APPLY_IMPLEMENTED_CI_PENDING
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
AUTOMATIC_APPLY_IMPLEMENTED         = TRUE
FULL_PARITY_READY                   = FALSE
CUSTOMER_LARK_APPLY                 = DISABLED_PENDING_EXACT_HEAD_CI_AND_CHECKPOINT
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

## Closed evidence — do not rerun unchanged

Do **not** rerun unchanged v6, permission semantic audit, View manifest, or the unsafe v1 resource manifest.

Real Target GET-only v6 already proved:

- Policy-B preview ready
- Target before = 4 Tables
- clone-scope Target present = 0
- plan create = 32 / reuse = 0 / conflicts = 0 / warnings = 0
- remote mutation = 0
- Apply disabled

Retained safe View evidence:

- `customer-base-view-manual-parity.json`
- SHA-256 `7dabe74dd30291623e1620127f49f31fb2bb5d8131b36fcffe1884b5b089dc10`
- 32 Tables / 110 Views
- local-only / zero remote request / zero mutation

Resource manifest v1 structural facts remain forensic input only. Its uploaded SHA-256 is
`ef1b84d6a3e9a5da35c3b586a7685d67b2bd62efc0209a1ab1007c4484940d40`; raw internal identifiers from that file are never committed.

## Automatic parity implementation

Existing `consolidate-lark-base.js` remains the only Table migration engine. No parallel clone engine is allowed.

Implemented and previously CI-verified:

- Table / Field / Record clone
- deterministic Relation / Formula remap
- Relation record-ID remap
- basic Views
- hidden fields + filters
- documented View `hierarchy_config.field_id` phase
- canonical GET-only Field/Record/Relation/Formula/View verifier
- immutable pre-existing Target Table write fence
- Advanced Permission planner / transport / verifier
- resource-manifest redaction v2

Resource-manifest v2 exact verified milestone:

```text
HEAD    1fb0157714dd4cfca1891b6fdcd0ef0d27ba2ba9
Run     32176109766
Job     95838326966
Result  SUCCESS
```

## Resumable controlled Apply — implemented, exact-head CI pending

The controlled path now composes existing shared components only:

`baseline checkpoint → resumable target adapter → existing consolidation → documented hierarchy → Advanced Permission → canonical GET-only verifier`

New contracts:

- `customer_base_resumable_target_v1`
- `customer_base_advanced_permission_apply_v1`
- `customer_base_controlled_apply_checkpoint_v1`
- `customer_base_controlled_apply_v1`
- `customer_base_controlled_apply_operator_v1`

### Table partial-write recovery

`prepare-lark-base-resumable-target.js` does not replace the consolidator. It adapts the Target around the existing consolidator:

- checkpoint baseline Tables remain immutable;
- unrelated current customer Tables remain immutable;
- a clone-scope Table name absent from the pre-Apply baseline but present on retry is treated as a recovery candidate;
- recovery candidate is hidden from preflight, then claimed in place by the existing consolidator;
- existing migration-owned fields are reused only when their safe semantic mutation matches;
- existing migration-owned records are reused only when requested field values match by unique primary value;
- only missing records are created;
- protected/unowned writes fail closed;
- any conflicting partial state stops before further mutation.

This closes the previous failure mode where a process interruption after Table creation made the next consolidation preview reject its own partial Table.

### Advanced Permission partial-role recovery

`apply-lark-base-advanced-permission-parity.js`:

- freezes every role name present in the checkpoint baseline;
- never adopts or updates a pre-existing customer role;
- creates only missing migration roles;
- immediately reads each created role back;
- on retry, reuses only exact migration-owned role/table-permission state;
- mismatched partial roles block before new mutation.

### Controlled operator

`scripts/customer-base-controlled-apply.mjs` has two explicit modes:

```bash
node scripts/customer-base-controlled-apply.mjs --prepare-checkpoint
```

- GET-only
- exact export SHA/count gate
- exact Target Base-name gate
- snapshots protected Table/Role identities
- writes a local private `0600` checkpoint under Downloads by default
- performs zero customer mutation

Apply mode exists but is **not authorized yet**:

```bash
CUSTOMER_BASE_APPLY_CONFIRMATION=CUSTOMER_BASE_CONTROLLED_APPLY_V1 \
node scripts/customer-base-controlled-apply.mjs --apply
```

It cannot write without the exact confirmation token and matching checkpoint/Source SHA/clone scope.

## View manual parity

Automatic-owned:

- hidden fields: 11 Views / 85 assignments
- filters: 78 Views
- hierarchy: 1 View

Manual-owned:

- field order: 110 Views
- sort: 41 Views
- group: 4 Views
- explicit non-null widths: 70 Views / 898 assignments
- row height: 110 Views, all level 1
- frozen columns: 110 Views, all count 1

Contracts already implemented:

- `customer_base_view_manual_parity_execution_plan_v1`
- `customer_base_view_manual_parity_verifier_v1`
- parity classifier `customer_base_clone_parity_coverage_v4`

Detailed evidence: `docs/project-brain/customer-base-view-manual-parity-evidence-2026-08-18.md`.

## Dashboard / Workflow manual parity — procedure frozen

Detailed procedure: `docs/project-brain/customer-base-dashboard-workflow-manual-parity-2026-08-19.md`.

Dashboard verification authority:

```text
Dashboards                    6
Charts                        75
Per-dashboard counts          13 / 10 / 11 / 8 / 11 / 22
Advanced-perm enabled         false for all 6
Subtype profiles
  Dashboard 1                 0×8, 7×3, 14×2
  Dashboard 2                 0×6, 7×3, 14×1
  Dashboard 3                 0×7, 7×3, 14×1
  Dashboard 4                 0×3, 7×3, 11×2
  Dashboard 5                 0×7, 7×3, 14×1
  Dashboard 6                 0×17, 7×3, 14×2
```

Dashboard snapshots remain opaque; reconstruction/verification is UI/source-reference only. No opaque snapshot payload may be replayed.

Workflow 1:

- `AI Materialization → MKT_AI_Report_Runs`
- trigger `setRecord`
- Source export status `1`
- `SetRecordTrigger → 4× GenerateAiTextWithSkyLarkAction → SetRecordAction`

Workflow 2:

- `Eligible AI Run → Lark Group Notification`
- trigger `addRecordV2`
- Source export status `0`
- safe Draft evidence `AddRecordTrigger → Delay (1 minute)`

Workflow reconstruction is UI/source-reference only. No raw Draft/FlowSchema/generated IDs/auth keys may be replayed.

## Apply gate

Customer Apply remains disabled until all of the following are true:

1. exact-head Branch Verification passes with the new recovery/orchestration tests;
2. no new architecture/hygiene/reliability/audit/dry-run failure exists;
3. the GET-only checkpoint mode is executed once against the unchanged customer Target and proves the original protected baseline;
4. checkpoint clone-scope collision count is zero;
5. user explicitly authorizes the one controlled customer Apply.

Automatic controlled order after authorization:

`protected checkpoint → consolidation/recovery → documented hierarchy → Advanced Permission/recovery → Advanced Permission GET verify → canonical clone GET verify`

Then manual order:

`View layout → Dashboard UI parity → Workflow UI parity → Target export/manual verification → folder placement`

## Safety contract

1. Exact local export remains authority.
2. Every pre-existing Target Table/resource is immutable.
3. TikTok protected external remains zero-write and outside clone traversal.
4. No customer resource delete.
5. No Source mutation.
6. No Worker/D1/Queue/schedule/deploy mutation in this workstream.
7. No undocumented request payloads or guessed endpoint paths.
8. PR #661 stays Draft until controlled Apply + verification close.
9. Unsafe forensic resource files are never committed as evidence artifacts.
10. A failed controlled Apply must be resumed from the same baseline checkpoint; do not create a fresh baseline after partial mutation.

## Next closure sequence

1. Pass exact-head CI for the new resumable controlled Apply implementation.
2. Run only `--prepare-checkpoint` on the exact unchanged customer Target; retain its safe summary. This is GET-only.
3. Review checkpoint baseline/collisions; keep mutation zero.
4. User authorizes one controlled Apply.
5. Execute controlled Apply once; if interrupted, resume with the same checkpoint.
6. Confirm automatic canonical/permission verification passes.
7. Execute retained manual View procedure.
8. Execute Dashboard/Workflow UI/source-reference procedure and retain safe screenshots.
9. Export Target once and verify manual-owned View dimensions locally.
10. Move 32 cloned Tables under `Setup Phase | Social MKT Data Hub` if folder placement remains UI-only.
11. Ready/Merge PR #661 only after every parity gate passes.

Detailed program record: `docs/project-brain/customer-base-consolidation-v1.md`.