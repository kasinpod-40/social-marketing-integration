# Project Brain — YouTube Report Live Readiness Audit

## Permanent boundary

YouTube Source readiness and YouTube Report readiness are separate gates.

Accepted Source evidence already proves at least 837 reconciled Content state, observation and Coverage entities, Account facts, D1/Lark source parity, idempotent replay and all-false Worker restore. Do not repeat the Provider/source UAT merely to prepare a Report.

The accepted 837 count is a non-regression floor, not a permanent maximum. Later valid incremental data may increase all reconciled counts together.

## Locked Report shape

- Platform: `youtube`
- Capability: `organic`
- Windows: `1 / 3 / 7 / 30`
- Metrics: 17 per window
- Total Metric rows: 68
- Output: existing generic Snapshot, Metric Values and Top Content tables
- Window Field: preserved `fldMlTUP3Z`
- Window options/order: `1 → 3 → 7 → 30`

No YouTube-specific Report table, view, formula, writer or Dashboard is allowed.

## Availability semantics

Incomplete baseline does not suppress the Report identity. The 17 Metric rows remain present, but unavailable aggregate values are numeric `null` with N/A metadata. Observed zero remains `0`.

## Window decisions

- no D1 materialization and no Lark rows: `create_materialization`;
- one valid D1 materialization plus exact Lark parity: `reuse_or_idempotent_verify`;
- one stable D1 identity with payload/value drift: `refresh_or_repair_materialization`;
- orphan Lark rows, duplicate identities, incomplete Coverage, unsafe Worker, active Work/Lock, incident or schema drift: `blocked`.

## Safety

The repository assessor consumes sanitized read-only evidence and performs no Provider request, Queue action, D1/Lark mutation, deployment, Schedule action or Production action. A direct authenticated Remote collector and Live materialization remain separately reviewed operations.
