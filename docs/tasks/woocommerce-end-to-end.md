# WooCommerce End-to-End Integration

## Workstream authority

```text
TASK_STATUS                     = IMPLEMENTATION_IN_PROGRESS
WORKSTREAM                      = WOOCOMMERCE_END_TO_END
BRANCH                          = agent/woocommerce-end-to-end
BASE_SHA                        = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
REMOTE_D1_MIGRATION             = NOT_APPLIED
WORKER_DEPLOYMENT               = NONE
QUEUE_MESSAGE                   = NONE
REMOTE_LARK_MUTATION            = NONE
SCHEDULE                        = DISABLED
LIVE_UAT                        = NOT_AUTHORIZED
PRODUCTION                      = BLOCKED
```

This workstream implements isolated WooCommerce source, normalization, D1 repository, reporting and Lark-row modules. Integration into reserved shared files remains a later Integration Chat action.

## Repository audit

Reviewed before coding:

- `AGENTS.md`
- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `README.md`
- `package.json`
- Storage Architecture v1
- Connector and Job catalogs
- Customer profiles
- D1 Marketing History store
- `TableSyncEngine`
- Sync Worker runtime infrastructure
- Google Ads staged D1-first/Lark continuation pattern
- open Draft PRs `#17` and `#11`
- latest additive migration `0014_google_ads_signing_secret_provisioning.sql`

### Audit conclusions

- WooCommerce Connector and Job keys already exist and remain `planned`.
- `MKT_CONNECTOR_WOOCOMMERCE_ENABLED` already defaults to disabled through the Connector catalog/profile contract.
- Reliability, distributed locks, generation fences, Queue/DLQ, resumable work, D1 write conventions, Coverage and `TableSyncEngine` already exist and must be injected into this workstream rather than recreated.
- `apps/sync-worker/src/*`, Job Catalog, Connector Catalog, customer profiles, root package files, Wrangler files, migration numbering and the shared Lark table registry are reserved for Integration Chat.
- Current D1 Storage v1 has Organic and Ads facts but no Commerce tables. Commerce needs an additive migration proposal; this branch does not allocate a migration number or apply it.

## Objective

Read WooCommerce data through the authenticated WC REST API, preserve raw lineage, normalize it into a privacy-minimized Canonical commerce model, write idempotently to D1, calculate deterministic daily/report outputs and generate Lark rows for the existing `TableSyncEngine`.

## Source contract

### API and authentication

- Base path: `/wp-json/wc/v3`.
- HTTPS only.
- HTTP Basic Authentication using Consumer Key as username and Consumer Secret as password.
- Secrets are injected at runtime and never written to Source, logs, D1 or Lark.
- Query-string authentication is intentionally unsupported because URLs are more likely to leak through logs/proxies.
- Read-only API keys are required for UAT/Production.

### Pagination

- Sequential `page` pagination, 1-based.
- `per_page` is bounded to `1..100`.
- Prefer `X-WP-Total` and `X-WP-TotalPages`; Link headers are accepted as supplementary evidence.
- Every page records expected/observed counts and a source watermark.
- Page fetches are retry-safe; D1/Lark writes use Stable keys.

### Incremental sync

- Orders and Products use `modified_after`, `dates_are_gmt=true`, `orderby=modified`, `order=asc`.
- A configurable overlap window re-reads recently modified rows to capture late order changes, refunds and status transitions.
- Full reconciliation omits `modified_after` and verifies all pages.
- Categories, Coupons and Customers use full or bounded changed-source reads according to endpoint capability and retained checkpoint.
- Variations are read per changed variable product with bounded concurrency.
- Refund detail is read per changed order when refund summaries indicate refunds.

### Error classification

- `401/403`: permanent credential/permission error.
- `404`: permanent endpoint/route mismatch.
- `400/422`: permanent source-contract error unless a documented transient provider code is present.
- `408/425/429/5xx` and network failures: transient; preserve `Retry-After` when present.
- Invalid JSON or identity mismatch: permanent unless evidence indicates a truncated transient response.

## Data model

All money fields use signed integer micros (`1 currency unit = 1,000,000 micros`) plus the original ISO currency. Decimal API strings are parsed without floating-point arithmetic.

### RAW tables

| Table | Grain / primary key | Purpose |
| --- | --- | --- |
| `raw_commerce_stores` | `store_key` | Sanitized Store identity and API/version evidence |
| `raw_commerce_orders` | `raw_order_key = woocommerce:account_key:order_id` | Source Order payload without PII |
| `raw_commerce_order_items` | `raw_order_item_key = raw_order_key:line_item_id` | Order line items |
| `raw_commerce_products` | `raw_product_key = woocommerce:account_key:product_id` | Product source state |
| `raw_commerce_product_variations` | `raw_variation_key = raw_product_key:variation_id` | Variation source state |
| `raw_commerce_categories` | `raw_category_key = woocommerce:account_key:category_id` | Category source state |
| `raw_commerce_customers` | `raw_customer_key = woocommerce:account_key:customer_id` | PII-minimized customer source state |
| `raw_commerce_coupons` | `raw_coupon_key = woocommerce:account_key:coupon_id` | Coupon source state; code may be hashed for customer-facing outputs |
| `raw_commerce_refunds` | `raw_refund_key = raw_order_key:refund_id` | Refund and partial-refund facts |

RAW rows keep selected source fields plus `source_payload_hash`, `source_modified_at`, `fetched_at`, `sync_run_id` and `coverage_run_id`. They do not store billing/shipping names, email, phone, addresses, IP, user-agent, payment tokens or free-form customer notes.

### Canonical commerce tables

| Table | Primary/idempotency key | Grain |
| --- | --- | --- |
| `commerce_store_state` | `store_key` | Store current state |
| `commerce_order_state` | `order_key = woocommerce:account_key:order_id` | Current Order state |
| `commerce_order_status_observations` | `status_observation_key = order_key:status:source_modified_at` | Source-supported observed status history |
| `commerce_order_line_facts` | `order_line_key = order_key:line_item_id` | Current line economics and product identity |
| `commerce_product_state` | `product_key = woocommerce:account_key:product_id[:variation_id]` | Product/variation current state |
| `commerce_customer_aggregates` | `customer_aggregate_key = woocommerce:account_key:registered:customer_id` | Registered-customer aggregate without PII |

Guest checkout is represented as `customer_type=guest`; no cross-order guest identity is created by default. A guest Order uses `guest_order_key = order_key`, preventing email-derived tracking.

### Daily snapshot/fact tables

| Table | Primary/idempotency key | Grain |
| --- | --- | --- |
| `commerce_daily_sales_facts` | `commerce_daily_key = woocommerce:account_key:metric_date:currency` | Store × local date × currency |
| `commerce_product_daily_facts` | `product_daily_key = product_key:metric_date:currency` | Product/variation × local date × currency |

Daily rows are revision-safe. A late status/refund update recalculates and upserts the original Order date rather than appending a duplicate.

## Metric definitions

### Order values

```text
gross_sales_micros
  = SUM(line_item.subtotal + line_item.subtotal_tax)

discount_micros
  = order.discount_total + order.discount_tax

refund_micros
  = absolute SUM(refund.total) with detailed line/tax evidence retained when available

net_sales_micros
  = gross_sales_micros - discount_micros - refund_micros

shipping_micros
  = order.shipping_total + order.shipping_tax

tax_micros
  = order.total_tax

recognized_revenue_micros
  = order.total - refund_micros
```

- `cancelled`, `failed` and `trash` Orders contribute zero recognized Order count/revenue.
- `pending` and `on-hold` are tracked separately as provisional.
- `processing` and `completed` are recognized.
- `refunded` and partial refunds subtract the exact refund amount.
- Negative corrections are preserved; missing values remain `null` where Source evidence is absent.
- Currency values are never summed across currencies.

### Product performance

- quantity ordered
- gross item sales
- discounts allocated from line subtotal vs total
- refunds and refunded quantity when refund line items identify the product
- net item sales
- order count
- unique registered-customer count when Source supports it without PII

### Payment/shipping summaries

Aggregates use stable provider IDs and sanitized labels:

- `payment_method_id`, `payment_method_title`
- `shipping_method_id`, `shipping_method_title`
- order count, recognized revenue, refund amount

No payment token, card data or gateway response is stored.

## PII minimization

Never store or emit to Lark:

- billing/shipping first/last name
- company when it can identify a person
- email
- phone
- street address, postcode or exact location
- customer IP address
- user-agent
- payment token or transaction secret
- password/reset/session data
- free-form customer note
- raw metadata unless explicitly allowlisted

Allowed customer fields:

- numeric WooCommerce customer ID
- registered/guest type
- created/modified timestamps
- order count
- total spend micros by currency
- country only if a later approved privacy review explicitly enables it; default is omitted

## Lark targets

Proposed logical table keys for the shared registry (Integration Chat must allocate actual IDs):

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

Rows use the same snake_case Stable-key fields as D1. The workstream calls existing `TableSyncEngine.planByKey()` and `executePlan()` only; it does not create a Lark sync engine.

## Reliability and execution contract

- The caller owns Shared Reliability Runner, distributed lock, lock renewal, generation fence, Queue retry and DLQ classification.
- The WooCommerce use case owns source pagination, normalization, D1-first ordering, per-page durable checkpoints, Coverage and reconciliation.
- Page write order:

```text
source page validation
→ Lark destination preflight for that page
→ D1 RAW + Canonical + Daily idempotent upserts
→ Lark TableSyncEngine execution
→ durable page completion
```

- D1 failure causes zero Lark writes.
- Lark failure after D1 success is retryable; D1 replays idempotently and Lark repairs.
- Continuations carry reference/checkpoint identity only, never WooCommerce payload or credentials.
- Full reconciliation records expected pages/entities/rows.
- Incremental runs are marked `modified_window`; they cannot claim full-inventory completeness.

## Runtime flags

All proposed flags default to `false`:

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

Secrets/config proposed for Integration Chat:

```text
WOOCOMMERCE_BASE_URL
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
WOOCOMMERCE_API_VERSION=wc/v3
WOOCOMMERCE_PAGE_SIZE=100
WOOCOMMERCE_INCREMENTAL_OVERLAP_SECONDS=300
```

## Reserved-file integration proposal

This branch must not directly edit the following. Integration Chat should later apply a reviewed patch that:

1. adds the additive Commerce migration after current `0014` using the then-current next number;
2. adds D1 Commerce store construction to runtime infrastructure;
3. adds WooCommerce Job routing while retaining `planned` or `uat_pending` until UAT approval;
4. adds logical Lark table IDs to the shared registry;
5. adds disabled example flags/secrets to Wrangler examples;
6. adds an explicit schedule entry only after a separately approved schedule task;
7. updates shared docs after merge.

## Acceptance criteria

- Source client authenticates with Basic Auth over HTTPS and redacts credentials.
- Pagination is bounded, deterministic and follows total-page evidence.
- Incremental Orders/Products use `modified_after` with overlap.
- Late changes, statuses and partial refunds revise Stable rows idempotently.
- Money parsing is exact and currency-preserving.
- PII fields are excluded by tests.
- Guest checkout creates no cross-order email-derived identity.
- D1 writes are allowlisted and idempotent.
- D1 precedes Lark; retry repairs partial Lark progress.
- Coverage distinguishes full inventory from modified window.
- Daily sales/product facts and reports are deterministic.
- All Connector/schedule/write flags remain false by default.
- No Remote D1/Lark/Queue/Deploy/Production action occurs.

## Required verification

```bash
npm ci
npm run check
npm test
node --test tests/woocommerce/*.test.js
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Pending.