# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Daily Snapshot, Reporting, AI Summary, Insight และ Alert โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules.

ไฟล์นี้เก็บ **Current verified state** เท่านั้น. ประวัติรุ่นอยู่ใน `CHANGELOG.md` และเอกสาร Modular Project Brain ใต้ `docs/project-brain/`.

Authority order ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ.

## Current source baseline

- Implementation baseline: `d4a531fbb4e05dad7ce2296859c97f571e23acf3` / PR `#13`
- Documentation closeout: PR `#14`
- Application package line: `0.11.0`
- Current contract versions:
  - Shared/Ads schema closeout: `v0.13.0`
  - Google Ads View filters: `v0.13.5`
  - Formula UI: `v0.13.6`
  - Repository audit correction: `v0.13.7`

Contract version numbers are not automatic application package releases.

## Environment and ownership

### DEV

- Profile: `dev_ft_pumkin`
- Lark/Cloudflare/source assets: developer-owned
- TikTok Organic and YouTube Organic active only where DEV gates passed

### Customer-real UAT

- Profile: `uat_chemistry_k`
- Source accounts/data: customer-owned
- Temporary isolated Lark/Cloudflare: developer-owned
- Canonical `customerKey` and connector `accountKey`: `chemistry_k`
- Every new connector and schedule disabled by default

### Production

- Profile: `chemistry_k`
- Lark, Cloudflare, D1, Queue, App credentials and platform assets must be customer-owned
- Production remains disabled

Full ownership contract: `docs/project-brain/customer-real-uat.md`.

## Current Lark DEV baseline

Fresh configuration-only audit of `Social MKT Data Hub(11).base`:

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Table emoji/folders       42/42
View emoji names         133/133
```

Managed presentation:

```text
Google Ads Formula fields    4/4 PASS
Google Ads managed filters  19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
Google Ads Daily 30D         platform=google_ads + TheLastMonth
```

Do not rerun Lark View Apply or Formula UI work.

## Full View contract meaning

133 Views are classified as:

- 17 Shared-table managed Views
- 6 Report managed Views
- 19 Google Ads managed Views
- 36 All/default Views intentionally preserved without Filter
- 55 legacy specialized Views preserved without inferred business rules

The 42 filtered Views are exactly `17 + 6 + 19`.

“Full View contract complete” means every View is managed or explicitly preserved. It does not mean all specialized names such as Active, Failed, Latest, Connection Issues or High Spend Low ROAS already have business logic. The 55 specialized Views require a separate business-owner contract before mutation.

Contract: `docs/lark-full-view-contract-v0.13.5.md`.

## Active channel status

### TikTok Organic — 95%

Completed:

- Lark Native protected RAW source
- RAW → Canonical Content/Daily flow
- stable key, idempotency, reconciliation
- D1 checkpoint, lock, retry, DLQ and alerts
- Daily/Weekly reports and managed Client Views
- DEV schedules and live reliability gates

Remaining:

- ongoing operational observation
- customer-real UAT and Production cutover

### YouTube Organic — 90%

Completed:

- Public/OAuth access and identity gates
- RAW Channel/Video/Analytics and Canonical writes
- scheduled DEV Data API and Owner Analytics
- bounded large-account pagination/chunking and durable resume
- reliability/outbox/redrive migrations and DEV smoke

Remaining:

- customer-owned 837-video Live UAT
- applicable pending rollout/observation gates
- Production cutover

### Facebook Organic — 30%

Completed:

- real Page/post/Page Insights access preflight
- shared Lark schema foundation
- Meta Graph transport foundation

Remaining:

- business adapter and connector implementation
- normalization, checkpoint/reconciliation and reliability
- schedule, customer-real UAT and Production

### Instagram Organic — 30%

Completed:

- Instagram Login scopes/token lifecycle preflight
- media/media insights/account insights read verification
- shared Lark schema foundation

Remaining:

- connector and token operations
- reliability, schedule, UAT and Production

### Meta Ads — 25%

Completed:

- `ads_read` access preflight
- valid no-data Account/Insights response
- Ads Lark schema and Canonical Ads v2 zero drift

Remaining:

- source queries and connector
- entity/daily normalization and writes
- reliability, reconciliation, UAT, schedule and Production

### Google Ads — 65%

Completed:

- customer-authorized account link/selectability
- Manager Script exact allowlist and read-only GAQL UAT
- `data_available`, six non-empty bounded datasets
- errors/truncation `0/0`, Google Ads `No changes`
- automated Lark schema, Relations, managed filters and formulas
- repository safety correction and no-create View maintenance guard
- sanitized read-only Manager Script source committed with `DRY_RUN` default and no schedule/mutation API
- exact signed-delivery v1 ingress with HMAC, timestamp, nonce/replay and key rotation
- strict six-dataset allowlist/schema/limits/order/relation/null validation
- D1 idempotency/payload state, reference-only Queue job and shared reliability/lock/DLQ path
- six RAW plus six Canonical plan-before-write mappings and reconciliation tests

Direct API state:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current level Test Account Access
```

Direct API is optional Phase 2 for MVP.

Remaining:

- isolated signed PREVIEW against a deployed UAT Worker
- one-shot LIVE delivery and Google Ads UI reconciliation
- customer-real zero-duplicate rerun and controlled retry/lock/DLQ/redrive evidence
- separate schedule approval and customer-owned Production cutover

Contract: `docs/google-ads-signed-delivery-contract-v1.md`.
Runbook: `docs/google-ads-signed-delivery-uat.md`.
Sanitized source UAT evidence: `docs/google-ads-manager-script-read-only-uat-evidence.md`.

### TikTok Ads — 10%

Completed:

- represented in Canonical Ads model and planning scope

Direction:

- Production integration must use a controlled API/Worker connector
- Lark native Ads integration is not the Production source of truth

Remaining:

- access/Business Center/app authorization preflight
- reporting contract and connector
- reliability, UAT and Production

### WooCommerce — 10%

- sanitized source/transport foundation exists
- connector, pagination, checkpoint/reconciliation and UAT remain

### Chatwoot — 10%

- sanitized contract exists
- final objects/retention contract, connector and UAT remain

## Core runtime state

Reusable reliability foundation exists for active connectors:

- Queue-backed jobs
- D1 checkpoints and resumable work
- distributed lease lock and renewal
- bounded retry and Permanent classification
- DLQ and controlled redrive
- deterministic alert/outbox behavior
- partial-write semantics and reconciliation
- secret/identity redaction

Every new connector must reuse these contracts rather than add parallel reliability logic.

## Google Ads View safety correction

The generic report View installer supports View creation for legitimate setup flows. The Google Ads Filter command is update-only and now adds a dedicated guard:

- `createViews` must be zero
- every action must be `update_view`
- missing View blocks with `GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE`
- wrapped client rejects `createView`

This is future-maintenance protection only. Current Lark state is already zero drift.

## RAW error coverage decision

The 13 Google RAW error Views use a stable-key-only minimum contract:

```text
primary raw stable key isEmpty
```

They detect missing raw identity, not every invalid customer/entity/status/report/policy field. Comprehensive Data Quality validation must be a separate approved contract.

## Manager Script evidence boundary

The 598-line safety scan is documented Live review evidence. Sanitized Script source is not committed, so it is not an independently reproducible source audit. Before external delivery, commit either:

- sanitized Script source; or
- immutable checksum + exact query/output manifest + safety report.

No customer ID, token, secret or sample business row may be committed.

## Repository correction verification

PR #13 passed:

```text
npm ci                         PASS
npm run check                  PASS
Focused staged TikTok           4/4 PASS
Node Unit/Integration         540/540 PASS
Workers runtime                 9/9 PASS
Report reliability             70/70 PASS
npm audit --audit-level=high    0 vulnerabilities
npm run deploy:dry-run          PASS
```

The transitive vulnerable `sharp` chain was remediated with `overrides.sharp=0.35.3` and a refreshed lockfile. No Live resource mutation occurred.

## Current project progress

Milestone estimates, not code coverage:

```text
MKT DEV MVP                         ~59%
Lark data model/schema foundation   100%
Google Ads end-to-end                65%
Customer-real UAT readiness          40%
Chemistry K Production readiness     25%
```

Detailed weighting: `docs/project-brain/mkt-progress-v0.13.0.md`.

## Current task

`docs/current-task.md` records the Google Ads signed-delivery implementation as `implemented_ready_for_isolated_uat`.

The locked Contract is `docs/google-ads-signed-delivery-contract-v1.md`. The UAT and rollback procedure is `docs/google-ads-signed-delivery-uat.md`.

## Next gate

Run isolated signed PREVIEW and manual one-shot LIVE UAT with Schedule disabled. Production remains blocked until exact reconciliation, zero-duplicate rerun, retry/lock/DLQ/redrive, regression and customer-owned resource gates pass.

## Permanent safety rules

- Data model before connector
- new connector flags and schedules disabled by default
- no fake Production success or dummy Production data
- every Write path requires stable key, idempotency and retry semantics
- missing metric is `null`, not zero, unless the source proves zero
- secrets remain in Environment/Secret Manager
- DEV/UAT/Production infrastructure stays isolated
- Production resources must be customer-owned
- no Live Apply based only on chat instructions when Repository contract is newer
