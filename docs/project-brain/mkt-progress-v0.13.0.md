# MKT Progress Baseline v0.13.7 — 2026-07-22

เปอร์เซ็นต์ทั้งหมดเป็น milestone estimate สำหรับวางแผน ไม่ใช่ code coverage และไม่ใช่ Production certification.

## Executive status

- **MKT Integration Workspace completion:** `59%`
- **Lark data model/schema foundation:** `100%`
- **Google Ads end-to-end:** `45%`
- **Customer-source replacement readiness:** `40%`
- **Chemistry K Production readiness:** `25%`

Schema เสร็จไม่ได้แปลว่า Connector และ Production เสร็จ. งาน Source delivery, reliability, customer-data validation, AI summary และ customer-owned cutover ยังเป็นสัดส่วนใหญ่.

## Current merged baseline

- Main commit: `d4a531fbb4e05dad7ce2296859c97f571e23acf3`
- Merged PR: `#13`
- Repository correction: `v0.13.7`
- Full gates: PASS
- Live mutations during repository correction: `0`

## Weighted Integration Workspace calculation

| Workstream | Weight | Completion | Weighted result |
|---|---:|---:|---:|
| Core runtime, Queue, D1, lock/retry/DLQ/alert | 12% | 95% | 11.40% |
| Lark data model, Canonical model, schema and managed Views | 13% | 100% | 13.00% |
| TikTok Organic | 12% | 95% | 11.40% |
| YouTube Organic | 12% | 90% | 10.80% |
| Facebook + Instagram Organic | 10% | 30% | 3.00% |
| Paid Ads: Meta + Google + TikTok Ads | 16% | 27% | 4.32% |
| WooCommerce + Chatwoot | 8% | 10% | 0.80% |
| Reporting, AI summary, insight and notification | 7% | 50% | 3.50% |
| Customer-data validation and Production cutover | 10% | 10% | 1.00% |
| **Total** | **100%** |  | **59.22% ≈ 59%** |

## Data model and Lark presentation — 100%

Fresh `Social MKT Data Hub(11).base` configuration-only audit:

| Gate | Result |
|---|---:|
| Physical tables | 42 |
| Fields | 737 |
| Views | 133 |
| Filtered Views | 42 |
| Sorted Views | 6 |
| Views with hidden fields | 7 |
| Duplicate table names | 0 |
| Table emoji/folder placement | 42/42 |
| View emoji names | 133/133 |
| Formula expressions | 4/4 |
| Google managed filters | 19/19 |
| Shared-table managed filters | 17/17 |
| Report Views | 6/6 |
| Google Ads Daily 30D | `platform=google_ads + TheLastMonth` |

### View-scope clarification

133 Views consist of:

- Shared managed 17
- Report managed 6
- Google managed 19
- All/default preserved 36
- Specialized legacy preserved 55

42 filtered Views are `17 + 6 + 19`.

The 55 specialized Views do not have approved business semantics merely because their names say Active, Latest, Failed, Connection Issues or similar. They are preserved intentionally and require a separate business-owner contract before mutation.

## Channel status

### TikTok Organic — 95%

Completed:

- protected Lark Native source
- RAW → Canonical Content/Daily
- stable key/idempotency/reconciliation
- D1 checkpoint, lock, retry, DLQ and alerts
- Daily/Weekly reports and Client Views
- Workspace schedules and reliability validation

Remaining:

- natural operational observation
- customer-data validation
- customer-owned Production cutover

### YouTube Organic — 90%

Completed:

- Public/OAuth access and identity gates
- RAW Channel/Video/Analytics and Canonical writes
- scheduled Workspace Data API and Owner Analytics
- large-account pagination/chunking/durable resume
- outbox/redrive/migration reliability and Workspace smoke

Remaining:

- customer-owned 837-video validation
- applicable rollout/observation gates
- Production cutover

### Facebook Organic — 30%

Completed:

- Page/post/Page Insights access preflight
- Meta transport foundation
- shared Lark schema

Remaining:

- connector/business adapter
- normalization, checkpoint/reconciliation and reliability
- schedule, validation and Production

### Instagram Organic — 30%

Completed:

- Instagram Login scopes/token lifecycle preflight
- media/media insights/account insights verification
- shared Lark schema

Remaining:

- connector and token-refresh operations
- reliability, schedule, validation and Production

### Meta Ads — 25%

Completed:

- `ads_read` access preflight
- valid no-data Account/Insights response
- Lark Ads schema and Canonical Ads v2 zero drift

Remaining:

- source queries/connector
- entity/daily normalization and writes
- reliability/reconciliation
- customer-data validation, schedule and Production

### Google Ads — 65%

Completed:

- customer-authorized account link/selectability
- exact allowlisted Manager Script read-only validation
- six non-empty bounded datasets
- errors/truncation `0/0`
- Google Ads `No changes`
- Frequency `—`
- Lark Google RAW schema, Canonical Ads, Relations, managed filters and formulas
- update-only View maintenance guard
- access-history and repository documentation correction
- sanitized read-only Script snapshot with DRY_RUN default
- exact HMAC/timestamp/nonce/replay/idempotency Contract
- API ingress, D1 delivery state and reference-only Queue job
- shared retry/lock/DLQ/redrive path
- six RAW plus six Canonical plan-before-write normalization and reconciliation tests

Direct API state:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current developer-token level Test Account Access
```

Manager Script MVP does not wait for direct API approval.

Remaining:

- signed PREVIEW against the existing Workspace Worker with customer data
- one-shot LIVE Lark reconciliation and zero-duplicate rerun
- controlled retry/lock/DLQ/redrive/expiry customer-source evidence
- schedule approval and customer-owned Production

### TikTok Ads — 10%

Completed:

- represented in Canonical Ads model and planning scope

Direction:

- controlled API/Worker connector for Production
- Lark native Ads integration is not the Production source of truth

Remaining:

- Business Center/app/advertiser authorization preflight
- metrics/dimensions/rate-limit contract
- connector, reliability, validation and Production

### WooCommerce — 10%

Completed:

- sanitized source/transport foundation
- client-owned Production rule

Remaining:

- approved active-scope data model
- connector, pagination, checkpoint/reconciliation, reliability and validation

### Chatwoot — 10%

Completed:

- sanitized operational contract and ownership direction

Remaining:

- final objects/retention contract
- connector, checkpoint/reconciliation, reliability and validation

## Reporting and AI — 50%

Completed:

- TikTok Daily/Weekly report engine
- managed Report Views
- deterministic completed-period dates
- idempotency and partial-write behavior

Remaining:

- multi-channel report aggregation
- AI summary/insight generation
- Lark group notification
- customer-specific report configuration and validation

## Customer-source replacement readiness — 40%

Completed:

- `integration_workspace` single profile on the existing technical `development` environment
- customer-owned source identity rule
- Canonical identity continuity into Production
- schedule/connector disabled-by-default rule
- channel access preflight for several sources

Remaining:

- reuse of the single Integration Workspace Cloudflare/D1/Queue/Lark resources
- signed Google Ads delivery validation
- Facebook/Instagram/Meta Ads connector validation
- retention/cleanup evidence
- channel-by-channel operational sign-off

## Production readiness — 25%

Completed:

- customer-owned Production architecture direction
- non-secret profile foundation
- separation and safety rules
- stable Canonical identity direction

Remaining:

- customer-owned Lark/App/Cloudflare/D1/Queues/Secrets
- connector credentials and authorization
- Production migrations and deploy
- customer-scale validation
- monitoring, rollback and operational ownership
- final cutover

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

The transitive `sharp` vulnerability chain was remediated with `overrides.sharp=0.35.3` and a refreshed lockfile.

## RAW error coverage note

The 13 Google RAW error Views use stable-key-only minimum QA:

```text
primary raw stable key isEmpty
```

This validates missing raw identity, not every supporting field. Comprehensive data-quality checks require a separate approved contract.

## Priority order

1. Approve Google Ads signed delivery contracts.
2. Implement disabled-by-default Google Ads ingress/Queue/D1/Lark path.
3. Run manual signed-delivery validation, idempotent rerun and reconciliation.
4. Implement Facebook/Instagram Organic connectors.
5. Implement Meta Ads and TikTok Ads tracks.
6. Implement WooCommerce and Chatwoot.
7. Complete multi-channel AI summary/notification.
8. Replace temporary sources channel by channel and validate on profile `integration_workspace`.
9. Build customer-owned Production and cut over.

## Permanent safety status

- Production disabled
- new connector/schedule flags disabled by default
- One mixed-source Integration Workspace is used before Production; Production isolated
- source ownership is tracked per Connector and temporary sources are replaced before final validation
- Production resources customer-owned
- secrets excluded from Source/Logs/Release
- every write path requires stable key/idempotency/retry/reconciliation
