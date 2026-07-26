# WooCommerce End-to-End Integration

## Workstream status

```text
TASK_STATUS                     = READY_FOR_INTEGRATION_REVIEW
WORKSTREAM                      = WOOCOMMERCE_END_TO_END
BRANCH                          = agent/woocommerce-end-to-end
DRAFT_PR                        = #66
AUDITED_BASE_SHA                = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
CURRENT_PR_BASE_SHA             = acb0b76bb3be936319e0e8bed4849592c96761b5
LATEST_SHARED_MIGRATION_SEEN    = 0016
CODE_VERIFICATION_HEAD          = 987c845d494e1d83531f0b95b2386777ca8900ce
CODE_VERIFICATION_RUN           = 541 / PASS
REMOTE_D1_MIGRATION             = NOT_APPLIED
WORKER_DEPLOYMENT               = NONE
QUEUE_MESSAGE                   = NONE
REMOTE_LARK_MUTATION            = NONE
SCHEDULE                        = DISABLED
LIVE_UAT                        = NOT_AUTHORIZED
PRODUCTION                      = BLOCKED
MERGE                           = NOT_PERFORMED
```

This Workstream stops at a Draft PR. Integration Chat owns all reserved-file changes, migration numbering/application, runtime routing, shared table registration, deployment and UAT.

## Repository audit

Read and reviewed before implementation:

- `AGENTS.md`
- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `README.md`
- root `package.json`
- Storage Architecture and Migration Contract v1
- Connector Catalog and Job Catalog
- customer profiles
- D1 Marketing History/Coverage store
- `D1ResumableWorkStore`
- `TableSyncEngine`
- Sync Worker runtime infrastructure
- staged Google Ads D1-first/Lark-repair pattern
- open Draft PRs present at Workstream start
- shared migration sequence

### Audit conclusions

- WooCommerce Connector and Job identifiers already exist in shared catalogs and remain disabled/planned.
- Existing Shared Reliability, distributed lock, generation fence, Queue/DLQ, Coverage, D1 and Lark engines must be injected; none were recreated.
- Commerce storage did not exist in Storage v1, so this branch provides an unnumbered additive migration proposal outside `migrations/`.
- `main` advanced after branch creation. Pull-request verification tests the merge result against the current PR base without editing reserved shared files.
- The current shared migration sequence has advanced to `0016`; Integration Chat must allocate the then-current next number rather than copying a stale number from this Task.

## Source contract

### API and authentication

- REST base path: `/wp-json/wc/v3`.
- HTTPS is mandatory.
- Consumer Key/Secret are sent only through the HTTP Basic `Authorization` header.
- Query-string credentials are rejected to avoid URL/proxy/log leakage.
- Customer UAT/Production must use read-only credentials owned by the customer.
- Secrets never enter Source code, Queue messages, D1 rows, Lark rows or operational details.

### Pagination

- Sequential, 1-based `page` pagination.
- `per_page` is bounded to `1..100`.
- `X-WP-Total` and `X-WP-TotalPages` provide expected-row/page evidence.
- Missing headers fall back safely and may cause one empty terminal-page read rather than silent truncation.
- Refund and Variation subresources use bounded nested pagination and bounded concurrency.

### Incremental and late-update strategy

- Orders and Products use:

```text
modified_after=<overlapped watermark>
dates_are_gmt=true
orderby=modified
order=asc
```

- A configurable overlap window re-reads recent modifications.
- Late status changes and refunds upsert the Stable Order/line keys and rebuild the original Asia/Bangkok metric date.
- A full reconciliation omits `modified_after` and requires expected Source rows to equal observed Source rows.
- Incremental Coverage is `recent_window`; it must never claim full-inventory completeness.
- Categories, Customers and Coupons use paged snapshots according to endpoint capability.
- Variable Products fetch Variations per changed parent Product.
- Orders fetch detailed Refunds when Source summaries/status indicate a refund.

### Error classes

| Condition | Classification |
| --- | --- |
| `401`, `403` | permanent credential/permission failure |
| `404` | permanent route/version mismatch |
| invalid request/Source contract | permanent |
| network, `408`, `425`, `429`, `5xx` | transient/retryable |
| invalid JSON/identity mismatch | permanent unless upstream truncation evidence exists |

`Retry-After` is retained when supplied.

## Data model

Money is stored as signed integer micros:

```text
1 currency unit = 1,000,000 micros
```

Decimal Source strings are parsed without floating-point arithmetic. ISO currency is retained on every monetary fact; currencies are never summed together.

### RAW tables

| Table | Primary / idempotency key | Grain |
| --- | --- | --- |
| `raw_commerce_stores` | `woocommerce:account_key` | sanitized Store identity |
| `raw_commerce_orders` | `woocommerce:account_key:order_id` | current sanitized Order payload |
| `raw_commerce_order_items` | `order_key:line_item_id` | Order line item |
| `raw_commerce_products` | `woocommerce:account_key:product_id` | Product |
| `raw_commerce_product_variations` | `woocommerce:account_key:product_id:variation_id` | Variation |
| `raw_commerce_categories` | `woocommerce:account_key:category_id` | Category |
| `raw_commerce_customers` | `woocommerce:account_key:customer:customer_id` | PII-minimized registered customer snapshot |
| `raw_commerce_coupons` | `woocommerce:account_key:coupon_id` | Coupon with hashed code |
| `raw_commerce_refunds` | `order_key:refund_id` | Refund / partial refund |

RAW rows retain selected allowlisted fields, Source hash, Source modified timestamp, fetched time, Sync Run and Coverage Run. They are not unrestricted payload archives.

### Canonical tables

| Table | Primary / idempotency key | Grain |
| --- | --- | --- |
| `commerce_store_state` | `woocommerce:account_key` | Store state |
| `commerce_order_state` | `woocommerce:account_key:order_id` | current Order state/economics |
| `commerce_order_status_observations` | `order_key:status:source_modified_at` | Source-observed status history |
| `commerce_order_line_facts` | `order_key:line_item_id` | line economics and Product identity |
| `commerce_product_state` | `woocommerce:account_key:product_id[:variation_id]` | Product/Variation state |
| `commerce_customer_aggregates` | `woocommerce:account_key:registered:customer_id:currency` | registered-customer aggregate by currency |

Guest checkout uses `customer_type=guest`. No email/phone-derived cross-Order guest identity is created.

### Daily fact tables

| Table | Primary / idempotency key | Grain |
| --- | --- | --- |
| `commerce_daily_sales_facts` | `woocommerce:account_key:metric_date:currency` | Store × Asia/Bangkok date × currency |
| `commerce_product_daily_facts` | `product_key:metric_date:currency` | Product/Variation × date × currency |

The migration proposal creates 17 additive tables in total and the D1 repository fails closed until all 17 are present.

## Metric definitions

```text
gross_sales_micros
  = SUM(line subtotal + line subtotal tax)

discount_micros
  = order discount total + order discount tax

refund_micros
  = absolute SUM(detailed refund total)

net_sales_micros
  = gross sales - discount - refund

shipping_micros
  = shipping total + shipping tax

tax_micros
  = order total tax

recognized_revenue_micros
  = order total - refund
```

Status treatment:

- `processing`, `completed`, `refunded`: recognized state.
- `pending`, `on-hold`: provisional state.
- `cancelled`, `trash`: cancelled state with zero recognized count/revenue.
- `failed`: failed state with zero recognized count/revenue.
- Full/partial refunds subtract exact refund amounts and refunded line quantities where detailed evidence exists.
- Negative corrections are preserved.
- Unknown/missing evidence remains explicit rather than being fabricated as zero.

Product performance includes quantity, gross, allocated line discount, refund amount/refunded quantity, net sales and recognized Order count.

Payment and shipping summaries are generated from D1 Order state. Multiple shipping methods on one Order are represented as one deterministic combined bucket so Order/revenue totals are not double counted.

## PII minimization

Never store or emit to Lark:

- billing/shipping names
- email
- phone
- street address/postcode/exact location
- customer IP address
- user-agent
- payment token/card/gateway secret
- passwords/session/reset data
- free-form customer note
- refund reason text
- unrestricted metadata
- raw Coupon code

Allowed customer identity is limited to WooCommerce numeric customer ID plus aggregate timestamps/counts/money by currency. Guest Orders have no durable person-level key.

## Execution and Reliability contract

Shared caller owns:

- Reliability Runner
- distributed lock and renewal
- generation fence
- Queue retry and DLQ
- runtime routing and flags

WooCommerce use case owns:

- Source pagination and nested enrichment
- privacy-minimized normalization
- per-page resumable checkpoint
- D1-first writes
- derived daily/customer rebuild
- Lark repair using existing `TableSyncEngine`
- Coverage and reconciliation

Page ordering:

```text
validate Source page and configured Lark table IDs
→ plan direct Lark rows
→ idempotent D1 RAW/Canonical upserts
→ rebuild/read D1-derived facts
→ plan derived Lark rows
→ execute existing TableSyncEngine plans
→ save Coverage and durable page checkpoint
```

Consequences:

- Source/contract failure causes zero D1/Lark writes.
- Direct Lark plan failure occurs before D1.
- Derived Lark failure can occur after D1 because derived rows are D1-generated; retry idempotently replays D1 and repairs Lark.
- Continuations contain reference/checkpoint identity only, never Source payload or credentials.
- No unseen entity is deleted or zeroed during incremental Coverage.

## Lark targets

Proposed logical registry keys; Integration Chat must allocate actual table IDs:

```text
rawCommerceStores
rawCommerceOrders
rawCommerceOrderItems
rawCommerceProducts
rawCommerceProductVariations
rawCommerceCategories
rawCommerceCustomers
rawCommerceCoupons
rawCommerceRefunds
mktCommerceOrders
mktCommerceProducts
mktCommerceCustomers
mktCommerceDaily
mktCommerceProductDaily
```

Every write uses existing `TableSyncEngine.planByKey()` and `executePlan()`.

## Runtime flags

All proposed defaults remain false:

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

Proposed Integration-managed configuration/secrets:

```text
WOOCOMMERCE_BASE_URL
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
WOOCOMMERCE_API_VERSION=wc/v3
WOOCOMMERCE_PAGE_SIZE=100
WOOCOMMERCE_INCREMENTAL_OVERLAP_SECONDS=300
```

## Files changed

- `docs/tasks/woocommerce-end-to-end.md`
- `docs/tasks/patches/woocommerce-commerce-migration.sql`
- `packages/connectors/src/woocommerce/woocommerce-rest-client.js`
- `packages/connectors/src/woocommerce/d1-woocommerce-commerce-store.js`
- `packages/connectors/src/woocommerce/d1-woocommerce-report-source.js`
- `packages/application/src/commerce/woocommerce-commerce-model.js`
- `packages/application/src/commerce/generate-woocommerce-commerce-report.js`
- `packages/application/src/use-cases/sync-woocommerce-commerce.js`
- five focused files under `tests/woocommerce/`

No reserved shared file was modified.

## Verification evidence

Branch Verification run `541` on code head `987c845d494e1d83531f0b95b2386777ca8900ce`:

```text
npm ci                                      PASS
npm run check                               PASS
npm test                                    PASS — 885/885
WooCommerce-focused subtests in npm test    PASS — 15/15
npm run test:report-reliability             PASS — 91/91
npm audit --audit-level=high                 PASS — 0 vulnerabilities
npm run deploy:dry-run                       PASS
```

The repository workflow does not expose a separate WooCommerce-only command step; the 15 Workstream subtests ran and passed inside the full Node test suite. `npm run check` supplied repository syntax/architecture/hygiene validation. Integration Review may rerun `node --test tests/woocommerce/*.test.js` and `git diff --check` locally as an additional operator gate.

## Remote actions explicitly not performed

- no Customer Production Consumer Key/Secret
- no WordPress or WooCommerce change
- no Plugin installation
- no Worker deployment
- no Remote D1 migration/query
- no Queue message
- no Remote Lark schema/record change
- no Cron/Schedule enablement
- no Production/Customer LIVE UAT
- no secret/Cloudflare configuration change
- no merge

## Integration Chat follow-up

After review/approval, Integration Chat must:

1. re-audit current `main`, open PRs and current migration sequence;
2. review the migration proposal and allocate the then-current next migration number after `0016` or later;
3. add D1 Commerce store/report source construction to reserved runtime infrastructure;
4. route the existing WooCommerce Job while Connector/write flags remain disabled;
5. allocate shared Lark table registry IDs and create/apply approved Lark schema separately;
6. add disabled Wrangler examples and customer-owned secrets;
7. define deterministic rehydration of the same incremental/full-reconciliation scope for reference-only continuations;
8. run local/Remote migration verification only in the Integration workflow;
9. perform credential preflight and Customer LIVE UAT under a separate approved task;
10. add schedule only after separate explicit approval.

## Implementation result

```text
RESULT                          = PASS_FOR_INTEGRATION_REVIEW
DRAFT_PR                        = OPEN
REMOTE_STATE                    = UNCHANGED
MERGE                           = BLOCKED_PENDING_REVIEW
```
