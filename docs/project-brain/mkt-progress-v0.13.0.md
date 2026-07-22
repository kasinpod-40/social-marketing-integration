# MKT Progress Baseline v0.13.0 — 2026-07-22

เอกสารนี้เป็น Modular Project Brain สำหรับ Current progress หลังปิดงาน Ads/Google Ads Lark Schema ใน developer-owned DEV. เปอร์เซ็นต์ทั้งหมดเป็น **milestone estimate** สำหรับวางแผน ไม่ใช่ code coverage และไม่ใช่การรับรอง Production readiness.

## Executive status

- **MKT DEV MVP โดยรวม:** `58%`
- **Data model/Lark schema foundation:** `95%`
- **Customer-real UAT readiness:** `40%`
- **Chemistry K Production readiness:** `25%`

เหตุผลที่ Schema เกือบเสร็จแต่ภาพรวมยัง 58%: Connector, customer-real UAT, operational rollout, AI summary และ Production cutover ยังเป็นงานใหญ่กว่าการสร้าง Table/Field.

## Weighted DEV MVP calculation

| Workstream | Weight | Completion | Weighted result |
|---|---:|---:|---:|
| Core runtime, Queue, D1, lock/retry/DLQ/alert | 12% | 95% | 11.40% |
| Lark data model, Canonical model, schema and Views | 13% | 95% | 12.35% |
| TikTok Organic | 12% | 95% | 11.40% |
| YouTube Organic | 12% | 90% | 10.80% |
| Facebook + Instagram Organic | 10% | 30% | 3.00% |
| Paid Ads: Meta + Google + TikTok Ads | 16% | 25% | 4.00% |
| WooCommerce + Chatwoot | 8% | 10% | 0.80% |
| Reporting, AI summary, insight and notification | 7% | 50% | 3.50% |
| Customer-real UAT and Production cutover | 10% | 10% | 1.00% |
| **Total** | **100%** |  | **58.25% ≈ 58%** |

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

### Google Ads — 35%

Completed:

- Manager account and read-only reporting direction;
- Manager Script contract/dry-run foundation;
- Chemistry K target customer ID recorded in operational handoff;
- automated Lark schema: 13 RAW tables / 208 fields;
- Canonical Ads core 63/63, Relations 12/12 and View shells 19/19;
- zero destructive actions and zero Business Record writes.

Remaining:

- Manual Lark UI: 4 Formula expressions and 17 View filters;
- customer account link/selectability confirmation;
- Basic Access outcome/API live read UAT as applicable;
- Worker connector, normalization, checkpoints/reconciliation and reliability;
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

Latest audited Base export: `Social MKT Data Hub(8).base`, revision `51`.

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
| Formula expressions configured | 0/4 |
| View filters configured | 2/19 |

Automated schema task is closed. Manual UI remains a separate handoff and does not authorize Connector, Worker, Schedule or Production changes.

## Priority order from this baseline

1. Finish 4 Formula expressions and 17 View filters; export and audit Base again.
2. Complete Google Ads link/selectability and read-only customer-real UAT.
3. Approve and implement Google Ads connector behind disabled flags.
4. Implement Facebook/Instagram Organic connectors using the shared reliability architecture.
5. Complete Meta Ads and TikTok Ads connector/access tracks.
6. Implement WooCommerce and Chatwoot.
7. Complete multi-channel AI summary/insight/notification.
8. Run isolated `uat_chemistry_k` channel-by-channel.
9. Build customer-owned `chemistry_k` Production resources and perform cutover.

## Permanent safety status

- Production remains disabled.
- New connectors and schedules remain disabled by default.
- DEV/UAT/Production resources stay isolated.
- No secrets or tokens belong in Source or documentation.
- Customer-real UAT uses customer-owned source data with isolated developer-owned temporary UAT infrastructure.
- Production must be customer-owned.
