# Project Brain — Chatwoot Report Readiness

## Accepted Source authority

Chatwoot Source UAT remains closed and accepted. The readiness phase must preserve the exact accepted boundary:

- 65 Conversations;
- 2,071 Messages;
- 30-day Initial and same-operation replay verified;
- 3-day Daily and same-operation replay verified;
- D1/Lark parity across 15 Source targets;
- Worker restored all-false;
- Schedule and Webhook disabled;
- retained DLQ 9 and Alert 15 remain immutable forensic truth.

The readiness operator must not reopen Source recovery, redrive incidents, send Queue messages or change retained facts.

## Report authority

- platform: `chatwoot`
- capability: `customer_service`
- windows: `1 / 3 / 7 / 30`
- summary metrics: 19
- fixed-rank dimension metrics: 120
- expected metric rows per materialization: 139
- accepted statuses: `complete` and `no_data_confirmed`

Missing windows may be classified as `create_materialization`. One exact existing D1/Lark materialization may be reused. Incomplete but non-duplicate existing state may be classified for controlled refresh. Orphan, duplicate, unsupported-window or parity drift remains blocked.

## Promotion boundary

Connector, Job and Report catalogs remain `uat_pending`. The audit may return `catalog_promotion_ready`, but it never edits Catalogs or authorizes Live materialization.

Current-main source inspection is allowed to report `source_reader_missing`. Readiness must fail closed until the shared D1 Report registry actually registers `D1ChatwootReportSource`; this audit does not silently treat the class existing in the Repository as runtime registration.

## Remote safety

The public Remote path validates clean `main` and exact reviewed Head before invoking an internal read-only collector. Direct internal execution is blocked. D1 accepts `SELECT/WITH` only; Lark uses list/get/search only. No Provider request, Queue/DLQ action, D1/Lark mutation, Worker deployment, Schedule/Webhook change, Catalog promotion, Production action or Live materialization is permitted.
