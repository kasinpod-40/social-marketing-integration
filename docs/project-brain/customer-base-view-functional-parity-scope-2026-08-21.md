# Customer Base View functional parity scope — 2026-08-21

This note supersedes any earlier View UI wording that treated column width or row height as migration parity requirements.

## Locked decision

The Source Base's column widths and row heights were user-adjusted presentation only. They are not business data, schema, formula, filter, relation, automation, or functional View semantics. They must not block customer migration and must not be replayed automatically or manually as a required closure gate.

Functional View parity for the Base JS SDK runner is now limited to:

- hidden-field membership: verify-only; automatic OpenAPI state already passed;
- sort: automatic reconcile + readback;
- group: automatic reconcile + readback.

Explicitly ignored cosmetics:

- column width;
- row height.

The execution plan does not retain either cosmetic dimension. They do not participate in plan authority, source-layout fingerprints, preflight capability checks, mutation, readback, PASS/FAIL, or final-export closure.

Field order and frozen columns remain separate manual/audit items until explicitly de-scoped or completed; this decision does not change them.

## Live recovery evidence

The first live Base JS SDK execution reached the customer Target after the single-bundle SDK bootstrap was proven. It stopped on:

```text
VIEW_UI_SDK_MUTATION_REJECTED
setRowHeight ⚙️ MKT_Report_Settings.⛔ Disabled Reports returned false
```

A read-only inspection immediately afterward proved:

```text
hiddenVerifyMismatchViews = 0
sortMismatchViews         = 42
groupMismatchViews        = 4
widthMismatchAssignments  = 18
fieldOrderMismatchViews   = 105
```

Because sort/group had not been committed and row height has no safe readback path in this runner, the recovery removes cosmetic sizing entirely rather than weakening a mutation result.

## Safety / no-repeat

- Never call `setRowHeight`, `setFieldWidth`, or `getFieldWidth` from the customer View parity runner.
- Never restore width/row-height counts as authority gates.
- Never regenerate the controlled-Apply checkpoint.
- Never rerun controlled automatic Apply.
- Reconcile Sort/Group idempotently from current Target state and require readback mismatch `0`.
