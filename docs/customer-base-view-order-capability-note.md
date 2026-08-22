# Lark Grid View field-order capability note

This note records the current proven capability boundary for the customer Base View-order lane.

## Documented surfaces

The official Base JS SDK exposes ordered reads through `getFieldMetaList()` / `getVisibleFieldIdList()` and mutation methods for show/hide, sort/group, width and row height. It does **not** expose a documented existing-View field-order setter.

The official `larksuite/cli` Base shortcut documents a Base v3 View property contract:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

and states that `visible_fields` controls both visibility and order.

## Live Target evidence overrides the optimistic assumption

On the customer Target, visible membership already matched Source. The operator therefore sent order-only `visible_fields` updates and verified ordered GET readback after every write.

Two confirmed attempts reached the same boundary:

1. Lark returned `800070003 api_error: no operation produced` after four View changes; rollback restored all four.
2. A narrow retry guard accepted `800070003` only if immediate GET proved the desired order was already present. For `📐 MKT_Metric_Definitions.📋 All Metrics`, readback still differed, proving the reorder was not applied. The four prior changes were again rolled back with zero rollback failures.

Therefore, for this live Target, `visible_fields` is **not a proven safe order-only write lane** when membership is unchanged. We must not keep retrying the same payload or weaken readback verification.

## Current safety boundary

- Source hidden membership remains authoritative and already passed its separate parity gate.
- Protected `🎵 RAW_TikTok_Creator_Videos` remains excluded and zero-write.
- Do not rerun the confirmed order-only apply.
- Do not ignore `800070003` globally.
- Do not recreate Views or temporarily alter visible membership merely to force a reorder unless a separately approved mutation plan explicitly authorizes that wider change.
- No Table, Field, Record, Filter, Sort, Group, Formula, Dashboard, Automation, Worker, D1, Queue or schedule mutation belongs to this unresolved lane.

## Acceptance status

Displayed column order remains unresolved presentation parity. The currently proven closure paths are:

1. manual UI reorder against the exact Source manifest, or
2. an explicit acceptance-scope decision that visible-field order is non-blocking.

Until one of those happens, do not claim exact View presentation parity. Dashboard manual parity remains a separate open blocker.
