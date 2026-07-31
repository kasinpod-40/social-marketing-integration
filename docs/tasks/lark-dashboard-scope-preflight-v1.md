# Lark Dashboard Scope Preflight v1

## Incident

The first Live Dashboard canonical-rebind attempt stopped in `read-dashboard-state` with Lark error
`99991672` because the integration app did not have `base:dashboard:read`.

The attempt stopped before Dashboard Block update, Legacy-value backup, Legacy field deletion or any
Business-fact mutation. Production remains blocked.

## Root cause

The implementation and CI verified request shapes and local contracts but did not verify the Live app's
new Base Dashboard scopes before handing off the execution command. Lark reports the scope required by
the current endpoint, not the complete permission set required by the full multi-stage operator.

## Complete permission contract

The existing in-place Dashboard rebind requires all of the following permissions:

```text
base:dashboard:read
base:dashboard:update
base:field:delete
```

- `base:dashboard:read`: list/get Dashboards and Blocks and read computed Block data;
- `base:dashboard:update`: patch the existing Block `data_config` without changing Block IDs or layout;
- `base:field:delete`: delete the four reviewed Legacy fields only after binding and computed-data
  verification converge.

## Recovery

`scripts/lark-dashboard-canonical-rebind-terminal.mjs` is the public entrypoint after this hotfix.

Read-only scope probe:

```bash
node scripts/lark-dashboard-canonical-rebind-terminal.mjs --preflight
```

Live execution is allowed only after the app version containing all three permissions is published and
the operator receives both confirmations:

```bash
CONFIRM_LARK_DASHBOARD_SCOPE_CONTRACT=I_ENABLED_BASE_DASHBOARD_READ_UPDATE_AND_FIELD_DELETE \
CONFIRM_LARK_DASHBOARD_CANONICAL_REBIND=REBIND_EXISTING_DASHBOARDS_AND_REMOVE_LEGACY_FIELDS \
node scripts/lark-dashboard-canonical-rebind-terminal.mjs --execute
```

The scope probe performs one Dashboard GET request and records `remoteMutationCount: 0`. The terminal
then delegates to the already reviewed canonical-rebind operator; it does not duplicate Dashboard
mutation logic.

## Safety boundary

- do not rerun the previous direct operator command;
- do not remove Legacy fields manually;
- do not recreate Dashboard Blocks or change layout;
- do not delete the 24 baseline-incomplete Report records;
- do not declare Dashboard readiness until the final visual gate passes.
