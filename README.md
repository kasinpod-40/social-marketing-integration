# Social Marketing Data Integration

ระบบรวมข้อมูล Organic Social, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base สำหรับ Daily Snapshot, Reporting, Monitoring, AI Summary และ Alert โดยใช้ JavaScript ES Modules, Cloudflare Workers, D1, Queues และ Lark Open API

## Current baseline

- Authoritative task: `docs/current-task.md`
- Current main before correction: `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- Correction branch: `work/repository-closeout-corrections`
- Application package version: `0.11.0`
- v0.13.x labels are schema/contract/tool revisions, not the deployed application release version.
- Production remains disabled.

## Reading order

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/* ที่เกี่ยวข้อง
→ README.md / CHANGELOG.md
→ Source code และ Tests
```

`docs/current-task.md` has higher authority than historical README/CHANGELOG notes when status conflicts.

## Current Lark DEV state

```text
Physical tables              42
Fields                      737
Views                       133
Duplicate table names         0
Table emoji/folder         42/42
View emoji                133/133
Formula fields               4/4
Shared managed filters      17/17
Report managed Views          6/6
Google Ads managed filters  19/19
Filtered Views                42
Sorted Views                   6
Views with hidden fields       7
Google RAW tables/fields 13/13 / 208/208
Canonical Ads core           63/63
Google Relations/View shells 12/12 / 19/19
```

`Google Ads Daily 30D` is verified as:

```text
platform = google_ads
metric_date = TheLastMonth
```

### View contract classes

The 133 Views are:

- 17 shared-table managed Views;
- 6 report managed Views;
- 19 Google Ads managed Views;
- 36 All/default Views intentionally unfiltered;
- 55 legacy specialized Views preserved without inferred business logic.

The managed and preservation contracts pass. The 55 legacy specialized Views do not yet implement business meanings implied by names such as Active, Failed, Latest or High Spend Low ROAS. A separate approved contract is required before changing their Filter, Sort or Hidden fields.

## Google Ads status

### Access

- Chemistry K advertiser link/selectability: pass.
- Advertiser enabled under the intended manager.
- Basic Access application submitted on `2026-07-21`.
- Case ID: `1-686800040839`.
- Cloud project number: `788131774873`.
- Review: pending.
- Current developer-token level: Test Account Access.
- Manager Script MVP does not depend on direct API approval.

Any older statement saying no application was submitted is superseded.

### Manager Script read-only UAT

- Exact advertiser allowlist passed.
- Read-only `AdsManagerApp` + `AdsApp.search()` GAQL.
- Six bounded datasets succeeded and were non-empty.
- Dataset errors/truncation: `0/0`.
- Runtime-incompatible `campaign.start_date` and `campaign.end_date` were removed from requests; nullable outputs remain `null`.
- Google Ads Preview: `No changes`.
- Frequency: `—`; no schedule.
- No `UrlFetchApp`, external delivery, Worker ingestion, Queue/D1 path or Lark destination writes exist yet.

Evidence boundary: `docs/google-ads-manager-script-evidence-v0.13.7.md`.

### Google Ads View Filters

Read-only Preview:

```bash
npm run setup:google-ads-view-filters
```

Apply only after an approved drift is found:

```bash
CONFIRM_WRITE=YES npm run setup:google-ads-view-filters:apply
```

The command is update-only:

- missing managed Views block;
- `create_view` and every non-`update_view` action are forbidden;
- no View creation/deletion/rename;
- no Sort, Table, Field or Business Record mutation.

Do not rerun after the verified zero-drift closeout unless a new read-only Preview proves drift.

### Formula contract

```text
MKT_Ads_Campaigns.budget
IF(ISBLANK([budget_micros]),"",[budget_micros]/1000000)

MKT_Ads_Daily.all_conversion_value
IF(ISBLANK([all_conversion_value_micros]),"",[all_conversion_value_micros]/1000000)

MKT_Ads_Daily.cost_per_conversion
IF(OR(ISBLANK([conversions]),[conversions]=0,ISBLANK([spend])),"",[spend]/[conversions])

MKT_Ads_Daily.conversion_rate
IF(OR(ISBLANK([clicks]),[clicks]=0,ISBLANK([conversions])),"",[conversions]/[clicks])
```

The first three fields use Number with two decimals. `conversion_rate` uses Percentage with decimals.

## Connector status

### Active in developer-owned DEV

- TikTok Organic
- YouTube Organic

### Access/schema ready, connector planned

- Facebook Organic
- Instagram Organic
- Meta Ads
- Google Ads signed delivery

### Early planning

- TikTok Ads
- WooCommerce
- Chatwoot
- Multi-channel AI summary/notification

Every connector and schedule is disabled by default until its own access, identity, source-contract and reliability gates pass.

## Google Ads next workstream

Open a separate task:

```text
Google Ads Manager Script signed delivery connector
```

Lock before implementation:

1. six-dataset payload schema and schema version;
2. stable keys and idempotency keys;
3. HMAC signature, timestamp, nonce and replay window;
4. bounded batch and payload limits;
5. null semantics;
6. partial-write and retry behavior;
7. Queue, DLQ, checkpoint, lock and reconciliation;
8. retention, audit and redaction;
9. DEV/UAT/Production ownership;
10. schedule disabled by default.

The current runtime has no Google Ads connector catalog entry, feature flag, Queue job, Worker route, D1 nonce/checkpoint or destination writer.

## Local development

Requirements:

- Node.js `>=22`
- npm
- Wrangler

Install and run gates:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
```

### Secrets and local configuration

Copy examples locally:

```bash
cp .dev.vars.example .dev.vars
cp wrangler.sync.example.jsonc wrangler.sync.jsonc
chmod 600 .dev.vars
```

Never commit:

- `.dev.vars`
- `wrangler.sync.jsonc`
- tokens, API keys, passwords or app secrets
- local D1 files, `.wrangler`, `node_modules` or build outputs

Do not use `source .dev.vars` when values may contain spaces. Use repository loaders or export values safely.

## Runtime ownership

### DEV

- profile: `dev_ft_pumkin`
- developer-owned Lark, Cloudflare and source assets

### Customer-real UAT

- profile: `uat_chemistry_k`
- customer-owned source accounts/data
- isolated temporary developer-owned Lark/Cloudflare UAT resources
- schedules disabled by default

### Production

- profile: `chemistry_k`
- customer-owned Lark Base/App, Cloudflare, D1, Queues, Secrets and platform assets
- developer invited only with required roles

Canonical `customerKey` and connector `accountKey` must remain stable between UAT and Production.

## Main commands

```bash
# Tests and checks
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run

# TikTok Organic
npm run validate:tiktok
CONFIRM_WRITE=YES npm run sync:tiktok

# Report schema and Views
npm run setup:report-schema
CONFIRM_WRITE=YES npm run setup:report-schema:apply
npm run setup:report-views
CONFIRM_WRITE=YES npm run setup:report-views:apply

# YouTube
npm run preflight:youtube
npm run setup:youtube-schema
CONFIRM_WRITE=YES npm run setup:youtube-schema:apply
npm run job:youtube-sync

# Shared-table schema
npm run preview:shared-table-schema
npm run setup:shared-table-schema
CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply

# Google Ads managed View filters
npm run setup:google-ads-view-filters
CONFIRM_WRITE=YES npm run setup:google-ads-view-filters:apply

# Release packaging
npm run release:package
npm run release:verify -- outputs/releases/social-marketing-integration-v0.11.0.zip
```

Preview commands remain read-only. Apply commands require explicit confirmation and must target the approved environment/profile.

## Architecture

```text
apps/
  api-worker/       HTTP health/status
  sync-worker/      Scheduled and Queue jobs

packages/
  domain/           entities and value objects
  application/      use cases, connector registry, job contracts
  sync-engine/      storage-neutral plan/diff/execute
  connectors/       Lark, TikTok, YouTube, Meta transport, source contracts
  config/           profiles, mappings and contracts
  reliability/      D1/Lark stores, lease lock, retry/recovery
  shared/           errors, dates and HTTP utilities
```

Dependency direction must remain inward toward domain/application contracts. Avoid duplicate utilities and connector-specific reliability implementations when shared modules can be extended safely.

## Permanent data rules

- Data model and source contract before connector coding.
- Stable keys and idempotency on every write path.
- Missing metric = `null`, not fabricated zero.
- Bounded pagination, batching, concurrency and memory.
- Retryable versus permanent errors must be explicit.
- Partial-write semantics and reconciliation must be testable.
- Unknown jobs and schema versions fail permanently.
- Business records are never used to fake UAT success.
- Production resources are customer-owned.

## References

- `AGENTS.md`
- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `docs/project-brain/00-current-state.md`
- `docs/project-brain/10-next-actions.md`
- `docs/project-brain/mkt-progress-v0.13.0.md`
- `docs/lark-full-view-contract-v0.13.5.md`
- `docs/Lark_Full_View_Audit_v0.13.5.md`
- `docs/repository-closeout-corrections-v0.13.7.md`
- `docs/google-ads-manager-script-evidence-v0.13.7.md`
