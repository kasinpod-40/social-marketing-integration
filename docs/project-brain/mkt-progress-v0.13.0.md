# MKT Progress Baseline v0.13.0 — 2026-07-22

เอกสารนี้เป็น Modular Project Brain สำหรับ Current progress หลังปิดงาน Ads/Google Ads Lark Schema ใน developer-owned DEV. เปอร์เซ็นต์ทั้งหมดเป็น **milestone estimate** สำหรับวางแผน ไม่ใช่ code coverage และไม่ใช่การรับรอง Production readiness.

## Executive status

- **MKT DEV MVP โดยรวม:** `59%`
- **Data model/Lark schema foundation:** `100%`
- **Customer-real UAT readiness:** `40%`
- **Chemistry K Production readiness:** `25%`

เหตุผลที่ Schema เสร็จแต่ภาพรวมยัง 59%: Connector, customer-real UAT, operational rollout, AI summary และ Production cutover ยังเป็นงานใหญ่กว่าการสร้าง Table/Field.

## Weighted DEV MVP calculation

| Workstream | Weight | Completion | Weighted result |
|---|---:|---:|---:|
| Core runtime, Queue, D1, lock/retry/DLQ/alert | 12% | 95% | 11.40% |
| Lark data model, Canonical model, schema and Views | 13% | 100% | 13.00% |
| TikTok Organic | 12% | 95% | 11.40% |
| YouTube Organic | 12% | 90% | 10.80% |
| Facebook + Instagram Organic | 10% | 30% | 3.00% |
| Paid Ads: Meta + Google + TikTok Ads | 16% | 27% | 4.32% |
| WooCommerce + Chatwoot | 8% | 10% | 0.80% |
| Reporting, AI summary, insight and notification | 7% | 50% | 3.50% |
| Customer-real UAT and Production cutover | 10% | 10% | 1.00% |
| **Total** | **100%** |  | **59.22% ≈ 59%** |

## Channel-by-channel status

### TikTok Organic — 95%

Completed:

- Lark Native protected source;
- RAW → Canonical Content/Daily flow;
- Stable key/idempotency/reconciliation;
- Queue, D1 checkpoint, lock, retry, DLQ and alert UAT;
- Daily/Weekly reports, Client Views and DEV schedules.

Remaining:

- natural operational observation and customer-real UAT/Production cutover.

### YouTube Organic — 90%

Completed:

- Public/OAuth access and identity gates;
- RAW Channel/Video/Analytics and Canonical writes;
- scheduled DEV Data API and Owner Analytics;
- large-account resumable design and DEV rollout;
- reliability/outbox/redrive/migrations 0004–0006.

Remaining:

- customer-owned 837-video Live UAT;
- pending Batch C / migrations 0007–0008 rollout where applicable;
- customer Production cutover.

### Facebook Organic — 30%

Completed:

- Page access/source preflight;
- real Page/posts and Page Insights read verification;
- shared Lark schema foundation.

Remaining:

- connector implementation;
- normalization, checkpoint/reconciliation, Queue/reliability tests;
- DEV schedule, customer-real UAT and Production.

### Instagram Organic — 30%

Completed:

- Instagram Login token lifecycle and scopes preflight;
- `/me`, media, media insights and account insights verification;
- shared Lark schema foundation.

Remaining:

- connector implementation and complete reliability lifecycle;
- token operations/refresh monitoring;
- schedule, customer-real UAT and Production.

### Meta Ads — 25%

Completed:

- Marketing API `ads_read` access preflight;
- Ad Account and valid no-data reporting response;
- Meta Ads Lark schema Apply and zero drift;
- Canonical Ads v2 migration and zero drift.

Remaining:

- connector/source queries and normalization;
- campaign/ad set/ad/creative/daily writes;
- reliability, reconciliation and schedule;
- customer-real data UAT and Production.

### Google Ads — 45%

Completed:

- Manager account and read-only reporting direction;
- Manager Script contract/dry-run foundation;
- Chemistry K target customer ID recorded in operational handoff;
- customer-authorized Chemistry K link/selectability passed through the approved direct manager; account is enabled and its production Overview opens read-only;
- API Center preflight confirmed token access remains test-account-only;
- Manager Script target allowlist updated and 598-line safety scan passed;
- read-only GAQL Preview passed `data_available` across six non-empty bounded datasets with zero errors/truncation and zero Ads changes;
- automated Lark schema: 13 RAW tables / 208 fields;
- Canonical Ads core 63/63, Relations 12/12 and View shells 19/19;
- zero destructive actions and zero Business Record writes.

Remaining:

- signed Script delivery endpoint, normalization, checkpoints/reconciliation and reliability;
- direct API access/OAuth UAT only if required for Phase 2 scale or unsupported fields;
- schedule and customer-real UAT/Production.

### TikTok Ads — 10%

Completed:

- channel recognized in Canonical Ads model and planning scope.

Remaining:

- access eligibility/Business Center/app authorization preflight;
- Sandbox/test strategy and reporting endpoint contract;
- connector implementation, reliability, UAT and Production.

### WooCommerce — 10%

Completed:

- sanitized source/transport foundation and client-owned Production rule.

Remaining:

- approved data model/source contract for active scope;
- connector, pagination, checkpoint/reconciliation, reliability and UAT.

### Chatwoot — 10%

Completed:

- sanitized contract foundation and ownership direction.

Remaining:

- final scope/objects/data retention contract;
- connector, checkpoint/reconciliation, reliability and UAT.

## Lark Ads schema closeout

Latest audited configuration-only export: `Social MKT Data Hub.base`, SHA-256 `3f177a1c2639da506c3e76e2d72bb9a018ccfb7ad29a38cbbca986b863d4b6c8`.

| Gate | Result |
|---|---:|
| Physical tables | 42 |
| Duplicate table names | 0 |
| Google RAW tables | 13/13 |
| Google RAW fields | 208/208 |
| Canonical Ads v2 core | 63/63 |
| Relations | 12/12 |
| View shells | 19/19 |
| Automated schema issues | 0 |
| New Google tables containing Records | 0 |
| Formula expressions configured | 4/4 Live editor verified |
| View filters configured | 19/19 Live |
| Fresh `.base` View audit | 133/133, zero Filter/Sort/Hidden drift |
| Fresh post-Formula `.base` audit | Formula/type/formatter 4/4; zero View drift |

Automated schema, Google View filters and Formula UI tasks are closed with Live and fresh `.base` verification. This does not authorize Connector, Worker, Schedule or Production changes.

## Priority order from this baseline

1. Approve and implement the signed Google Ads Manager Script delivery path behind disabled flags.
2. Complete manual signed-delivery, idempotency, reconciliation and reliability UAT before scheduling.
3. Implement Facebook/Instagram Organic connectors using the shared reliability architecture.
4. Complete Meta Ads and TikTok Ads connector/access tracks.
5. Implement WooCommerce and Chatwoot.
6. Complete multi-channel AI summary/insight/notification.
7. Run isolated `uat_chemistry_k` channel-by-channel.
8. Build customer-owned `chemistry_k` Production resources and perform cutover.

## Permanent safety status

- Production remains disabled.
- New connectors and schedules remain disabled by default.
- DEV/UAT/Production resources stay isolated.
- No secrets or tokens belong in Source or documentation.
- Customer-real UAT uses customer-owned source data with isolated developer-owned temporary UAT infrastructure.
- Production must be customer-owned.
