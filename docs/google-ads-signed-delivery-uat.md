# Google Ads Signed Delivery — Isolated UAT Runbook

## Purpose

Validate the signed Manager Script → API Worker → D1 → Queue → Sync Worker → Lark flow for Chemistry K while keeping Google Ads read-only and keeping every business schedule disabled.

This runbook does not authorize Production rollout.

## Preconditions

- Google Ads manager `946-357-0541` can select advertiser `566-233-2033`.
- The exact read-only Manager Script source is reviewed against `scripts/google-ads-manager-script-signed-delivery.js`.
- Isolated `uat_chemistry_k` Worker, D1, Queue, DLQ and Lark resources exist and are not shared with DEV or Production.
- Lark schema Apply is already complete. Do not rerun Formula, View or schema work.
- No Google Ads schedule exists.
- UAT operators can inspect D1/Queue/DLQ/Lark evidence without exposing credentials or raw signed bodies.

## Configuration names

### API Worker

Non-secret variables/bindings:

```text
MKT_ENV=uat
MKT_CUSTOMER_PROFILE=uat_chemistry_k
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=true
MKT_GOOGLE_ADS_SIGNING_KEY_ID=<UAT key id>
MKT_STATE_DB=<isolated UAT D1 binding>
MKT_SYNC_QUEUE=<isolated UAT Queue producer binding>
```

Secrets:

```text
MKT_GOOGLE_ADS_SIGNING_SECRET
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET   # only during rotation
```

Optional non-secret rotation variable:

```text
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID
```

### Sync Worker

```text
MKT_ENV=uat
MKT_CUSTOMER_PROFILE=uat_chemistry_k
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=true
MKT_STATE_DB=<same isolated UAT D1>
MKT_SYNC_QUEUE=<isolated UAT Queue/DLQ bindings>
LARK_APP_ID=<UAT app identity>
LARK_BASE_APP_TOKEN=<isolated UAT Base>
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

Lark credentials are secrets and must use the environment secret store. Never paste values into Git, Lark records, logs or this document.

### Manager Script Properties

```text
MKT_GOOGLE_ADS_DELIVERY_URL
MKT_GOOGLE_ADS_SIGNING_KEY_ID
MKT_GOOGLE_ADS_SIGNING_SECRET
```

The URL must be exact HTTPS with no query string and end at `/v1/google-ads/deliveries`.

## Step 1 — Source and deployment preflight

1. Confirm branch checks pass: `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --audit-level=high`, `npm run deploy:dry-run`.
2. Confirm `scripts/google-ads-manager-script-signed-delivery.js` still has `EXECUTION_MODE: 'DRY_RUN'`.
3. Search the Script for mutation/schedule APIs; expected result is none.
4. Confirm `wrangler` examples contain no Google Ads schedule flag or cron.
5. Apply `migrations/0009_google_ads_signed_delivery.sql` to the isolated UAT D1 only.
6. Verify both tables and indexes exist:
   - `google_ads_delivery_nonces`;
   - `google_ads_deliveries`.
7. Set the UAT secrets through the secret store. Do not print or read them back into logs.
8. Deploy API and Sync Workers to isolated UAT with the Google Ads connector flag enabled only in UAT.
9. Verify no Production deployment and no Production traffic change occurred.

## Step 2 — Manager Script `DRY_RUN`

1. Copy the reviewed Script source into `Social MKT Google Ads Daily Export DEV` under manager `946-357-0541`.
2. Leave `EXECUTION_MODE` as `DRY_RUN`.
3. Run Preview in Google Ads Scripts.
4. Confirm exact account selection resolves only `566-233-2033`.
5. Confirm output shows:
   - schema `google_ads_signed_delivery_v1`;
   - six dataset counts;
   - `externalDelivery: false`;
   - no raw payload or credential.
6. Confirm Google Ads reports `No changes`.
7. Confirm API Worker, D1, Queue, DLQ and Lark have no delivery activity from this run.

Stop immediately if account selection is missing, ambiguous or mismatched.

## Step 3 — Signed `PREVIEW`

1. Set Script Properties with UAT URL/key ID/secret.
2. Change only `EXECUTION_MODE` to `PREVIEW`.
3. Run the Script manually once.
4. Expected HTTP result: `200` with `status=preview_validated` and the six dataset counts.
5. Verify D1 contains a terminal `preview_validated` audit row whose `payload_json` is `{}`.
6. Verify no Queue message, DLQ record or Lark business record write occurred.
7. Confirm logs contain no signature, secret, nonce, raw body or customer display data beyond approved sanitized operational evidence.

## Step 4 — Negative security checks

Run the automated focused suite against the exact UAT build. It must prove:

- valid signature accepted;
- invalid signature rejected;
- tampered body/digest rejected;
- missing header rejected;
- duplicate header rejected;
- query-string route rejected;
- timestamp older/newer than 300 seconds rejected;
- reused nonce rejected;
- wrong MCC/customer/customerKey/accountKey/timezone rejected;
- unknown schema field, count mismatch, duplicate row, unstable order and broken parent relation rejected.

Do not mutate the real Google Ads account to perform negative tests.

## Step 5 — Manual one-shot `LIVE`

1. Confirm schedules remain absent/disabled.
2. Capture pre-run row counts and stable-key duplicate counts for the 12 destination tables.
3. Change only `EXECUTION_MODE` to `LIVE`.
4. Run the Script manually once.
5. Restore `EXECUTION_MODE` to `DRY_RUN` immediately after the request is accepted.
6. Verify API response is `202 queued` or an idempotent accepted state.
7. Verify the Queue body contains only schema version, job type, delivery ID and requested timestamp.
8. Verify D1 progresses through `queued`/`processing` to `completed`.
9. Verify the shared reliability run acquires and releases its distributed lock.
10. Verify the Sync Log/reliability mirror records success without exposing the raw payload or secret.
11. Verify reconciliation for all 12 tables:
    - expected equals created + updated + skipped;
    - duplicate input rows equals zero;
    - no partial write started before all 12 plans passed.
12. Verify Google Ads still reports no changes and no Campaign/Ad/budget/billing mutation.

## Step 6 — Idempotency and reconciliation

1. Replay the exact saved LIVE body and delivery ID with a fresh timestamp/nonce/signature inside payload retention.
2. Expected request-level result: idempotent accepted; no second Queue message for queued/processing/completed state.
3. Run a fresh Script collection with a new delivery ID.
4. Verify destination stable keys produce updates/skips rather than duplicate records.
5. Recount duplicates in all 12 tables; expected zero.
6. Compare exact date range and account timezone against Google Ads UI totals for spend, impressions, clicks and video views.
7. Treat missing/unsupported values as `null`; verify explicit zero remains zero.

## Step 7 — Retry, lock, DLQ and redrive

Use isolated UAT fault injection or test doubles; do not corrupt Production resources.

1. Simulate transient D1/Lark/Queue failure and verify retry classification plus Queue backoff.
2. Verify the same delivery resumes under the same stable identities and does not duplicate writes.
3. Run two concurrent copies of one delivery and verify only one distributed lock holder writes.
4. Simulate a permanent schema/reconciliation failure.
5. Verify delivery state becomes `failed_permanent` before DLQ persistence.
6. Verify the bounded payload remains usable for investigation/redrive only inside the 7-day application window.
7. Perform one controlled DLQ redrive within retention and confirm idempotent recovery or the same permanent rejection.
8. Verify the first ingress/read after payload expiry redacts it and blocks redrive; no Google Ads cleanup schedule is added.
9. Verify terminal audit rows become cleanup-eligible after 30 days and are removed on the next ingress sweep.

## Step 8 — UAT decision

Pass only when all conditions are true:

- exact account selection passed;
- signed PREVIEW passed with zero Queue/Lark business writes;
- negative security/replay tests passed;
- one-shot LIVE completed all 12 plans/writes/reconciliation;
- reruns created zero duplicate stable keys;
- retry/backoff, distributed lock, DLQ/redrive and payload expiry passed;
- Google Ads mutations remained zero;
- TikTok, Meta, YouTube and Core regression gates passed;
- Schedule remained disabled;
- no secret/raw signed payload leaked.

Record evidence in `docs/current-task.md`. Do not mark Production ready from source tests alone.

## Rollback

1. Set `MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false` on both UAT Workers.
2. Restore the Manager Script to `DRY_RUN` or stop invoking it. No schedule should exist to disable.
3. Stop manual delivery calls and pause/drain the isolated UAT Queue as appropriate.
4. Deploy the prior known-good Worker commit.
5. Preserve D1 audit/DLQ evidence until investigation and retention complete.
6. Do not reverse Lark schema, Formula or Views; this task did not change them.
7. Treat any partial Lark rows as stable-key upserts. Reconcile by delivery evidence before any approved correction; do not bulk-delete blindly.
8. After Queue/DLQ drain and retention, UAT-only delivery tables may be removed through a separately reviewed migration. Never drop Production state as an ad-hoc rollback.
