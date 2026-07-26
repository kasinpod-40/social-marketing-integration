# Google Ads Manager Script End-to-End Lark Rollout Runbook

## Status

```text
BASE_IMPLEMENTATION        = MERGED_PR_57
SCRIPT_GATE_HOTFIX         = PR_59_IN_REVIEW
ROLLOUT_AUTHORIZATION      = APPROVED_THROUGH_MANUAL_LIVE_D1_LARK_UAT_2026_07_26
PRIMARY_DELIVERY_SOURCE    = GOOGLE_ADS_MANAGER_SCRIPT
DIRECT_GOOGLE_ADS_API      = OPTIONAL_FUTURE_PATH
GOOGLE_ADS_API_ACCESS      = PENDING_NON_BLOCKING
CUSTOMER_OAUTH_CALLBACK    = COMPLETED
ENCRYPTED_REFRESH_TOKEN    = ACTIVE
OPERATOR_PREFLIGHT         = BLOCKED_OPERATOR_ENV_NOT_CONNECTED
REMOTE_BACKUP              = NOT_RUN
REMOTE_MIGRATION           = NOT_RUN
WORKER_DEPLOYMENT          = NOT_RUN
EXTERNAL_LIVE_RUN          = NOT_RUN
QUEUE_BUSINESS_PROCESSING  = NOT_RUN
LARK_BUSINESS_WRITE        = NOT_RUN
EXACT_RERUN                = NOT_RUN
SCHEDULE                   = DISABLED
PRODUCTION                 = BLOCKED
```

The approved ingestion path is:

```text
Google Ads
→ Manager Script
→ signed HMAC delivery
→ reference-only Queue
→ durable D1 Ads facts and Coverage
→ Shared RAW Ads Lark tables
→ Canonical Ads Lark tables
```

Direct Google Ads API developer-token approval is not required for Manager Script delivery.
The API status remains visible for a possible future direct API path, but
`google_ads_api_access_pending` is not a rollout stop condition when the exact Script consent
gate passes.

The current execution session does not have the protected operator environment. No Remote
command has run, no config has been guessed, and no Secret has been requested or exposed.

## Safety model

The operator defaults to plan-only:

```bash
npm run rollout:google-ads-live
```

Plan mode runs no Git, Wrangler, D1, Queue, Lark, Secret or Google Ads command. Every executable
phase requires:

1. `--execute`;
2. an exact phase-specific confirmation value;
3. evidence from the preceding phase;
4. `development / integration_workspace / chemistry_k` identity;
5. the exact Manager, advertiser and `Asia/Bangkok` runtime mapping;
6. reviewed real Wrangler config paths supplied outside Git.

The operator never:

- creates or rotates Secrets;
- generates a signed Manager Script payload;
- runs the Manager Script automatically;
- changes Google Ads campaigns, ads, bids, budgets or spend;
- enables a schedule;
- cuts over Production.

## Required operator environment

The rollout must run from a clean reviewed `main` checkout in the developer-owned Integration
Workspace operator environment. The following values are supplied only in that protected
environment:

```text
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
MKT_GOOGLE_ADS_LIVE_DATABASE_NAME=<integration-workspace-d1>
MKT_GOOGLE_ADS_LIVE_API_WRANGLER_CONFIG=<reviewed-api-config>
MKT_GOOGLE_ADS_LIVE_SYNC_WRANGLER_CONFIG=<reviewed-sync-config>
MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID=<approved-manager-id>
MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID=<approved-advertiser-id>
MKT_GOOGLE_ADS_SOURCE_TIMEZONE=Asia/Bangkok
```

The environment must also provide:

- ignored real API and Sync Wrangler configs;
- authenticated Wrangler/Cloudflare identity;
- a writable ignored evidence directory;
- a clean `main` working tree at the reviewed source.

No OAuth token, Refresh Token, access token, Signing Secret, ciphertext, IV or operator token is
accepted as an operator argument or written to evidence.

## Phase order

### 1. Preflight

```bash
CONFIRM_GOOGLE_ADS_LIVE_PREFLIGHT=preflight \
npm run rollout:google-ads-live:preflight
```

Checks:

- clean reviewed `main`;
- syntax, architecture and hygiene;
- focused Google Ads signed transport, consent, Queue, D1, Lark and redrive tests;
- Wrangler dry-run;
- Cloudflare identity;
- pending migrations list;
- both real configs keep Connector, ingress, admission, business, Lark and schedule flags
  `false`.

No remote write occurs.

### 2. D1 backup

```bash
CONFIRM_GOOGLE_ADS_LIVE_BACKUP=backup \
npm run rollout:google-ads-live:backup
```

Creates a Remote D1 SQL export and SHA-256 checksum under the ignored evidence directory.
Migration is blocked unless the evidence remains readable and its checksum matches.

### 3. Additive migration

```bash
CONFIRM_GOOGLE_ADS_LIVE_MIGRATION=migrate \
npm run rollout:google-ads-live:migrate
```

Applies reviewed pending additive migrations, including
`0015_google_ads_live_admission.sql`. It does not enqueue work or write Ads/Lark business facts.
Stop if the pending list contains an unreviewed migration.

### 4. Flags-false deployment

```bash
CONFIRM_GOOGLE_ADS_FLAGS_FALSE_DEPLOY=deploy \
npm run rollout:google-ads-live:deploy
```

Deploys API and Sync Workers only after proving:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
```

### 5. Disabled-route and schema verification

After deployment, verify with bounded read-only commands:

- Migration `0015` is recorded as applied;
- `google_ads_live_admissions` has the expected columns and indexes;
- API and Sync Workers report the reviewed deployment;
- signed ingress and Queue admission reject execution while disabled;
- no Google Ads Queue message, Ads business fact or Lark business write occurred;
- Connector and Job remain manual UAT only;
- Google Ads schedule remains disabled.

### 6. Manager Script Customer Connection gate

```bash
CONFIRM_GOOGLE_ADS_CONNECTION_GATE_READ=connection-gate \
npm run rollout:google-ads-live:connection-gate
```

The read-only query returns bounded booleans/counts and never selects ciphertext, IV or
plaintext credentials. It requires exactly one Script-authorized connection with:

- `customer_key = chemistry_k`;
- `connector_key = google_ads`;
- `connection_status = connected`;
- `access_status = validated` **or** `google_ads_api_access_pending`;
- exact `https://www.googleapis.com/auth/adwords` scope;
- active encrypted Refresh Token reference matching the connection;
- exact approved Manager ID;
- exact approved advertiser ID from validated identity or approved OAuth metadata.

`api_access_validated` and `api_access_pending` are evidence fields only. They do not alter the
Manager Script decision.

Currency and timezone are validated from the signed Manager Script source/runtime contract.
When API-derived metadata is present it must not conflict, but its absence while API access is
pending is allowed.

### 7. External LIVE readiness boundary

```bash
CONFIRM_GOOGLE_ADS_EXTERNAL_LIVE_READY_CHECK=live-ready \
npm run rollout:google-ads-live:live-ready
```

This records readiness only and performs no LIVE run or flag mutation. The user's instruction
on 2026-07-26 already authorizes one manual LIVE UAT through Queue, D1 and Lark, subject to all
preceding gates passing.

Before running the Script:

1. set only the reviewed manual execution flags to `true`;
2. keep `MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false`;
3. confirm the clean reviewed Manager Script is still mapped to the approved Manager and
   advertiser;
4. set Script mode to `LIVE` and delivery enabled for one execution window;
5. run once and capture the returned Run ID;
6. restore Script delivery and manual execution flags to `false` immediately after admission.

### 8. Verify first LIVE run

```bash
MKT_GOOGLE_ADS_LIVE_RUN_ID=<uuid-v4> \
CONFIRM_GOOGLE_ADS_LIVE_VERIFY=verify \
npm run rollout:google-ads-live:verify
```

Requires:

- every signed chunk and row received;
- Admission and durable Work `completed`;
- staged transport and admission payloads redacted;
- six Coverage rows;
- Ads entity and daily facts written to D1;
- Shared RAW and Canonical Lark phases completed;
- bounded reconciliation counts preserved.

The expected Lark destinations are:

```text
RAW_Ads_Entities
RAW_Ads_Daily
MKT_Ads_Accounts
MKT_Ads_Campaigns
MKT_Ads_AdGroups
MKT_Ads_Ads
MKT_Ads_Creatives
MKT_Ads_Daily
```

### 9. Exact rerun verification

Retry the exact same signed Run without changing its operation identity, then execute:

```bash
MKT_GOOGLE_ADS_LIVE_RUN_ID=<same-uuid-v4> \
CONFIRM_GOOGLE_ADS_LIVE_RERUN_VERIFY=rerun-verify \
npm run rollout:google-ads-live:rerun-verify
```

The operator compares first-run and rerun evidence and fails if durable business counts drift.
The retry must not enqueue a second independent operation or create duplicate D1/Lark facts.

## Queue and DLQ rules

The only Google Ads Queue body is:

```json
{
  "schemaVersion": 1,
  "type": "google.ads.manager.signed-delivery.process",
  "operationId": "<runId>",
  "workKey": "google_ads:<runId>",
  "generation": 0,
  "originalRequestedAt": 0,
  "requestedAt": "<RFC3339>"
}
```

Controlled redrive sends this exact body unchanged. It does not add a DLQ ID, customer ID,
source rows, signature or credentials. Redrive is not part of the normal UAT and requires an
actual reviewed retryable incident. Completed and superseded Work remain closed.

## Stop conditions

Stop without attempting recovery when any of these occurs:

- config flag or schedule is not safely false at a phase that requires it;
- backup/checksum evidence is absent or mismatched;
- Cloudflare identity or reviewed real config path is unavailable;
- customer connection count is not exactly one;
- connection is not `connected`;
- access status is neither `validated` nor `google_ads_api_access_pending`;
- exact `adwords` scope is missing;
- active encrypted credential reference is absent, replaced or revoked;
- approved Manager or advertiser identity mismatches;
- optional API-derived metadata conflicts with the signed source identity;
- signed HMAC, key ID, timestamp, nonce/replay or runtime identity fails;
- transport manifest/chunk/row mismatch;
- unknown Queue field/version/type;
- destination preflight, reconciliation or exact-rerun stability fails;
- Production/customer-owned cutover is requested without a separate task.

Do **not** stop only because Google Ads API developer-token access is pending.

## Current boundary

The Repository hotfix must be reviewed, pass Branch Verification and merge before Remote
execution. After merge, resume from Phase 1 only in the protected operator environment. The
current chat execution session cannot substitute for the developer workstation because it has
no mounted clean checkout, ignored real Wrangler configs, authenticated Cloudflare session or
ignored evidence directory.

The user authorization covers one manual Integration Workspace LIVE UAT through Queue, D1 and
Lark plus exact rerun verification. Schedule activation and Production remain separate blocked
tasks.
