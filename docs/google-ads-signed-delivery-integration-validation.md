# Google Ads Signed Delivery — Integration Workspace Validation

## Purpose

Validate the signed Manager Script → API Worker → D1 → Queue → Sync Worker → Lark flow for Chemistry K inside the single Integration Workspace while Google Ads remains read-only and schedules remain disabled.

This is not a DEV/UAT profile switch and does not authorize Production.

## Fixed topology

```text
MKT_ENV=development                 # technical isolation label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

Reuse without renaming or cloning:

- current API Worker and Sync Worker;
- current D1, Queue, DLQ and secret store;
- current `Social MKT Data Hub` Base and all table IDs;
- current Worker URL and bindings.

Google Ads is already a customer-real source in this mixed-source Workspace. Other channels may still use temporary developer sources; they are unrelated to this validation and must not be switched concurrently.

## Configuration names

### Existing API Worker

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=true
MKT_GOOGLE_ADS_SIGNING_KEY_ID=<key id>
MKT_STATE_DB=<existing D1 binding>
MKT_SYNC_QUEUE=<existing Queue producer binding>
```

Secrets:

```text
MKT_GOOGLE_ADS_SIGNING_SECRET
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET   # rotation only
```

Optional non-secret rotation variable:

```text
MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID
```

### Existing Sync Worker

Keep the same environment/profile and existing bindings. Required Lark table variables remain the six Google RAW, six Canonical Ads, Sync Log and System Alerts table IDs already configured in the Workspace.

### Manager Script Properties

```text
MKT_GOOGLE_ADS_DELIVERY_URL
MKT_GOOGLE_ADS_SIGNING_KEY_ID
MKT_GOOGLE_ADS_SIGNING_SECRET
```

The URL must be exact HTTPS, contain no query/fragment and end at `/v1/google-ads/deliveries`.

## Step 1 — Workspace preflight

1. Confirm final branch gates pass.
2. Confirm the Script still starts with `EXECUTION_MODE: 'DRY_RUN'` and contains no mutation/schedule API.
3. Back up the existing D1 and capture current Queue/DLQ/Lark counts.
4. Apply migration `0009_google_ads_signed_delivery.sql` to the existing D1 only once.
5. Set signing values in the existing secret store; never print them.
6. Keep the Workspace profile unchanged as `integration_workspace`.
7. Enable only the Google Ads connector for the manual validation window.
8. Verify all business schedules remain disabled.

## Step 2 — `DRY_RUN`

1. Copy the reviewed Script into `Social MKT Google Ads Daily Export DEV` under manager `946-357-0541`.
2. Keep `EXECUTION_MODE='DRY_RUN'`.
3. Run Preview manually.
4. Confirm exact account selection resolves only `566-233-2033`.
5. Confirm schema `google_ads_signed_delivery_v1`, six dataset counts and `externalDelivery:false`.
6. Confirm Google Ads reports `No changes`.
7. Confirm no API/D1/Queue/DLQ/Lark delivery activity.

Stop on any account mismatch.

## Step 3 — Signed `PREVIEW`

1. Set the three Script Properties.
2. Change only `EXECUTION_MODE` to `PREVIEW`.
3. Run once manually.
4. Expect HTTP `200`, `status=preview_validated` and six dataset counts.
5. Verify D1 audit exists with redacted payload `{}`.
6. Verify zero Queue, DLQ and Lark business writes.
7. Verify logs contain no signature, secret, nonce or raw body.

## Step 4 — Negative security checks

Run the focused automated suite against the exact build. It must reject invalid signature, tampering, missing/duplicate headers, query-string route, expired timestamp, replayed nonce, wrong identity, unknown fields, count/order/duplicate/relation failures.

Do not mutate the real Google Ads account for negative tests.

## Step 5 — Manual one-shot `LIVE`

1. Capture pre-run row and duplicate counts for all 12 destination tables.
2. Change only `EXECUTION_MODE` to `LIVE`.
3. Run once manually.
4. Restore `DRY_RUN` immediately after acceptance.
5. Expect `202 queued` or idempotent accepted state.
6. Verify Queue body contains only schema version, job type, delivery ID and requested timestamp.
7. Verify D1 reaches `completed` through the expected states.
8. Verify shared distributed lock and reliability run.
9. Verify all 12 plans succeeded before the first write.
10. Verify `created + updated + skipped = expected` and `duplicateInputRows = 0` for every table.
11. Verify Google Ads still reports no changes.

## Step 6 — Idempotency and reconciliation

1. Resend the exact body/delivery ID with a fresh timestamp/nonce/signature inside retention.
2. Confirm no duplicate Queue message for queued/processing/completed state.
3. Run a fresh collection with a new delivery ID.
4. Verify destination stable keys update/skip rather than duplicate.
5. Compare spend, impressions, clicks and video views with the Google Ads UI for the exact date range/timezone.
6. Confirm unsupported values stay `null` and explicit zero stays `0`.

## Step 7 — Retry, lock, DLQ and redrive

Use controlled fault injection/test doubles without corrupting unrelated Workspace connectors:

1. transient D1/Lark/Queue failure and backoff;
2. resume without duplicate writes;
3. concurrent copies with one lock holder;
4. permanent schema/reconciliation failure;
5. delivery terminal before DLQ persistence;
6. controlled redrive inside seven-day retention;
7. post-expiry redaction and redrive rejection;
8. activity-driven 30-day audit cleanup eligibility.

## Step 8 — Restore safe state

1. Set `MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false`.
2. Keep the Manager Script at `DRY_RUN`.
3. Keep `MKT_CUSTOMER_PROFILE=integration_workspace`; do not switch to another profile.
4. Preserve validation evidence and reconcile any partial rows by stable key.
5. Keep every schedule disabled.

## Pass decision

Pass only when exact selection, signed PREVIEW, negative security/replay, one-shot LIVE, 12-table reconciliation, zero-duplicate rerun, retry/lock/DLQ/redrive, zero Google Ads mutation, cross-connector regression, schedule-disabled state and no secret leakage all pass.

## Rollback

1. Disable the Google Ads connector on existing Workers.
2. Restore Script `DRY_RUN` or stop manual invocation.
3. Stop affected delivery calls and drain only affected Queue/DLQ messages.
4. Deploy the previous known-good Worker commit if needed.
5. Preserve D1/DLQ evidence through retention.
6. Keep the Workspace profile unchanged.
7. Do not reverse Lark schema, Formula or Views.
8. Reconcile partial rows by delivery/stable-key evidence; never bulk-delete blindly.
