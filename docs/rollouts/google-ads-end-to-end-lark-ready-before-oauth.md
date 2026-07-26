# Google Ads End-to-End Lark Ready Before OAuth — Rollout Runbook

## Status

```text
SOURCE_IMPLEMENTATION     = MERGED_PR_57
MERGE_COMMIT              = e114db4669fea93b23fb4816232f4598de3e401a
ROLLOUT_APPROVAL          = APPROVED_2026_07_26
OPERATOR_PREFLIGHT        = BLOCKED_OPERATOR_ENV_NOT_CONNECTED
REMOTE_BACKUP             = NOT_RUN
REMOTE_MIGRATION          = NOT_RUN
WORKER_DEPLOYMENT         = NOT_RUN
CUSTOMER_OAUTH_CALLBACK   = NOT_RECEIVED
EXTERNAL_LIVE_RUN         = NOT_RUN
QUEUE_BUSINESS_PROCESSING = NOT_RUN
LARK_BUSINESS_WRITE       = NOT_RUN
SCHEDULE                  = DISABLED
PRODUCTION                = BLOCKED
```

The user explicitly approved the guarded Remote rollout boundary on 2026-07-26.
Execution stopped before Phase 1 because the approved operator environment was not
connected to the execution session. No Remote command ran, no config was guessed and
no Secret was requested or exposed.

## Safety model

The operator defaults to plan-only:

```bash
npm run rollout:google-ads-live
```

Plan mode runs no Git, Wrangler, D1, Queue, Lark, Secret or Google Ads command.
Every executable phase requires:

1. `--execute`;
2. an exact phase-specific confirmation value;
3. evidence from the preceding phase;
4. `development / integration_workspace / chemistry_k` identity;
5. the exact manager, advertiser and `Asia/Bangkok` mapping;
6. reviewed real Wrangler config paths supplied outside Git.

The operator never:

- creates or rotates Secrets;
- generates a signed Manager Script payload;
- runs the Manager Script automatically;
- changes Google Ads campaigns, ads, bids, budgets or spend;
- enables a schedule;
- cuts over Production.

## Required operator environment

The rollout must run from a clean reviewed `main` checkout in the developer-owned
Integration Workspace operator environment. The following values are supplied only in
that protected environment:

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

The operator environment must also provide:

- the ignored real API and Sync Wrangler configs;
- authenticated Wrangler/Cloudflare identity;
- a writable ignored evidence directory;
- a clean `main` working tree at the reviewed source.

No OAuth token, Refresh Token, access token, Signing Secret, ciphertext, IV or
operator token is accepted as an operator argument or written to evidence.

## Phase order

### 1. Preflight

```bash
CONFIRM_GOOGLE_ADS_LIVE_PREFLIGHT=preflight \
npm run rollout:google-ads-live:preflight
```

Checks:

- clean reviewed `main`;
- syntax, architecture and hygiene;
- focused Google Ads transport/OAuth/Queue/D1/Lark/redrive tests;
- Wrangler dry-run;
- Cloudflare identity;
- pending migrations list;
- both real configs keep Connector, ingress, admission, business, Lark and
  schedule flags `false`.

No remote write occurs.

### 2. D1 backup

```bash
CONFIRM_GOOGLE_ADS_LIVE_BACKUP=backup \
npm run rollout:google-ads-live:backup
```

Creates a Remote D1 SQL export and SHA-256 checksum under the ignored evidence
directory. Migration is blocked unless this evidence remains readable and the
checksum matches.

### 3. Additive migration

```bash
CONFIRM_GOOGLE_ADS_LIVE_MIGRATION=migrate \
npm run rollout:google-ads-live:migrate
```

Applies pending additive migrations, including
`0015_google_ads_live_admission.sql`. It does not enqueue work or write Ads/Lark
business facts.

### 4. Flags-false deployment

```bash
CONFIRM_GOOGLE_ADS_FLAGS_FALSE_DEPLOY=deploy \
npm run rollout:google-ads-live:deploy
```

Deploys API and Sync Workers only after re-reading both real configs and proving:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
```

### 5. Disabled-route and schema verification

After deployment, verify without enabling any execution flag:

- `0015_google_ads_live_admission.sql` is recorded as applied;
- `google_ads_live_admissions` exists with the expected columns and indexes;
- API and Sync Workers report the new deployment successfully;
- signed ingress and Queue admission reject execution while disabled;
- no Google Ads Queue message, Ads business fact or Lark business write occurred;
- Google Ads Connector and Job remain `uat_pending`;
- schedules remain unchanged and Google Ads schedule remains disabled.

This verification must use bounded read-only commands and sanitized evidence.

### 6. Encrypted Customer Connection gate

This phase is not expected to pass until the customer completes the exact OAuth
connection.

```bash
CONFIRM_GOOGLE_ADS_CONNECTION_GATE_READ=connection-gate \
npm run rollout:google-ads-live:connection-gate
```

The query is read-only and returns only bounded booleans/counts. It requires one
validated Google Ads connection with:

- exact customer, manager and advertiser identity;
- `connected / validated` lifecycle;
- active encrypted Refresh Token reference;
- `THB` and `Asia/Bangkok` provider metadata.

It never selects ciphertext, IV or plaintext credentials.

### 7. External LIVE readiness boundary

```bash
CONFIRM_GOOGLE_ADS_EXTERNAL_LIVE_READY_CHECK=live-ready \
npm run rollout:google-ads-live:live-ready
```

This phase records readiness only. It performs no LIVE run and no flag mutation.
A separate explicit instruction is still required to:

1. enable only the approved manual execution flags;
2. run the clean Manager Script in `LIVE` once;
3. capture the returned Run ID;
4. disable execution flags immediately after admission;
5. continue with verification.

The customer OAuth callback and Google Ads provider access must already be valid.
Wrong account, insufficient scope, rejected Developer Token access or metadata
mismatch remain real blockers.

### 8. Verify first LIVE run

```bash
MKT_GOOGLE_ADS_LIVE_RUN_ID=<uuid-v4> \
CONFIRM_GOOGLE_ADS_LIVE_VERIFY=verify \
npm run rollout:google-ads-live:verify
```

Requires:

- all signed chunks and rows received;
- Admission and durable Work `completed`;
- staged payload redacted;
- six Coverage rows;
- bounded Ads entity/daily counts available for comparison.

### 9. Exact rerun verification

After the exact same signed Run is retried under a separately approved operator
window:

```bash
MKT_GOOGLE_ADS_LIVE_RUN_ID=<same-uuid-v4> \
CONFIRM_GOOGLE_ADS_LIVE_RERUN_VERIFY=rerun-verify \
npm run rollout:google-ads-live:rerun-verify
```

The operator compares the first and second evidence and fails if durable business
counts drift.

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

Controlled redrive sends this exact body unchanged. It does not add
`redriveReference`, DLQ ID, customer ID, source rows or credentials. Redrive
revives only the same-generation terminal Work when no active lock exists;
completed and superseded Work remain closed.

## Stop conditions

Stop without attempting recovery when any of these occurs:

- config flag or schedule is not safely false at the phase that requires it;
- backup/checksum evidence is absent;
- Cloudflare identity or real config path is unavailable;
- customer connection count is not exactly one;
- manager, advertiser, currency or timezone mismatch;
- missing/expired/revoked encrypted credential reference;
- provider access pending/rejected;
- transport manifest/chunk/row mismatch;
- unknown Queue field/version/type;
- reconciliation failure or duplicate/business-count drift;
- Production/customer-owned cutover is requested without a separate task.

## Current boundary

The source implementation is merged and the guarded rollout is approved only through
flags-false deployment and disabled-route/schema verification. The first execution
attempt stopped before operator preflight because the protected operator environment
was not connected.

Resume from Phase 1 only after the clean reviewed `main` checkout, ignored real
Wrangler configs, authenticated Cloudflare identity and writable evidence directory
are available together. Do not bypass the operator, synthesize replacement configs or
move secrets into Git/chat.

Customer authorization, signed LIVE execution, Queue/D1/Lark business writes,
redrive, schedule activation and Production still require separate approval.
