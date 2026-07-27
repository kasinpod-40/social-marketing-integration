# WooCommerce End-to-End Integration

## Authoritative status

```text
TASK_STATUS                         = PASS_FOR_INTEGRATION
WORKSTREAM                          = WOOCOMMERCE_END_TO_END
BRANCH                              = agent/woocommerce-end-to-end
DRAFT_PR                            = #66
AUDITED_BRANCH_CREATION_SHA         = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
CURRENT_MAIN_ALIGNED_SHA            = 6158a8b1381d62539274a7fa77d7860bdbee624a
ALIGNMENT_PR                        = #87 / MERGED_INTO_FEATURE_BRANCH_ONLY
ALIGNED_CODE_HEAD                   = 27327758e0d80b665bacd21d3d5da505d6c465d3
ALIGNED_CODE_VERIFICATION           = #601 / PASS
LATEST_SHARED_MIGRATION_SEEN        = 0016
REMOTE_D1_MIGRATION                 = NOT_APPLIED
WORKER_DEPLOYMENT                   = NONE
QUEUE_MESSAGE                       = NONE
REMOTE_LARK_MUTATION                = NONE
SCHEDULE                            = DISABLED
LIVE_UAT                            = NOT_AUTHORIZED
PRODUCTION                          = BLOCKED
MERGE_INTO_MAIN                     = NOT_PERFORMED
```

This Workstream stops at a reviewed Draft PR. Integration owns migration numbering/application,
reserved runtime routing, shared Lark table registration, deployment and Customer validation.
PR `#87` merged current `main` into this feature Branch only; it did not merge WooCommerce into
`main`.

## Repository and Shared Core audit

The Workstream read and reviewed `AGENTS.md`, `docs/current-task.md`, `PROJECT_BRAIN.md`,
`README.md`, the Storage Architecture contract, Connector/Job catalogs, Customer profiles,
`D1ResumableWorkStore`, Shared Coverage storage, `TableSyncEngine`, Worker Reliability/lock/
Queue/DLQ boundaries and existing D1-first/Lark-repair patterns.

Confirmed:

- existing WooCommerce Connector/Job identities remain planned and disabled;
- Shared Reliability, distributed lock, generation fence, Queue retry/DLQ, Coverage and Lark
  engines are reused;
- no duplicate Reliability engine, Queue framework, shared D1 writer or Lark engine was added;
- no reserved shared runtime/config/catalog file is modified by PR `#66`;
- Shared Coverage tables remain `data_coverage_runs` and `data_coverage_entities` from Migration
  `0009`;
- Commerce storage is supplied as an unnumbered additive proposal outside `migrations/`;
- Integration must allocate the then-current migration number after `0016` or later.

## Source contract

### Authentication and transport

- REST base path: `/wp-json/wc/v3`.
- HTTPS is mandatory.
- Consumer Key/Secret are transmitted only through HTTP Basic `Authorization`.
- URL/query-string credentials are rejected.
- Secrets never enter Queue messages, D1/Lark rows, logs or operational details.
- Customer validation must use customer-owned read-only credentials.

### Pagination and incremental scope

- collections use sequential 1-based `page` pagination;
- `per_page` is bounded to `1..100`;
- `X-WP-Total` and `X-WP-TotalPages` are reconciliation evidence;
- Refund and Variation subresources use bounded pages and concurrency;
- Orders and Products use `modified_after`, `dates_are_gmt=true`, `orderby=modified`,
  `order=asc` for incremental runs;
- full reconciliation omits `modified_after`;
- continuation Queue messages remain reference-only.

The immutable execution scope is durably saved before the first Provider read. Continuations
rehydrate the same full/incremental mode, overlap boundary, page size, reporting timezone,
Store currency and nested bounds even if later runtime inputs differ.

### Error classes

| Condition | Classification |
| --- | --- |
| `401`, `403` | permanent credential/permission failure |
| `404` | permanent endpoint/version mismatch |
| invalid config/request/Source contract | permanent |
| network, `408`, `425`, `429`, `5xx` | transient/retryable |
| invalid JSON or identity mismatch | permanent unless truncation evidence proves otherwise |

`Retry-After` is retained when provided.

## Data model

Money is parsed without floating-point arithmetic and stored as exact signed integer micros:

```text
1 currency unit = 1,000,000 micros
```

ISO currency is retained on every monetary fact and currencies are never summed together.
Store identity supplies the authoritative default currency and reporting timezone for Product,
Customer and Coupon normalization during the same durable generation.

### RAW tables

| Table | Stable key | Grain |
| --- | --- | --- |
| `raw_commerce_stores` | `woocommerce:account_key` | sanitized Store identity |
| `raw_commerce_orders` | `woocommerce:account_key:order_id` | current sanitized Order |
| `raw_commerce_order_items` | `order_key:line_item_id` | Order line |
| `raw_commerce_products` | `woocommerce:account_key:product_id` | Product |
| `raw_commerce_product_variations` | `woocommerce:account_key:product_id:variation_id` | Variation |
| `raw_commerce_categories` | `woocommerce:account_key:category_id` | Category |
| `raw_commerce_customers` | `woocommerce:account_key:customer:customer_id` | minimized Customer |
| `raw_commerce_coupons` | `woocommerce:account_key:coupon_id` | Coupon with hashed code |
| `raw_commerce_refunds` | `order_key:refund_id` | Refund / partial refund |

### Canonical and daily tables

| Table | Stable key | Grain |
| --- | --- | --- |
| `commerce_store_state` | `woocommerce:account_key` | Store state |
| `commerce_order_state` | `woocommerce:account_key:order_id` | current Order economics |
| `commerce_order_status_observations` | `order_key:status:source_modified_at` | status history |
| `commerce_order_line_facts` | `order_key:line_item_id` | line economics |
| `commerce_product_state` | `woocommerce:account_key:product_id[:variation_id]` | Product state |
| `commerce_customer_aggregates` | `woocommerce:account_key:registered:customer_id:currency` | Customer/currency |
| `commerce_daily_sales_facts` | `woocommerce:account_key:metric_date:currency` | Store/date/currency |
| `commerce_product_daily_facts` | `product_key:metric_date:currency` | Product/date/currency |

The proposal contains 17 additive Commerce tables and fails closed until all are present.

## Metrics and privacy

```text
gross_sales_micros       = SUM(line subtotal + line subtotal tax)
discount_micros          = order discount total + order discount tax
refund_micros            = absolute SUM(detailed refund total)
net_sales_micros         = gross sales - discount - refund
shipping_micros          = shipping total + shipping tax
tax_micros               = order total tax
recognized_revenue_micros = order total - refund
```

Recognized statuses are `processing`, `completed`, `refunded`; provisional statuses are
`pending`, `on-hold`; cancelled/trash and failed have zero recognized count/revenue. Partial
refunds preserve exact amounts and line quantities when detail exists. Multiple shipping methods
are represented by one deterministic composite bucket to avoid double counting.

Never persisted or emitted to Lark: names, email, phone, address/postcode/exact location, IP,
user-agent, payment secrets/tokens, passwords/session data, free-form notes, refund reason text,
unrestricted metadata or raw Coupon codes. Registered identity is limited to numeric WooCommerce
Customer ID. Guest checkout creates no email/phone-derived cross-Order identity.

## Reliability and correction semantics

Page order remains:

```text
validate Source and Lark targets
→ plan direct Lark rows
→ D1 RAW/Canonical mutation
→ rebuild/read D1-derived facts
→ plan/execute existing TableSyncEngine
→ save Shared Coverage and durable checkpoint
```

Corrections added during Integration Review:

1. Durable immutable Source scope is saved before Provider reads and reused by continuation.
2. Store currency/timezone is propagated throughout the generation.
3. Current Order/Product/Customer state is source-revision gated; stale replay cannot roll back
   newer state.
4. An accepted newer Order revision transactionally replaces its complete line-item set, so
   removed lines and stale Product Daily groups do not remain.
5. Daily status is `partial`/`revisable` until completed Coverage supports finalization.
6. Reports require completed Shared `data_coverage_runs` evidence before claiming `complete` or
   `no_data_confirmed`.
7. Product/Order report bounds read `LIMIT + 1`; overflow fails closed without silent truncation,
   while exactly-at-limit results remain valid.
8. Incremental Coverage never claims full-inventory completeness and never deletes unseen
   entities.

## Lark targets and disabled flags

Integration must allocate actual table IDs for:

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

All proposed defaults remain false:

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED=false
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED=false
MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false
```

Proposed Integration-managed inputs:

```text
WOOCOMMERCE_BASE_URL
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
WOOCOMMERCE_API_VERSION=wc/v3
WOOCOMMERCE_PAGE_SIZE=100
WOOCOMMERCE_INCREMENTAL_OVERLAP_SECONDS=300
```

## Files changed by PR #66

- `docs/tasks/woocommerce-end-to-end.md`
- `docs/tasks/patches/woocommerce-commerce-migration.sql`
- `packages/connectors/src/woocommerce/woocommerce-rest-client.js`
- `packages/connectors/src/woocommerce/d1-woocommerce-commerce-store.js`
- `packages/connectors/src/woocommerce/d1-woocommerce-report-source.js`
- `packages/application/src/commerce/woocommerce-commerce-model.js`
- `packages/application/src/commerce/generate-woocommerce-commerce-report.js`
- `packages/application/src/use-cases/sync-woocommerce-commerce.js`
- six focused files under `tests/woocommerce/`

No reserved Shared file is part of the PR diff.

## Verification evidence

Aligned code head `27327758e0d80b665bacd21d3d5da505d6c465d3` passed Branch Verification
`#601` / run ID `30242911767` against current `main`:

```text
Install locked dependencies          PASS
Syntax / architecture / hygiene      PASS
Focused staged TikTok regression     PASS
Node Unit / Integration tests        PASS
Workers runtime tests                PASS
Report reliability regression        PASS
Dependency audit                     PASS
Wrangler deployment dry-run          PASS / no deployment
Diagnostics upload                   PASS
```

The workflow executes all WooCommerce tests through the full Node suite. The connected workflow
does not expose standalone steps for literal `node --test tests/woocommerce/*.test.js` or
`git diff --check`; `npm run check` supplies repository syntax/architecture/hygiene validation.
Those literal commands remain optional local operator evidence and are not falsely recorded as
separately executed here.

## Remote safe state

No Workstream, review-fix or alignment action performed any of the following:

- Customer Production Consumer Key/Secret use;
- WordPress/WooCommerce or Plugin change;
- Worker deployment;
- Remote D1 migration/query or Business mutation;
- Queue message or DLQ action;
- Remote Lark schema/record mutation;
- Cron/Schedule enablement;
- Customer/Production LIVE UAT;
- Production Secret or Cloudflare configuration change;
- merge of PR `#66` into `main`.

## Integration follow-up

After a separately approved Integration task:

1. re-audit current `main`, open PRs and migration sequence;
2. allocate the then-current migration number after `0016` or later;
3. wire the reviewed D1 Store/report source through reserved runtime infrastructure;
4. route the existing WooCommerce Job with every flag still false;
5. allocate Shared Lark table IDs and apply approved schema separately;
6. add disabled examples and customer-owned Secrets;
7. verify local/Remote migration additivity under separate authorization;
8. perform read-only credential preflight and controlled Customer validation separately;
9. add Schedule only after explicit approval.

## Integration Review decision

```text
RESULT                              = PASS_FOR_INTEGRATION
DRAFT_PR                            = OPEN / DRAFT
REMOTE_STATE                        = UNCHANGED
MERGE_INTO_MAIN                     = BLOCKED_PENDING_SEPARATE_APPROVAL
```
