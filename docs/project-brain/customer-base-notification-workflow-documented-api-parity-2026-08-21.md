# Customer Base Notification Workflow — Documented API Parity — 2026-08-21

## Scope

This closure is intentionally narrow. It covers only the current Source workflow:

`Eligible AI Run → Lark Group Notification`

It does not alter Dashboard state, AI Materialization, records, tables, fields, views, Worker/D1/Queue runtime, schedules, or the retained migration checkpoint.

## Current Source authority

Source export:

`$HOME/Desktop/Social MKT Data Hub.base`

SHA-256:

`9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7`

The current Source contains exactly two Workflows. The notification Workflow is disabled and its definition is exactly:

```text
AddRecordTrigger
  table: 🧠 MKT_AI_Report_Runs
  watched field: ai_run_key
  trigger controls:
    pasteUpdate
    automationBatchUpdate
    openAPIBatchUpdate
→ Delay 1 minute
```

There is no Lark message action in the current Source definition. Do not add one during parity migration.

## Proven public Lark contract

Current official Lark CLI Base Workflow SSOT documents:

- list: `POST /open-apis/base/v3/bases/{base_token}/workflows/list`
- get: `GET /open-apis/base/v3/bases/{base_token}/workflows/{workflow_id}`
- create: `POST /open-apis/base/v3/bases/{base_token}/workflows`
- create scope: `base:workflow:create`
- read scope: `base:workflow:read`
- create body uses `client_token`, `title`, and `steps`
- new workflows are created disabled
- `AddRecordTrigger` uses semantic `table_name` / `watched_field_name`
- `Delay` uses `duration` in minutes
- activation is a separate API and is not part of this operator

Workflow is also a Base Block. Current official Base Block SSOT documents:

- topology: `POST /open-apis/base/v3/bases/{base_token}/blocks/list`
- placement: `POST /open-apis/base/v3/bases/{base_token}/blocks/{workflow_id}/move`
- Workflow block `id` is the corresponding `workflow_id`

The Workflow create API does not accept a folder `parent_id`, so placement is a separate documented phase after create.

## Operator

Files:

- `scripts/lib/customer-base-notification-workflow-parity.js`
- `scripts/lib/customer-base-workflow-placement.js`
- `scripts/customer-base-notification-workflow-parity.mjs`
- `tests/scripts/customer-base-notification-workflow-parity.test.js`
- `tests/scripts/customer-base-workflow-placement.test.js`

The planner reads the exact `.base` locally and resolves Source Table/Field IDs to semantic names. Source IDs are not copied into the public Workflow body.

The Target preflight verifies the protected customer anchors and resolves `🧠 MKT_AI_Report_Runs.ai_run_key` before inspecting the Workflow inventory.

Behavior:

1. exact Source SHA fence;
2. exact Source workflow count/title/status/step-shape fence;
3. Target identity-anchor and watched-field preflight;
4. list Workflow inventory by public API;
5. duplicate same-title Workflow → fail closed;
6. existing exact disabled definition → reuse, zero workflow-definition writes;
7. absent definition in preview → report disabled-create readiness, zero writes;
8. controlled apply → create once, disabled by platform default;
9. list + get readback verifies exact two-step semantic definition and disabled status;
10. Base Block topology is then inspected and the Workflow is moved under `Setup Phase | Social MKT Data Hub` only when needed;
11. placement move receives an immediate topology readback;
12. no enable, update, notification send, AI call, record write, or delete path exists in this operator.

Create confirmation:

`APPLY_CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PARITY_V1`

## Idempotency / recovery

Create uses a deterministic `client_token` for this single intended workflow and the shared Lark client with `retryMode: rate_limit_only`.

If a create result is ambiguous, rerun starts with public Workflow list discovery. If the exact workflow exists, it is reused and no second create is issued.

If create succeeds but folder placement fails, rerun reuses the exact disabled Workflow and performs only the missing Base Block move. Conflicting or duplicate definitions fail closed.

## Verification staged before Target mutation

Focused synthetic regression covers:

- Source semantic conversion with no Source IDs in the plan;
- read-only preview;
- wrong confirmation causing zero create;
- one disabled create + exact readback;
- rerun reuse with zero definition writes and zero enable;
- folder existence/read-only preview;
- missing placement detection;
- move-only recovery with topology readback.

No customer Target Workflow mutation was executed while preparing this operator.

## Remaining Workflow scope

`AI Materialization → MKT_AI_Report_Runs` remains separate because it contains a SetRecordTrigger, four native AI text actions, output bindings, and a final SetRecordAction. It must be converted from the current Source semantic definition to the documented public Workflow schema without replaying raw Draft/FlowSchema/internal identities.
