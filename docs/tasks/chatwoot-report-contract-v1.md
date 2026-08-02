# Chatwoot Generic Report Contract v1

## Status

`CONTRACT_DESIGN_IN_PROGRESS / SOURCE_UAT_ACCEPTED / REPORT_RUNTIME_NOT_IMPLEMENTED`

## Objective

Design the first generic Chatwoot Customer Service Report contract from the accepted Chemistry K source facts and existing PII-minimized D1 model. The contract must be implementable through the existing shared Report request, materialization, Reliability and Lark writer architecture without creating a Chatwoot-specific Report engine or Dashboard.

## Accepted prior evidence

The source/runtime work is already closed and must not be repeated:

- exact rolling 30-day Initial and rolling 3-day Daily Incremental completed;
- D1/Lark parity passed for all reviewed Chatwoot destinations;
- accepted retained business facts include 65 Conversations and 2,071 Messages;
- Initial replay and Daily replay preserved idempotency;
- exact Shared Reliability lock scope closed with active lock count zero;
- Worker restored to the all-flags-false Safe baseline;
- Schedule and Webhook remain disabled;
- retained DLQ/Alert history remains forensic truth and is not rewritten by this workstream.

Source UAT completion does not imply a Dashboard Report contract exists.

## Contract authority order

1. migration `0018_chatwoot_analytics.sql` and current D1 schema;
2. current Chatwoot normalizers and D1 write/read contracts;
3. accepted source UAT facts and Coverage lineage;
4. shared Report period, null/zero, comparison and materialization contracts;
5. current generic Lark Report tables and Stable-key writer.

Metric names or values not derivable from these authorities remain unsupported and must not be invented.

## Capability

Add a future shared Report capability named `customer_service`. This design does not promote the Chatwoot Connector/Job/Report catalog and does not implement runtime wiring yet.

## Locked periods

The Dashboard-compatible rolling completed-day presets are:

- 1 day;
- 3 days;
- 7 days;
- 30 days.

Equal-length previous periods are used only where the metric is comparable. 9/15/90 remain outside the locked Lark writer path.

## Metric admission rules

A metric is admitted only when:

- the exact D1 fact columns and grain are identified;
- the contributing generation has completed zero-failure Coverage;
- the numerator/denominator and timezone boundary are deterministic;
- retries and overlapping incremental windows cannot double-count it;
- missing duration or lifecycle evidence remains `null`, not `0`;
- observed zero remains numeric `0`;
- PII, message content, free-form labels and raw Provider payload are excluded.

## Candidate summary metric families to verify against the schema

### Conversation flow

- conversations opened;
- conversations resolved;
- conversations reopened;
- currently open/active conversations only when an authoritative period-snapshot fact exists;
- resolution rate only when numerator and denominator share one admitted grain.

### Message flow

- inbound messages;
- outbound agent messages;
- bot messages only when the normalized message classification is authoritative;
- total messages;
- agent replies only when they are distinct from generic outbound messages in the source contract.

### Service timing

- first-response duration;
- resolution duration;
- waiting duration;
- agent-response duration only if an exact normalized fact exists.

Duration summaries must define sample eligibility and aggregation explicitly. Totals and counts are accumulated first; averages are computed from `duration_sum / eligible_count`. Daily averages must never be averaged directly across days.

### Quality and workload

- reopened conversation count/rate;
- conversations without first-response evidence;
- conversations without resolution evidence;
- participating agents/inboxes only when exact dimension facts exist;
- Coverage completeness and availability are metadata, not Business zero metrics.

The final locked metric list will contain only schema-proven members of these families.

## Dimension and ranking design

Potential dimensions are limited to opaque, non-PII identities already present in D1:

- Inbox;
- Agent;
- Team, if exact durable relationships exist.

Ranking rows must use fixed bounded ranks, stable opaque identities and null placeholders for empty ranks so stale Lark values can be cleared by the existing upsert-only writer. Ranking metrics cannot compare equal ranks across periods because rank occupants may differ; comparison and change fields remain `null`.

No Contact, Message body, email, phone, address, free-form label title or unrestricted metadata may be materialized.

## Stable identities

Planned identities must extend existing generic Report patterns:

- materialization identity: customer + source + report type + current period + comparison period + settings fingerprint;
- summary metric row: materialization + stable metric key;
- dimension metric row: materialization + stable metric key + dimension type + fixed rank;
- optional ranked entity row: materialization + dimension type + fixed rank + opaque entity key.

Provider IDs may be used only where the existing PII-minimized D1 contract already treats them as opaque stable identities.

## Null, zero and availability semantics

- missing source/metric: `current_value = null`, availability status explains why;
- incomplete Coverage: `null`, never partial numeric totals presented as complete;
- no eligible duration samples: average `null`, eligible count `0`;
- admitted period with zero observed events: numeric `0`;
- absent previous baseline: comparison/change `null`;
- division by zero: rate `null` unless the shared contract explicitly defines the zero-denominator result;
- source unavailable or catalog blocked: empty metric payload and explicit fail-closed status.

## Required implementation phases after contract approval

1. lock the exact schema-derived metric inventory and formulas;
2. add `customer_service` capability and Chatwoot adapter contract;
3. add Report Settings for 1/3/7/30 with stable keys;
4. implement a bounded D1 Customer Service Report source;
5. extend generic materialization/output rows without a separate engine;
6. extend the existing Lark writer only where generic dimension metadata is required;
7. add Reliability, replay, Coverage, null/zero and weighted-average regressions;
8. run a separately authorized read-only readiness audit;
9. only then promote catalogs and run controlled materialization.

## Non-goals

- no Chatwoot Provider request or source replay;
- no D1/Lark mutation;
- no Queue message, Worker deployment or Schedule/Webhook activation;
- no Catalog promotion in the design PR;
- no Dashboard creation or mutation;
- no Executive aggregation;
- no Production work.

## Definition of Done for this design workstream

- every proposed metric maps to exact current schema fields and grain;
- unsupported candidate metrics are explicitly rejected;
- formulas, eligibility, weighted aggregation and null/zero behavior are locked;
- dimension/ranking bounds and Stable keys are locked;
- exact files expected in later implementation are listed;
- migration and Lark schema impact are stated;
- cross-channel regression risks are documented;
- full repository documentation/hygiene checks pass on exact Draft PR Head.

## Workstream isolation

- do not edit `docs/current-task.md`;
- do not reopen or modify accepted Chatwoot Source UAT evidence;
- do not touch Meta PR #421 or WooCommerce PR #415 files;
- design against current `main` and shared contracts only.
