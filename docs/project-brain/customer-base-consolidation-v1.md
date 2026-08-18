# Customer Base Full Parity v1 — 2026-08-18

## Business target

Migrate the exact approved `Social MKT Data Hub` export into existing customer Base `✨Marketing Content Calendar` with
functional/UI parity for 32 clone-scope Tables while preserving every resource that already existed in Target.

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

## Real Target GET-only evidence

v6 passed Policy-B Preview:

- clone Source: 32 Tables / 705 Fields / 33,488 Records / 110 Views;
- Target before: 4 Tables;
- clone-scope present: 0;
- create plan: 32;
- conflicts/warnings: 0/0;
- remote mutation: 0;
- Apply disabled.

Do not rerun unchanged v6.

## Automatic parity implementation

`consolidate-lark-base.js` remains the only clone engine.

Implemented / CI-verified components:

- Table/Field/Record clone;
- Relation/Formula deterministic remap;
- Relation record remap;
- basic Views, hidden fields, filters;
- documented View hierarchy phase;
- canonical GET-only clone verifier;
- immutable pre-existing Target Table fence;
- Advanced Permission planner/fence/transport/verifier.

No parallel migration framework is allowed.

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

Manual state has an execution plan and a local semantic verifier. Unrelated Target Tables and automatic-owned hidden/default-width
metadata are excluded from manual verification.

## Advanced Permission evidence

Exact role semantics:

- Reader / General / Editor / Client;
- zero members;
- zero dashboard role rules;
- no field/record fine-grained rules;
- 17 current Source Table rules per role = 68;
- 6 historical orphan Table refs repeated across four roles = 24 forensic-only entries;
- permission values 0/1/2/4;
- schemaVersion 2;
- exported baseRule values 1.

Only current Source Table references are materializable. Historical orphan refs are never written.

Remaining permission blocker is controlled Apply wiring with explicit partial-role recovery.

## Dashboard / Workflow local evidence

A user-run v1 resource manifest matched the exact Source authority and performed zero remote requests/mutations. Uploaded v1 output
SHA-256: `ef1b84d6a3e9a5da35c3b586a7685d67b2bd62efc0209a1ab1007c4484940d40`.

### Safe structural findings

```text
Dashboards                         6
Dashboard charts                  75
Per-dashboard chart counts        13 / 10 / 11 / 8 / 11 / 22
Advanced-perm enabled             false on all 6
Dashboard snapshots               6 opaque
Chart snapshots                   75 opaque
Workflows                         2
Mapped Table references           26
Mapped Field references           131
Parsed JSON strings               4
Opaque string fingerprints        81
Unresolved reference-like values  0
Remote request/mutation           0 / 0
Target read/write                 false / false
```

Dashboard chart subtype distribution by source ordinal:

1. 13 charts: subtype 0×8, 7×3, 14×2
2. 10 charts: subtype 0×6, 7×3, 14×1
3. 11 charts: subtype 0×7, 7×3, 14×1
4. 8 charts: subtype 0×3, 7×3, 11×2
5. 11 charts: subtype 0×7, 7×3, 14×1
6. 22 charts: subtype 0×17, 7×3, 14×2

All Dashboard snapshots remain opaque; do not infer or replay their internal JSON/string payloads.

### Workflow semantics

Workflow 1:

- title: `AI Materialization → MKT_AI_Report_Runs`;
- trigger: `setRecord`;
- export status: `1`;
- flow: `SetRecordTrigger` → four `GenerateAiTextWithSkyLarkAction` → `SetRecordAction`.

Workflow 2:

- title: `Eligible AI Run → Lark Group Notification`;
- trigger: `addRecordV2`;
- export status: `0`;
- exported Draft flow: `AddRecordTrigger` → `Delay` of 1 minute.

The parsed Workflow definitions resolve current Table/Field references with zero unresolved references. They are sufficient to drive a
manual semantic checklist but are **not** a documented OpenAPI request body.

## v1 resource-manifest redaction defect

The structural evidence is valid, but the v1 output is not retained-safe because review found raw internal identifier classes that the
sanitizer contract intended to redact. The repository does not store those raw values.

Root cause classes:

- auth-key field not classified sensitive;
- tenant/user/base tag values not classified identity;
- generated Workflow state/step identifiers embedded in keys/expressions;
- Select option generated IDs not semantically remapped;
- broad ID-prefix matching risked ordinary words.

Repository repair upgrades to:

- `customer_base_resource_manual_parity_manifest_v2`;
- `customer_base_resource_manual_parity_operator_v2`.

v2 behavior:

- redact auth-key values;
- redact tenant/user/base tags;
- redact generated Workflow state/step IDs including embedded expressions;
- map known Select option IDs → Table/Field/option names;
- unknown generated refs → fingerprint only;
- require generated-ID signals so normal words such as `recommendations` / `trigger_name` survive;
- regression tests assert representative leaked identifiers never survive serialized output.

The user does not need to rerun v1 merely to recover structural facts. v2 must pass exact-head CI before future use.

## Manual capability boundary

Dashboards:

- public list/copy capability does not prove cross-Base export-definition replay;
- exact snapshots are opaque;
- recreate/verify through supported UI/source reference after clone resources exist;
- never send opaque snapshot/token material as guessed payload.

Workflows:

- current export is semantically rich enough for a deterministic manual checklist;
- generic workflow scopes do not prove arbitrary definition-write payloads;
- recreate through supported UI unless a documented definition-write contract is proven;
- preserve exported enabled/disabled state.

## Apply state

```text
Customer Apply               disabled
Target mutation              0 to date
Source mutation              0
Worker/D1/Queue/Schedule     untouched
PR #661                      Draft / Open / unmerged
```

## Required controlled sequence

1. exact-head CI for resource-manifest v2;
2. freeze manual Dashboard/Workflow procedures and verification criteria;
3. implement/test one resumable controlled Apply orchestration around existing components only;
4. snapshot/protect pre-existing Target resources;
5. shared consolidation;
6. documented hierarchy parity;
7. Advanced Permission phase with partial-role recovery;
8. canonical GET-only verifier;
9. manual View/Dashboard/Workflow UI parity;
10. post-configuration verification/export evidence;
11. manual folder placement if no supported folder API exists;
12. Ready/Merge PR #661 only after all gates pass.

No Customer Apply is authorized before these gates close.