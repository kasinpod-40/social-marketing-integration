# Customer Base Full Parity v1 — 2026-08-19

## Business target

Migrate the exact approved `Social MKT Data Hub` export into existing customer Base `✨Marketing Content Calendar` with functional/UI parity for 32 clone-scope Tables while preserving every resource that already existed in Target.

Target internal folder remains `Setup Phase | Social MKT Data Hub`.

## Exact authority

```text
file                        Social MKT Data Hub(20260818-030125).base
sha256                      c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
size                        13,331,288 bytes
Tables                      33
Fields                      723
Records                     35,528
Views                       111
Relations                   12
Formulas                    4
Dashboards                  6
Workflows                   2
Advanced Permission roles   4
clone scope                 32 Tables / 705 Fields / 33,488 Records / 110 Views
```

`📣 MKT_Report_Top_Ads` appears in two snapshot chunks but has one stable exported Table identity; parsers dedupe it.

## Policy B

- clone scope = 32 Tables;
- `🎵 RAW_TikTok_Creator_Videos` = immutable `protected_external_reuse`;
- Target live TikTok is authoritative only for its current Table state;
- TikTok is excluded from clone comparison, plan, Apply and clone verifier traversal;
- all pre-existing Target Tables/resources are immutable;
- no historical-export repair of customer-owned resources.

Latest observed pre-existing Target set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

## Closed read-only evidence

Real Target GET-only v6 already passed Policy-B Preview:

- clone Source: 32 Tables / 705 Fields / 33,488 Records / 110 Views;
- Target before: 4 Tables;
- clone-scope present: 0;
- create plan: 32;
- conflicts/warnings: 0/0;
- remote mutation: 0;
- Apply disabled.

Do not rerun unchanged v6, permission semantic audit, View manifest, or unsafe resource-manifest v1.

## Automatic parity implementation

`consolidate-lark-base.js` remains the only clone engine.

Implemented and CI-verified before the controlled-Apply closure:

- Table/Field/Record clone;
- Relation/Formula deterministic remap;
- Relation record remap;
- basic Views, hidden fields, filters;
- documented View hierarchy phase;
- canonical GET-only clone verifier;
- immutable pre-existing Target Table fence;
- Advanced Permission planner/fence/transport/verifier;
- resource-manifest redaction v2.

Resource-manifest redaction v2 exact verified milestone:

```text
HEAD    1fb0157714dd4cfca1891b6fdcd0ef0d27ba2ba9
Run     32176109766
Job     95838326966
Result  SUCCESS
```

## Why controlled Apply needed recovery state

The original consolidator is intentionally fail-closed for any existing same-name Target Table that is not already exact. That is correct for customer-owned state, but it means a process interruption after the migration itself creates a Table can leave an incomplete same-name Table that a plain rerun would reject.

The fix does **not** replace or fork the consolidator. A resumable Target adapter wraps the same engine using a pre-write customer baseline checkpoint.

## Resumable Target adapter

Contract: `customer_base_resumable_target_v1`.

`prepare-lark-base-resumable-target.js` rules:

- the checkpoint freezes every Table identity that existed before first Apply;
- unrelated current customer Tables are immutable as well;
- a clone-scope name absent from the checkpoint baseline but present on a later attempt is a migration recovery candidate;
- recovery candidates are hidden from consolidation preflight, then claimed in place through the consolidator's existing `createTable()` path;
- already-created fields are reused only when their safe semantic mutation matches;
- already-created records are indexed by the unique primary field and reused only when every requested field value matches;
- only missing records are sent to `batchCreateRecords`;
- existing Views can be reused; supported View mutations remain idempotent;
- any protected/unowned write or conflicting partial state fails closed.

This lets an interrupted migration resume using the same shared consolidation engine without deleting or overwriting customer resources.

## Advanced Permission resumability

Contract: `customer_base_advanced_permission_apply_v1`.

The exact semantic authority remains:

- roles: Reader / General / Editor / Client;
- zero members;
- zero dashboard role rules;
- no field/record fine-grained rules;
- 17 current Source Table rules per role = 68;
- 6 historical orphan Table references repeated across four roles = 24 forensic-only entries;
- permission values 0/1/2/4;
- schemaVersion 2;
- every exported `baseRule` value = 1.

Apply behavior:

- every role present before controlled Apply is protected by checkpoint name/ID;
- a protected role name can never be adopted even if it appears semantically similar;
- missing migration roles are created one at a time;
- every create is read back immediately;
- if execution stops after some creates, a rerun with the same checkpoint reuses only exact migration-owned roles and continues;
- a mismatched partial role blocks before any additional role mutation.

Historical orphan Table references are forensic only and are never materialized.

## Controlled Apply orchestration

Contracts:

- `customer_base_controlled_apply_checkpoint_v1`;
- `customer_base_controlled_apply_v1`;
- `customer_base_controlled_apply_operator_v1`.

The only automatic mutation sequence is:

`baseline checkpoint → resumable existing consolidation → documented hierarchy parity → Advanced Permission plan/apply/recovery → Advanced Permission GET verify → canonical clone GET verify`

Automatic/manual ownership must already be frozen in the checkpoint.

### Checkpoint mode

```bash
node scripts/customer-base-controlled-apply.mjs --prepare-checkpoint
```

Checkpoint mode:

- validates exact Source export SHA/counts;
- validates exact Target Base name;
- snapshots protected Target Table/Role identities through existing protection primitives;
- stores a private local `0600` JSON checkpoint under Downloads by default;
- stores no credential or record payload;
- performs zero customer mutation.

A checkpoint must be created **before** the first mutation. If Apply is interrupted, reuse the same checkpoint. Never create a fresh checkpoint over partially-mutated migration state.

### Apply mode

The write mode exists in repository but remains operationally disabled until exact-head CI and checkpoint review pass.

It additionally requires the exact explicit token:

```bash
CUSTOMER_BASE_APPLY_CONFIRMATION=CUSTOMER_BASE_CONTROLLED_APPLY_V1 \
node scripts/customer-base-controlled-apply.mjs --apply
```

The operator refuses Apply when checkpoint Source SHA, clone scope or confirmation do not match.

## View manual parity

Retained safe manifest:

```text
file        customer-base-view-manual-parity.json
sha256      7dabe74dd30291623e1620127f49f31fb2bb5d8131b36fcffe1884b5b089dc10
Tables      32
Views       110
```

Automatic-owned:

- hidden: 11 Views / 85 assignments;
- filters: 78 Views;
- hierarchy: 1 View.

Manual-owned:

- field order: 110 Views;
- sort: 41 Views;
- group: 4 Views;
- explicit widths: 70 Views / 898 assignments;
- row height: 110 Views, all level 1;
- frozen columns: 110 Views, all count 1.

Detailed exact execution/verification evidence is in `customer-base-view-manual-parity-evidence-2026-08-18.md`.

## Dashboard / Workflow manual parity

Detailed procedure is frozen in `customer-base-dashboard-workflow-manual-parity-2026-08-19.md`.

Safe Dashboard authority:

```text
Dashboards                         6
Dashboard charts                  75
Per-dashboard chart counts        13 / 10 / 11 / 8 / 11 / 22
Advanced-perm enabled             false on all 6
Dashboard 1 subtypes              0×8, 7×3, 14×2
Dashboard 2 subtypes              0×6, 7×3, 14×1
Dashboard 3 subtypes              0×7, 7×3, 14×1
Dashboard 4 subtypes              0×3, 7×3, 11×2
Dashboard 5 subtypes              0×7, 7×3, 14×1
Dashboard 6 subtypes              0×17, 7×3, 14×2
```

Dashboard snapshots remain opaque. UI/source-reference reconstruction is required; no snapshot payload is replayable.

Workflow 1 safe semantics:

- `AI Materialization → MKT_AI_Report_Runs`;
- trigger `setRecord`;
- export status `1`;
- `SetRecordTrigger → four GenerateAiTextWithSkyLarkAction → SetRecordAction`.

Workflow 2 safe semantics:

- `Eligible AI Run → Lark Group Notification`;
- trigger `addRecordV2`;
- export status `0`;
- safe Draft evidence `AddRecordTrigger → Delay (1 minute)`.

No raw Draft/FlowSchema/generated ID/auth material is replayed. UI/source reference remains authority for details not represented in safe evidence.

## Resource-manifest v1/v2 security boundary

The user-run v1 manifest matched exact Source counts and performed zero remote requests/mutations, but it is forensic-only because its original sanitizer leaked some internal identifier classes. Structural facts extracted from it remain valid; raw values are not retained in repository docs.

v2 repairs:

- auth-key redaction;
- tenant/user/base identity redaction;
- generated step/state identity redaction in keys/expressions;
- Select option ID → semantic Table/Field/option mapping;
- unknown generated refs → fingerprint only;
- ordinary words such as `recommendations` and `trigger_name` remain intact;
- regression tests assert raw representative identifiers do not survive serialization;
- structured JSON is parsed before nested sensitive values are redacted, preserving safe `encoding: json` evidence.

## Current safety state

```text
Customer Apply               disabled pending exact-head CI + GET-only checkpoint
Target mutation              0 to date
Source mutation              0
Worker/D1/Queue/Schedule     untouched
PR #661                      Draft / Open / unmerged
```

No customer Apply is authorized merely by having the code path present.

## Required closure sequence

1. exact-head Branch Verification must pass for resumable target, partial-role recovery, controlled orchestration and operator wiring;
2. run `--prepare-checkpoint` once against the unchanged customer Target; this is GET-only;
3. verify checkpoint baseline has no clone-scope collision and matches the previously observed protected resources;
4. obtain explicit user authorization for one controlled Apply;
5. run controlled Apply; if interrupted, resume with the same checkpoint;
6. automatic permission + canonical verification must pass;
7. execute retained manual View procedure;
8. execute Dashboard/Workflow UI/source-reference procedure and retain safe screenshots;
9. export Target once and verify manual-owned View dimensions locally;
10. move cloned Tables under `Setup Phase | Social MKT Data Hub` if folder placement remains UI-only;
11. Ready/Merge PR #661 only after all parity gates pass.

## Safety rules

- exact local export remains authority;
- every pre-existing Target Table/resource is immutable;
- protected TikTok is always zero-write and outside clone parity;
- no delete;
- no Source mutation;
- no Worker/D1/Queue/schedule/deploy mutation;
- no guessed request body or undocumented endpoint;
- no unsafe evidence artifact containing internal identifiers;
- same checkpoint is mandatory for recovery after any partial Apply;
- PR remains Draft until live Apply + all automatic/manual verification close successfully.