# Google Ads Signed Delivery — Customer-real UAT on Existing DEV

## Purpose

Validate the signed Manager Script → API Worker → D1 → Queue → Sync Worker → Lark flow for Chemistry K while keeping Google Ads read-only and every business schedule disabled.

**Topology lock:** UAT uses the current developer DEV Worker, D1, Queue, DLQ, secret store and Lark Base. Do not create, rename or separate UAT infrastructure. Change only the logical runtime profile/source account/data required for Chemistry K.

This runbook does not authorize Production rollout.

## Preconditions

- Google Ads manager `946-357-0541` can select advertiser `566-233-2033`.
- The exact read-only Manager Script source is reviewed against `scripts/google-ads-manager-script-signed-delivery.js`.
- Existing DEV API Worker, Sync Worker, D1, Queue, DLQ and `Social MKT Data Hub` Base are the approved UAT target.
- Lark schema Apply is complete. Do not rerun Formula, View or schema work.
- No Google Ads schedule exists.
- Existing developer-test execution for Google Ads is stopped before switching to Chemistry K customer data.
- Operators can inspect D1/Queue/DLQ/Lark evidence without exposing credentials or raw signed bodies.

## Configuration names

### Existing DEV API Worker

Keep the existing DEV bindings/resources. Set only the logical profile and connector state needed for the UAT window:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=uat_chemistry_k
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=true
MKT_GOOGLE_ADS_SIGNING_KEY_ID=<DEV/UAT key id>
MKT_STATE_DB=<existing DEV D1 binding>
MKT_SYNC_QUEUE=<existing DEV Queue producer binding>
```

Secrets in the existing DEV secret store:

```text
MKT_GOOGLE_ADS_SIGNING_SECRET
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET   # only during rotation
```

Optional non-secret rotation variable:

```text
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID
```

### Existing DEV Sync Worker

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=uat_chemistry_k
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=true
MKT_STATE_DB=<same existing DEV D1>
MKT_SYNC_QUEUE=<same existing DEV Queue/DLQ bindings>
LARK_APP_ID=<existing DEV app identity>
LARK_BASE_APP_TOKEN=<existing DEV Base>
LARK_TABLE_RAW_GOOGLE_ADS_ACCOUNTS
LARK_TABLE_RAW_GOOGLE_ADS_CAMPAIGNS
LARK_TABLE_RAW_GOOGLE_ADS_AD_GROUPS
LARK_TABLE_RAW_GOOGLE_ADS_ADS
LARK_TABLE_RAW_GOOGLE_ADS_ASSETS
LARK_TABLE_RAW_GOOGLE_ADS_DAILY
LARK_TABLE_MKT_ADS_ACCOUNTS
LARK_TABLE_MKT_ADS_CAMPAIGNS
LARK_TABLE_MKT_ADS_AD_GROUPS
LARK_TABLE_MKT_ADS_ADS
LARK_TABLE_MKT_ADS_CREATIVES
LARK_TABLE_MKT_ADS_DAILY
LARK_TABLE_MKT_SYNC_LOG
LARK_TABLE_MKT_SYSTEM_ALERTS
```

Do not change existing table IDs merely for UAT. Lark credentials are secrets and must remain in the environment secret store.

### Manager Script Properties

```text
MKT_GOOGLE_ADS_DELIVERY_URL
MKT_GOOGLE_ADS_SIGNING_KEY_ID
MKT_GOOGLE_ADS_SIGNING_SECRET
```

The URL is the existing DEV API Worker URL and must be exact HTTPS with no query string, ending at `/v1/google-ads/deliveries`.

## Step 1 — Existing DEV preflight

1. Confirm branch checks pass: `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --audit-level=high`, `npm run deploy:dry-run`.
2. Confirm `scripts/google-ads-manager-script-signed-delivery.js` still has `EXECUTION_MODE: 'DRY_RUN'`.
3. Search the Script for mutation/schedule APIs; expected result is none.
4. Confirm no Google Ads schedule flag or cron exists.
5. Record the current DEV Worker versions, D1 database, Queue/DLQ names, Base token identity and active profile without printing secrets.
6. Stop any developer-test Google Ads execution and confirm the connector flag is currently disabled.
7. Back up the existing DEV D1 before migration.
8. Apply `migrations/0009_google_ads_signed_delivery.sql` to the existing DEV D1.
9. Verify `google_ads_delivery_nonces` and `google_ads_deliveries` plus their indexes exist.
10. Set the signing secret in the existing DEV secret store.
11. Set `MKT_ENV=development`, `MKT_CUSTOMER_PROFILE=uat_chemistry_k` and enable Google Ads only for the manual UAT window.
12. Deploy the approved API/Sync Worker code to the existing DEV Workers.
13. Confirm Production and all unrelated connectors/schedules remain unchanged.

## Step 2 — Manager Script `DRY_RUN`

1. Copy the reviewed Script source into `Social MKT Google Ads Daily Export DEV` under manager `946-357-0541`.
2. Leave `EXECUTION_MODE` as `DRY_RUN`.
3. Run Preview in Google Ads Scripts.
4. Confirm exact account selection resolves only `566-233-2033`.
5. Confirm output shows schema `google_ads_signed_delivery_v1`, six dataset counts and `externalDelivery: false` without raw payload or credential.
6. Confirm Google Ads reports `No changes`.
7. Confirm API Worker, D1 delivery tables, Queue, DLQ and Lark have no delivery activity from this run.

Stop immediately if account selection is missing, ambiguous or mismatched.

## Step 3 — Signed `PREVIEW`

1. Set Script Properties with the existing DEV URL/key ID/secret.
2. Change only `EXECUTION_MODE` to `PREVIEW`.
3. Run the Script manually once.
4. Expected HTTP result: `200`, `status=preview_validated`, with six dataset counts.
5. Verify D1 contains a terminal `preview_validated` row whose `payload_json` is `{}`.
6. Verify no Queue message, DLQ record or Lark business record write occurred.
7. Confirm logs contain no signature, secret, nonce, raw body or unapproved customer display data.

## Step 4 — Negative security checks

Run the automated focused suite against the exact DEV build. It must prove valid/invalid signature, tampering, missing/duplicate headers, query-string rejection, timestamp expiry, nonce replay, identity mismatch, unknown fields, count/order/duplicate/relation failures.

Do not mutate the real Google Ads account to perform negative tests.

## Step 5 — Manual one-shot `LIVE`

1. Confirm every schedule remains absent/disabled.
2. Capture pre-run row counts and stable-key duplicate counts for the 12 destination tables in the existing DEV Base.
3. Change only `EXECUTION_MODE` to `LIVE`.
4. Run the Script manually once.
5. Restore `EXECUTION_MODE` to `DRY_RUN` immediately after acceptance.
6. Verify API response is `202 queued` or an idempotent accepted state.
7. Verify Queue body contains only schema version, job type, delivery ID and requested timestamp.
8. Verify D1 progresses through `queued`/`processing` to `completed`.
9. Verify the shared reliability run acquires/releases its distributed lock.
10. Verify Sync Log/reliability mirror records success without raw payload or secret.
11. Verify all 12 plans succeeded before the first write and each result satisfies `created + updated + skipped = expected`, `duplicateInputRows = 0`.
12. Verify Google Ads still reports no changes and no Campaign/Ad/budget/billing mutation.

## Step 6 — Idempotency and reconciliation

1. Replay the exact saved LIVE body/delivery ID with a fresh timestamp/nonce/signature inside retention.
2. Expect an idempotent accepted result and no second Queue message for queued/processing/completed state.
3. Run a fresh Script collection with a new delivery ID.
4. Verify destination stable keys produce updates/skips rather than duplicates.
5. Recount duplicates in all 12 tables; expected zero.
6. Compare the exact date range/account timezone against Google Ads UI totals for spend, impressions, clicks and video views.
7. Verify omitted/unsupported values remain `null` and explicit source zero remains `0`.

## Step 7 — Retry, lock, DLQ and redrive

Use controlled DEV fault injection or test doubles; do not corrupt Production or unrelated DEV connector state.

1. Simulate transient D1/Lark/Queue failure and verify retry classification/backoff.
2. Verify the same delivery resumes without duplicate writes.
3. Run two concurrent copies and verify only one distributed lock holder writes.
4. Simulate a permanent schema/reconciliation failure.
5. Verify delivery state becomes `failed_permanent` before DLQ persistence.
6. Verify the payload remains usable only inside the seven-day window.
7. Perform one controlled redrive and confirm idempotent recovery or the same permanent rejection.
8. Verify post-expiry access redacts payload and blocks redrive.
9. Verify terminal audit cleanup eligibility after 30 days remains activity-driven; no cleanup schedule is added.

## Step 8 — Restore normal DEV safety state

1. Set `MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false` after the UAT evidence is captured.
2. Keep the Manager Script at `DRY_RUN`.
3. Keep `MKT_ENV=development` and restore `MKT_CUSTOMER_PROFILE=dev_ft_pumkin` only when returning to developer-test data.
4. Do not run developer-test and Chemistry K Google Ads source modes concurrently.
5. Do not remove customer UAT rows blindly; use stable-key/reconciliation evidence and the agreed retention procedure.

## UAT decision

Pass only when exact selection, signed PREVIEW, negative security/replay, one-shot LIVE, 12-table reconciliation, zero-duplicate rerun, retry/lock/DLQ/redrive, zero Google Ads mutation, cross-connector regression, schedule-disabled state and no secret/raw-body leakage all pass.

Record evidence in `docs/current-task.md`. Do not mark Production ready from source tests alone.

## Rollback

1. Set `MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false` on the existing DEV API/Sync Workers.
2. Restore the Manager Script to `DRY_RUN` or stop manual invocation.
3. Stop manual delivery calls and pause/drain only the affected existing DEV Queue messages as appropriate.
4. Deploy the prior known-good DEV Worker commit.
5. Preserve D1/DLQ evidence through investigation/retention.
6. Restore `MKT_CUSTOMER_PROFILE=dev_ft_pumkin` only when intentionally returning to developer-test source data.
7. Do not reverse Lark schema, Formula or Views; this task did not change them.
8. Reconcile partial rows by delivery/stable-key evidence; do not bulk-delete blindly.
9. Removing delivery tables or customer UAT records requires a separately reviewed cleanup/migration task.
