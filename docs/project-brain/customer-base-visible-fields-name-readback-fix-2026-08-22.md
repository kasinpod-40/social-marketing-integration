# Customer Base visible_fields live readback fix — 2026-08-22

## Live evidence

The first read-only visible-field-order preview on the customer Target returned:

- `ok: false`
- `representedViews: 0`
- `blockerCount: 2483`
- repeated `VISIBLE_FIELD_ORDER_TARGET_READBACK_FIELD_UNKNOWN`
- remote mutation remained zero

The failure was in the preview parser, not in Target field membership.

## Root cause

The new order lane initially assumed Base v3 `GET .../visible_fields` returns Target field IDs. Current official `larksuite/cli` guidance documents `visible_fields` using exact field names (for example `{"visible_fields":["Name","Status"]}`), while earlier shortcut tests/examples used field IDs. The customer tenant returned field-name references, so every valid visible field was treated as an unknown ID.

## Fix

The existing shared documented View parity module now:

- resolves live `visible_fields` references by exact Target field ID **or** exact Target field name;
- compares semantic order by exact field name;
- writes exact Target field names through the documented Base v3 `visible_fields` PUT;
- keeps visible membership fail-closed;
- emits at most one unresolved-reference blocker per View instead of one blocker per field;
- verifies ordered readback after every write;
- rolls back changed Views by exact field name on failure.

No Source/Table/Field/Record/Filter/Sort/Group/Formula/Dashboard/Automation/Worker/D1/Queue/schedule mutation is introduced by this fix.

## Acceptance

Re-run preview first. Apply remains forbidden unless preview covers all 110 cloned Views with zero blockers.
