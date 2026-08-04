# Report Metric Archive Conflict Routing Hotfix v1

## Incident

`npm test` failed after PR #482 merged because the canonical-authority regression returned `repairable: false` for a record where canonical Text `display_name` was populated and two immutable Legacy archive values differed.

## Root cause

Recovery v4 already inspected canonical values safely, but its entry gate only routed `REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH` into the canonical-authority path. The live shape first surfaced as `REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT`, so the v3 blocker was returned before canonical inspection.

## Correction

The existing shared recovery now routes either reviewed blocker into the same bounded canonical-authority inspection:

- canonical Text populated + Legacy conflict: canonical remains authoritative, archives remain immutable, zero write;
- canonical Text missing + Legacy conflict: fail closed before mutation;
- all other blockers: unchanged behavior.

No Lark, D1, Queue, Worker, Schedule, Production, Provider, or Business fact mutation is part of this implementation.

## Verification

The existing regressions remain the authority:

- `canonical display_name authorizes conflicting immutable archive values` must pass with zero mutation;
- `conflicting archive values remain blocked when canonical display_name is missing` must remain blocked;
- full `npm test` and repository gates must pass before merge.
