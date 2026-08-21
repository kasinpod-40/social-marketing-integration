# Customer Base AI Materialization Workflow Readiness — 2026-08-21

## Scope

This workstream covers only Source workflow:

`AI Materialization → MKT_AI_Report_Runs`

It does not authorize Target workflow creation or activation. It exists to convert the exact current `.base` Source into a safe public-API readiness boundary without replaying raw Draft/FlowSchema/internal identities.

## Current Source authority

- file: `$HOME/Desktop/Social MKT Data Hub.base`
- SHA-256: `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`
- Source workflows: exactly 2
- AI Materialization status: enabled in Source
- reviewed step chain: `SetRecordTrigger → GenerateAiTextWithSkyLarkAction ×4 → SetRecordAction`

The current Source final update writes AI outputs and terminal generation state. Exact semantic evidence includes:

- `generation_status = generated`
- `failure_code = null`
- `generated_at = trigger startTime`

The four AI actions produce single text outputs which feed the final record update.

## Documented public Workflow coverage

Current official Lark Base Workflow schema documents public types:

- `SetRecordTrigger`
- `GenerateAiTextAction`
- `SetRecordAction`

It also documents trigger output field references, trigger `startTime`, whole-output references from `GenerateAiTextAction`, and `SetRecordAction.ref_info`/field values.

Therefore the Source step-type chain itself is representable through public Workflow concepts. The Source-internal action name `GenerateAiTextWithSkyLarkAction` is not replayed; the corresponding public type is `GenerateAiTextAction`.

## Blocking semantic

The remaining blocker is the exact Source write:

`failure_code = null`

Public `RecordFieldValue` requires a `ValueInfo[]`. The documented `ValueInfo` enum covers text, number, boolean, date, option, link, user, group and ref. The reviewed public docs/tests do not define a null/clear ValueInfo or an explicitly documented empty-value encoding for clearing a Text field in `SetRecordAction`.

Do not guess `null`, empty string or `[]` as a clear operation. Omitting `failure_code` would also be non-parity because an older failure value could remain on a regenerated row.

Until a documented/proven clear semantic exists, Target AI Materialization workflow creation/update remains blocked.

## Readiness operator

Files:

- `scripts/lib/customer-base-ai-materialization-workflow-readiness.js`
- `scripts/customer-base-ai-materialization-workflow-readiness.mjs`
- `tests/scripts/customer-base-ai-materialization-workflow-readiness.test.js`

The operator:

- exact Source SHA fence;
- requires exactly two Source workflows and resolves the AI workflow exactly once;
- requires the reviewed six-step chain;
- maps every Source field reference to semantic Table/Field names locally;
- maps Select option IDs to names;
- proves final `generation_status=generated`, `failure_code=null`, and `generated_at=startTime` semantics;
- emits the null-clear blocker explicitly;
- exposes no Target client and performs zero remote requests;
- rejects `--apply` unconditionally while the blocker exists.

Expected terminal readiness status:

`CUSTOMER_BASE_AI_WORKFLOW_DOCUMENTED_TYPES_READY_NULL_CLEAR_BLOCKED`

## Safety

- remote request count = 0
- remote mutation count = 0
- workflow create/update/status change = 0
- AI calls = 0
- record mutation = 0
- no Dashboard/Table/Field/View/Formula/Role changes
- no Worker/D1/Queue/schedule/deployment changes

Reopen live AI Workflow creation only after a documented/proven Text-field clear semantic exists and a focused regression proves the exact Source final update without weakening the null-clear behavior.
