# Report canonical authority post-migration recovery v4

## Incident

The retained Organic Dashboard readiness v5 evidence reached a successful 1D materialization and replay.
A later continuation reran the Report Finalizer preview and stopped before mutation with:

```text
REPORT_RUNTIME_FINALIZE_METRIC_FIELD_MIGRATION_UNSAFE
REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH
display_name recordCount=65
```

The previous value-preserving migration had already converged `display_name` from SingleSelect to canonical
Text while retaining the original SingleSelect under the deterministic Legacy archive name. The 1D Report
runtime then correctly updated canonical display labels and created additional canonical rows. The planner
continued comparing every future canonical value against the immutable Legacy archive and incorrectly
classified legitimate post-migration evolution as corruption.

## Verified safety boundary

The failed continuation stopped in migration Preview before schema apply, Worker deployment, Queue send,
D1/Lark Business mutation, Provider request, Schedule/AI activation or Production action. The retained v5
Evidence root must not be deleted or restarted from a new root.

## Correction

Recovery v4 is an adapter in front of the unchanged v3 migration:

- activates only for the exact single `display_name` canonical mismatch blocker;
- requires canonical `display_name` to be Text;
- requires one or two deterministic retained Legacy SingleSelect fields;
- keeps canonical Text authoritative when both canonical and Legacy are populated;
- preserves every divergent canonical value and every archived Legacy value unchanged;
- still backfills only missing canonical values from a non-conflicting Legacy value;
- keeps dual-Legacy disagreement, invalid types, ambiguity and state races fail-closed;
- fingerprints Legacy fields before and after Apply;
- performs no delete and never mutates Legacy values;
- exposes bounded divergence/canonical-only/backfill counts without physical IDs or Business values.

## Continuation contract

After Review, exact-head CI and Squash Merge, continuation uses the retained v5 evidence root. The
Finalizer may classify the already-converged migration without a write, recover the missing 1D read-only
verification and then execute only missing 3D/7D/30D windows through the existing stabilized closeout.

## Repository safety

This implementation and CI perform no Remote Lark/D1 action, Worker deployment, Queue/DLQ send, Provider
request, Schedule/AI activation, Secret/config mutation or Production action. `docs/current-task.md` remains
owned by the parallel Meta workstream and is intentionally unchanged.
