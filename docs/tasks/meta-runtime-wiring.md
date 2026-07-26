# Meta Runtime Wiring — Integration Task

## Status

`IMPLEMENTED_DRAFT / LIVE_EXECUTION_BLOCKED`

## Stack and authority

- Repository: `kasinpod-40/social-marketing-integration`
- Parent implementation: Draft PR `#69`, branch `agent/meta-end-to-end`
- Stacked branch: `agent/meta-runtime-wiring`
- Main baseline reviewed: `ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4`
- Latest migration reviewed: `0016_tiktok_post_lark_pipeline.sql`
- New migration: none

This task wires the reviewed Meta implementation into shared Runtime contracts without authorizing any Live execution.

## Scope

- register Facebook Organic, Instagram Organic and Meta Ads Queue jobs as `uat_pending` and manual-only;
- assign stable Queue operation identities for durable continuation and retry;
- allow Meta `uat_pending` connector configuration only in the developer-owned Integration Workspace when the source-read gate is explicitly true;
- reuse the existing secret-owning Meta Graph clients to construct GET-only source adapters;
- stage one bounded provider page per Queue invocation in existing resumable-work tables;
- route Meta jobs before the generic active-job enforcement and preserve all existing Google Ads/TikTok routes;
- reuse existing Reliability, D1 history stores, Organic History Gateway and TableSyncEngine;
- add false-by-default four-stage Meta flags and bounded staging limits to example configuration;
- add focused tests for source staging, D1-only stop/resume, Lark continuation, protected UAT configuration and shared-client adapters.

## Runtime gates

All gates default false:

```text
MKT_META_SOURCE_READ_ENABLED=false
MKT_META_D1_WRITE_ENABLED=false
MKT_META_LARK_WRITE_ENABLED=false
MKT_META_REPORT_READ_ENABLED=false
```

The manual rollout sequence is enforced:

```text
source-read only
→ D1 write with Lark disabled
→ Lark parity
→ report-read validation
→ separate activation decision
```

A source-only run uses `dryRun=true`. A D1-only run uses `d1Only=true`. The Runtime does not enqueue repeatedly when it intentionally stops at `source_validated` or `lark_gate_disabled`.

## Durable source contract

- one Graph node/page per Queue invocation;
- stable operation ID/work key/generation preserved in every continuation;
- existing `sync_work_runs`, `sync_work_phases` and `sync_work_units` only;
- repeated/missing cursor and dataset page cap fail closed;
- staged units are bounded by count, row count and encoded payload bytes;
- source snapshot must be complete before any D1 or Lark business write;
- source-only replay is GET-safe and produces no D1/Lark mutation;
- D1 completion can be resumed later with the same operation when Lark is enabled.

## Shared files intentionally changed

- `packages/application/src/jobs/job-catalog.js`
- `packages/application/src/jobs/queue-operation.js`
- `packages/config/src/connector-runtime-config.js`
- `packages/config/src/meta-end-to-end-runtime-config.js`
- `packages/connectors/src/meta/meta-token-connection-runtime.js`
- `apps/sync-worker/src/meta-end-to-end-job-router.js`
- `apps/sync-worker/src/google-ads-active-job-router.js`
- `.dev.vars.example`
- `wrangler.sync.example.jsonc`

## Added files

- `packages/application/src/use-cases/process-meta-end-to-end-sync.js`
- `apps/sync-worker/src/meta-active-job-router.js`
- `tests/application/meta-runtime-wiring.test.js`
- `tests/config/meta-runtime-wiring-config.test.js`
- `docs/tasks/meta-runtime-wiring.md`

## Explicitly not performed

- no Worker deployment;
- no Remote D1 migration or business mutation;
- no Remote Lark schema or record mutation;
- no Queue message sent;
- no Cron/Schedule activation;
- no Production secret or Cloudflare configuration change;
- no Meta token use, rotation, App change or Developer verification;
- no Customer LIVE UAT;
- no merge of this PR or parent PR.

## Next gate

After both stacked PRs pass Integration review and are merged in order, a separately approved manual operator task may run fixture/read-only validation. Exact customer identities and valid rotated credentials remain Environment/Secret-store inputs and are never committed.
