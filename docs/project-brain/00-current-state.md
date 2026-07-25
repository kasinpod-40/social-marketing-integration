# 00 — Current State

## Google Ads signed delivery Phase 2 Remote transport UAT

ผู้ใช้อนุมัติ Contract ของ Google Ads Manager Script signed-delivery แล้ว
Phase 1 merge ผ่าน PR `#51` ที่ `d7400c5` และ Phase 2 merge ผ่าน PR `#52` ที่
`e317fb9`. Contract authority อยู่ที่
`docs/google-ads-manager-script-signed-delivery-contract-v1.md`

```text
TASK_STATUS       = PHASE_2_REMOTE_TRANSPORT_UAT_COMPLETE
IMPLEMENTATION    = PREVIEW_INGRESS_TRANSPORT_DEPLOYED_SAFE_CLOSED
MIGRATION_0013    = APPLIED
SIGNED_PREVIEW    = CONTRACT_CLIENT_PASS
ACTUAL_ADS_SCRIPT = EXTERNAL_PREVIEW_PENDING
LIVE_DELIVERY     = DISABLED
BUSINESS_WRITES   = DISABLED
SCHEDULES         = DISABLED
PRODUCTION        = BLOCKED
GOOGLE_ADS_PR_17  = DRAFT_HOLD_EVIDENCE_ONLY
```

Approved Remote rollout ผ่าน verified D1 backup, Migration `0013`, API Worker
deployment, signed transport PREVIEW, exact retry/replay, immediate payload
redaction และ zero Business/Queue drift. Final Google Ads flags ทั้งสามเป็น
`false`; Cloudflare signing Secret คงอยู่ใน Secret store และไฟล์ Local ชั่วคราว
ถูกลบแล้ว.

Local Full gates ผ่าน: Focused Phase 2 `45/45`, Unit `759/759`, Workers
runtime `9/9`, report reliability `70/70`, Architecture `211/508/0`,
repository hygiene, npm audit `0` และ API/Sync Worker deploy dry-run.

Contract ใหม่แก้ Architecture เดิมของ PR `#17` โดยใช้ multi-chunk transport,
reference-only Queue, D1-first Storage และ Shared RAW
`RAW_Ads_Entities`/`RAW_Ads_Daily` ไม่มี separate RAW Google tables.

## Customer OAuth retry-safe v2 — customer links active

As of 2026-07-24, Shared Customer Connection/OAuth, Google Ads OAuth and YouTube OAuth are implemented, verified and merged in order through PRs `#42` → `#43` → `#44`. The approved Integration Workspace rollout is complete through Remote D1 migration, Google Cloud configuration, Worker Secrets/runtime mappings, deployment and HTTP smoke.

```text
CONNECTOR_IMPLEMENTATION            COMPLETE_MERGED
RETRY_SAFE_V2                       DEPLOYED_CUSTOMER_LINKS_ACTIVE
MOCK_CONTRACT_TEST                  PASS
INTEGRATION_WORKSPACE_DEPLOYMENT    PASS
CUSTOMER_OAUTH                      AWAITING_CUSTOMER_ACTION
LIVE_ACCESS                         NOT_RUN
HTTP_SMOKE                          PASS_404_405
CONNECT_LINK_GENERATION             V2_CUSTOMER_LINKS_2_ACTIVE_7D
REMOTE_MIGRATION                    0011_0012_APPLIED
LIVE_WORKER                         V2_PREVIEW_SAFE
SCHEDULE                            DISABLED
PRODUCTION                          BLOCKED
```

Migrations `0011` and `0012` are applied remotely with no pending migration.
Worker v2 is deployed; final Secret-change version
`79ef3710-2ed2-4373-b0d0-42ec76896fa6` is at 100%. Historical v1 invitations
remain consumed and closed.

PR `#45` implements contract v2 and is merged to `main` at `9ca8375`:
side-effect-free GET confirmation, exact POST-to-start, default three bounded
attempts, one atomic active-attempt lock, retry after expiry/failure and permanent
closure on successful callback. Additive migration
`0012_retry_safe_customer_connection.sql` is now applied remotely. Focused suites pass
43/43; Unit 686/686, Workers 9/9, report reliability 70/70, Architecture
191/460/0, audit 0 and deploy dry-run pass. GitHub Branch Verification passed.
Remote backup, migration, real-config dry-run, deployment and HTTP smoke passed.
The 15-minute test invitations expired unused with zero OAuth starts. On
`2026-07-25`, one seven-day/three-attempt customer invitation per connector was
created and handed to the user. They expire around
`2026-08-01 00:15 Asia/Bangkok`; signed URLs are not stored. Provider callbacks
remain pending. No Queue/Lark effect or schedule change occurred. PR #17 remains
Draft/HOLD.

## Source baseline

- Implementation baseline: `d4a531fbb4e05dad7ce2296859c97f571e23acf3` / PR `#13`
- Documentation closeout: PR `#14`
- Current task: `docs/current-task.md` — Google Ads signed-delivery Local Phase 1
  complete, awaiting review/commit decision; customer callbacks remain an
  external parallel wait
- Application package line: `0.11.0`
- Contract versions: View `v0.13.5`, Formula `v0.13.6`, audit correction `v0.13.7`

## Lark DEV baseline

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
Google Formula fields        4/4
Google managed filters      19/19
Shared managed filters      17/17
Report Views                 6/6
```

`Google Ads Daily 30D` is `platform=google_ads AND metric_date=TheLastMonth`.

No Lark View or Formula Apply is pending. Do not rerun.

## View classification

133 Views:

- 17 Shared-table managed
- 6 Report managed
- 19 Google Ads managed
- 36 All/default preserved unfiltered
- 55 specialized legacy Views preserved without inferred business logic

42 filtered Views are exactly `17 + 6 + 19`.

The 55 specialized Views are not defective merely because their names imply Active, Latest, Failed or similar semantics. They have no approved exact business-owner contract and must remain unchanged until a separate task defines Filter, Sort and Hidden fields.

## Channel state

### Active in verified DEV

- TikTok Organic
- YouTube Organic

### Access/schema ready but connector pending

- Facebook Organic
- Instagram Organic
- Meta Ads
- Google Ads signed delivery Phase 1 local foundation

### Planning/access pending

- TikTok Ads
- WooCommerce
- Chatwoot

### Meta customer-app access gate

The customer-owned Meta app was inspected read-only in the customer Safari
session on `2026-07-25`. Marketing/Page read permissions are available for
testing, but Meta reports API access restricted until every app administrator
completes Developer Portal account verification. The user confirms that the
customer supplied separate Facebook and Instagram tokens. The locally stored
Instagram credential passed a read-only `/me` identity request with HTTP `200`;
the Facebook credential is present locally but all read-only identity,
permission, Page, app and debug requests returned the sanitized provider
outcome `API access blocked`. The later Business Settings inspection no longer
showed the administrator that issued that credential, so it must be treated as
orphaned and rotated after verified administration is restored.

The token-based Meta preflight foundation is now implemented locally on
`codex/meta-token-preflight-foundation` and pushed at `c1675ed`: independent Facebook Organic,
Instagram Organic and Meta Ads GET-only adapters, exact identity guards,
redacted results and the `npm run preflight:meta` operator command. All three
connectors remain `uat_pending` and disabled. No Live request, write, deployment
or Production action occurred in the implementation round. Live UAT waits for a
new Facebook token, pinned API version and exact Page/Instagram/Ad Account
mappings. No raw App/Business ID is stored here, no dashboard setting was
changed, and the separate developer-owned app is not evidence for customer
readiness.

The follow-on Meta Business Ingestion design is prepared without Live access in
`docs/meta-business-ingestion-contract-v1.md` and
`packages/config/src/meta-business-ingestion-contract.js`. It locks GET-only
datasets, the five existing Shared Raw tables, D1/Canonical destinations,
Stable keys, Coverage/revision and credential lifecycles.

The authorized local-only follow-on now also has contract-bound GET adapters,
safe static operation observability, pure Shared Raw/D1 candidate normalizers
and synthetic Facebook/Instagram/Meta Ads fixtures. Focused tests pass 28/28;
Unit 719/719, Workers 9/9, report reliability 70/70, Architecture
206/492/0, repository hygiene and Wrangler dry-run pass. Dependency files were
unchanged and the explicitly approved fresh online npm audit reports zero
vulnerabilities. No Live request, Queue/D1/Lark writer, Worker route, job,
feature activation, schedule or deployment was added. Every dataset remains
`live_fixture_required`.

## Google Ads state

Completed:

- customer-authorized account link/selectability
- Manager Script read-only UAT
- six bounded non-empty datasets
- errors/truncation `0/0`
- Google Ads `No changes`
- Frequency `—`
- Lark schema/Relations/filters/formulas
- update-only Google View maintenance guard

Direct API:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current access Test Account Access
```

Remaining:

- review/commit/push/PR ของ Remote rollout Closeout
- actual Google Ads Manager Script `AdsApp` external PREVIEW
- reference-only Queue admission + Sync Worker processing
- normalization and destination writes
- reliability/reconciliation UAT
- schedule and Production

## Google View safety correction

The generic View installer may create Views for setup workflows. The Google Ads Filter command is explicitly update-only:

- `createViews=0`
- action allowlist `update_view`
- missing View is a blocker
- wrapped client rejects `createView`

Current Live Base is already zero drift; the guard protects future maintenance.

## RAW error coverage

The 13 Google RAW error Views use stable-key-only minimum QA:

```text
primary raw stable key isEmpty
```

Comprehensive customer/entity/status/report/policy validation is a separate future Data Quality contract.

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

The transitive `sharp` vulnerability chain was fixed with `overrides.sharp=0.35.3` and a refreshed lockfile. No Live resource mutation occurred.

## Runtime safety

- DEV/UAT/Production remain isolated
- UAT and Production connectors/schedules disabled by default
- Production customer-owned
- secrets only in Environment/Secret Manager
- every write path requires stable key, idempotency, retry and reconciliation
- missing metric remains `null` unless the source proves zero

## Next approval gate

Review/Commit/Push/PR เอกสาร Remote rollout Closeout. จากนั้นขออนุมัติ External
PREVIEW จาก Google Ads Manager Script จริง. Queue, Business writer, Lark write,
LIVE, Schedule และ Production ยังต้องได้รับอนุมัติแยก.
