# YouTube Organic Report Live Readiness Audit v1

## Status

`REPOSITORY_IMPLEMENTATION_IN_PROGRESS / REMOTE_READ_ONLY_NOT_RUN / LIVE_MATERIALIZATION_BLOCKED`

## Objective

Prove whether the existing active YouTube Organic Report path is ready to materialize the exact rolling completed-day windows `1 / 3 / 7 / 30` for `development / integration_workspace / chemistry_k` without repeating the already-passed YouTube source integration or mutating Remote state during the audit.

## Accepted prior evidence

The audit must reuse, not repeat, the accepted YouTube source boundary:

- exact customer-scoped YouTube source identity already validated;
- D1/Lark source UAT completed with 837 Content entities;
- Content state, observations and Coverage entities reconciled at 837 / 837 / 837;
- Account facts and Coverage completed;
- same-operation rerun performed zero Provider replay and preserved counts;
- Shared Worker restored to the all-flags-false Safe state;
- YouTube is `active` in the central Connector and Report catalogs.

This prior evidence proves Source readiness. It does not by itself prove Report materialization readiness.

## Audit boundary

The public audit is plan-only by default. A separately confirmed `--execute` mode may perform only authenticated read-only operations:

- Git and local configuration reads;
- Cloudflare Worker deployment/version metadata reads;
- D1 `SELECT` and migration-list reads;
- Lark metadata and existing Report-record reads;
- no YouTube Provider request;
- no Queue send, retry, redrive or DLQ mutation;
- no D1 write, migration apply or lifecycle repair;
- no Lark schema or record mutation;
- no Worker deployment;
- no Schedule, Secret or Production action.

## Required checks

### Repository and runtime safety

- exact clean reviewed `main` and current-head audit implementation;
- active Worker at 100% traffic;
- every execution, Report, Schedule and unrelated connector flag false;
- exact D1, Main Queue and DLQ bindings;
- zero active Report Work and exact Report lock scope;
- zero open terminal Report DLQ/critical Alert attributable to the target identities;
- no pending D1 migration.

### Source and Coverage authority

- YouTube Content and Account Coverage generations are completed and zero-failure;
- entity cardinality reconciles with accepted source facts;
- source watermark, reporting timezone and completed-day boundary are available;
- incomplete, failed or superseded generations cannot feed Report reads;
- missing/private/deleted entities remain availability evidence and never become fabricated zero metrics.

### Report contract

For each exact window `1 / 3 / 7 / 30`:

- resolve current and equal-length previous periods from the shared period resolver;
- identify the exact `report_materializations` stable identity;
- determine whether the action is `create_materialization`, `refresh_or_repair_materialization`, `reuse_or_idempotent_verify` or `blocked`;
- require the generic Organic adapter and YouTube D1 source to be registered and active;
- require all 17 Organic metric definitions;
- expect 17 Metric rows per window and 68 rows across four windows;
- require bounded Top Content output and stable keys;
- preserve numeric `null` plus N/A metadata when baseline or source availability is incomplete;
- preserve observed zero as `0`;
- reject 9/15/90 for the locked Lark Dashboard writer.

### Lark readiness

- resolve the existing generic Report tables only;
- verify Stable-key fields and compatible Field types;
- verify the preserved Window SingleSelect field and exact option identity/order `1 → 3 → 7 → 30`;
- read current Snapshot, Metric and Top Content identities for the target windows;
- compare D1 and Lark state without repairing either side;
- do not create a YouTube-specific table, view, formula or Dashboard.

## Output contract

The audit must emit a sanitized summary containing:

- exact repository and target fingerprints;
- source/Coverage readiness booleans and bounded counts;
- runtime safety decision;
- one decision per window;
- expected/observed Snapshot, Metric and Top Content counts;
- blocker codes and next authorized action;
- explicit mutation counters fixed at zero.

No Secret value, D1 UUID, Queue ID, Lark Table ID, Provider payload or customer credential may appear in logs or committed evidence.

## Non-goals

- no Source backfill or Provider replay;
- no Report materialization or refresh;
- no Lark write or Dashboard mutation;
- no Catalog promotion because YouTube is already active;
- no Schedule activation;
- no Production work.

## Definition of Done

- repository task and Project Brain records exist;
- one plan-only-by-default read-only audit operator exists;
- confirmation and forbidden-command source guards exist;
- focused tests cover complete readiness, incomplete Coverage, baseline-null, existing legacy/partial materialization, D1/Lark drift, locks/DLQ and unsupported windows;
- full repository verification passes on exact PR Head;
- Remote read-only execution remains a separate post-merge operation;
- Live `1/3/7/30` materialization remains separately authorized after an accepted audit result.

## Workstream isolation

- do not edit `docs/current-task.md`;
- do not edit Meta continuation or retained evidence files owned by PR #421;
- do not edit WooCommerce PR #415 files;
- reuse Shared Report readers, materializer, writer and Reliability contracts.
