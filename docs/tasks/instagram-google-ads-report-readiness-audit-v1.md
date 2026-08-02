# Instagram Organic and Google Ads Report Readiness Audit v1

## Status

`REPOSITORY_AUDIT_IN_PROGRESS / CATALOG_PROMOTION_BLOCKED / REMOTE_READ_ONLY_NOT_RUN`

## Objective

Produce two independent, fail-closed readiness decisions for Instagram Organic and Google Ads before either source is promoted from `uat_pending` to `active` in the central Connector, Job or Report catalogs.

The workstream must reuse current shared Connector, D1, Coverage, Report and Lark architecture. It must not duplicate Meta PR #421, replay a Provider, change a catalog status or mutate Remote state.

## Current known boundary

### Instagram Organic

- exact Chemistry K Instagram identity and GET-only permissions were previously validated;
- the central Connector, Job and Report catalogs remain `uat_pending`;
- the current Meta end-to-end continuation is owned by Draft PR #421;
- any D1/Lark Source completion produced by PR #421 remains that workstream's authority;
- this audit may read repository contracts and, after merge plus separate confirmation, read resulting Remote state; it may not perform or repair the Meta continuation.

### Google Ads

- the signed-delivery Connector and generic Ads Report architecture exist;
- exact MCC/customer delivery identity and signed transport contracts exist;
- the central Connector, Job and Report catalogs remain `uat_pending`;
- readiness requires exact customer delivery, completed D1 facts/Coverage and Report/Lark proof, not merely presence of code.

## Separate decisions

The audit must never combine both channels into one pass/fail result. It emits:

- `instagram_organic` readiness and blockers;
- `google_ads` readiness and blockers;
- an explicit statement that one channel may advance while the other remains blocked.

## Repository checks

For each channel:

- central Connector catalog status and declared readiness gates;
- Queue Job catalog status/manual-only contract;
- Report adapter registry status/capability;
- Report Settings presence for locked 1/3/7/30 periods;
- D1 source reader registration and expected fact tables;
- Coverage source/entity contracts;
- generic materializer and Lark writer compatibility;
- required Lark Report fields/Stable keys;
- exact tests and existing task/Project Brain evidence;
- absence of duplicate Connector, Reliability, Queue, D1 writer or Lark engine.

## Remote read-only checks after merge and separate confirmation

### Shared safety

- exact clean reviewed main and current audit Head;
- active Worker at 100% traffic with all execution and Schedule flags false;
- exact D1/Queue bindings and no pending migration;
- zero active target Work/Locks;
- no unresolved target terminal DLQ/critical Alert;
- SELECT/metadata reads only.

### Instagram Organic

- exact customer Account identity and source key;
- completed zero-failure Account and Content Coverage generations;
- admitted Content observations and Account facts only from completed generations;
- source date range and timezone sufficient for each requested window;
- D1/Lark Source parity produced by the Meta-owned continuation;
- generic Organic Report source can derive all required metrics without partial totals or fake zero;
- no unresolved dependency on PR #421.

### Google Ads

- exact signed-delivery advertiser and account identity;
- accepted delivery/chunk completeness and replay/idempotency evidence;
- completed Campaign/Ad-group/Ad/Daily Coverage as required by the existing contract;
- Ads summary and Top Ads facts admitted through completed delivery/Coverage generations;
- currency/timezone consistency and SUM-before-ratio semantics;
- source date range sufficient for requested windows;
- D1/Lark source parity where required;
- generic Ads Report source can materialize summary and ranked ads without partial totals.

## Promotion gate

A channel is eligible for a separate Catalog-promotion PR only when all of the following are true:

1. exact Provider/delivery identity accepted;
2. D1 source facts complete and reconciled;
3. required Coverage generations complete and zero-failure;
4. Lark Source parity complete where the source contract requires it;
5. Report adapter/source/settings/writer contracts complete;
6. read-only Report preview for 1/3/7/30 returns deterministic readiness decisions;
7. no active Work/Lock/DLQ blocker;
8. exact-head repository verification passes.

The audit itself never edits `uat_pending` to `active`.

## Blocker taxonomy

At minimum:

- `provider_identity_pending`;
- `source_uat_pending`;
- `coverage_incomplete`;
- `source_facts_missing`;
- `source_lark_parity_pending`;
- `report_contract_missing`;
- `report_settings_missing`;
- `baseline_incomplete`;
- `active_work_or_lock`;
- `terminal_incident_open`;
- `meta_continuation_pending`;
- `catalog_promotion_ready`.

## Safety and non-goals

- no Instagram/Meta or Google Ads Provider request;
- no signed-delivery replay;
- no Queue send/redrive;
- no D1 write, migration apply or lifecycle SQL;
- no Lark write/schema mutation;
- no Worker deploy;
- no Catalog promotion;
- no Schedule activation;
- no Production work;
- no edits to `docs/current-task.md` or PR #421-owned files.

## Definition of Done

- one repository audit maps both channels independently across Connector → Job → D1/Coverage → Report → Lark;
- one plan-only-by-default operator can later perform bounded read-only checks;
- tests prove no Provider/mutation/deployment path and preserve independent decisions;
- current blockers and exact next gates are recorded without guessing Remote completion;
- full repository verification passes on exact Draft PR Head;
- Remote execution and Catalog promotion remain separate approvals.
