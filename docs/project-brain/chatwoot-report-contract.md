# Project Brain — Chatwoot Generic Report Contract

## Source boundary

Chatwoot Source UAT is accepted and closed. Retain the accepted 65 Conversations and 2,071 Messages, replay/idempotency evidence, D1/Lark parity, zero active lock and all-false Worker restore. Do not reopen Source recovery while implementing the Report contract.

## First generic Report capability

- Platform scope: `chatwoot`
- Capability: `customer_service`
- Windows: `1 / 3 / 7 / 30`
- Source event grain: `chatwoot_conversation_daily_facts`
- Period-end snapshot grain: `chatwoot_account_daily_facts`
- Summary metrics: 19 schema-proven definitions
- Dimensions: Inbox and Agent only
- Fixed dimension rank limit: 20

This contract is machine-readable but deliberately unwired. Connector/Job/Report catalogs remain unchanged until the D1 reader, materializer, Lark compatibility and read-only readiness phases pass.

## Aggregation rules

Counts are summed from conversation daily facts. Duration averages are calculated as the sum of eligible non-null conversation durations divided by the eligible sample count; daily averages are never averaged across days. Open/Pending/Snoozed/active Agent/active Inbox values use the latest completed-day Account snapshot in the requested period.

## Null and zero

Incomplete Coverage and missing duration evidence remain `null`. An admitted period with zero observed events remains numeric `0`. Equal ranked positions are not comparable across periods, so dimension comparison/change values remain null.

## Rejected metrics

The first contract explicitly rejects resolution rate, SLA compliance, CSAT, unique-contact reporting, label rankings, team rankings, averages of daily averages and Message-content metrics because the current schema/PII boundary cannot support them correctly.

## Privacy

Message body, Contact name, email, phone, address and free-form Label title are forbidden. Only existing opaque Inbox and Agent IDs may be used as dimension identities.

## Safety

This design performs no Provider request, Queue action, D1/Lark mutation, deployment, Schedule/Webhook activation, Catalog promotion or Production action.
