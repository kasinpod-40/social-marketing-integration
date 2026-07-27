# TikTok Post-Lark Guarded Rollout Runbook

## Purpose

This runbook executes the first Integration Workspace rollout gates for the merged TikTok
Organic post-Lark pipeline. It must be run only from the authorized local machine that already
has the real ignored Wrangler configs, Cloudflare authentication and Worker Secrets access.

The operator is plan-only by default and does not contain Queue send, DLQ redrive, Lark write,
schedule, retention/delete or Production actions.

## Required repository state

```bash
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
```

Requirements:

- current branch is `main`;
- working tree is clean;
- `ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4` is an ancestor of `HEAD`;
- the rollout-operator implementation PR has been merged and its full Branch Verification passed.

## Required local files

Prepare two ignored local Wrangler configs. Never commit either file.

### Safe config

Example path:

```text
wrangler.sync.jsonc
```

It must retain all TikTok execution, Report, Queue redrive, retention and schedules as `false`,
including:

```text
MKT_CONNECTOR_TIKTOK_ENABLED=false
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_TIME_SERIES_D1_BACKFILL_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
MKT_DLQ_REDRIVE_ENABLED=false
```

Google Ads execution and schedule flags must also remain false.

### Audit-only config

Copy the real safe config to another ignored file, for example:

```text
wrangler.sync.tiktok-audit.jsonc
```

Change exactly one rollout flag:

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=true
```

All Business-write, Admission, Report-cutover, Queue-redrive, retention and schedule flags must
remain false.

## Required local environment

```bash
export MKT_ENV=development
export MKT_CUSTOMER_PROFILE=integration_workspace
export MKT_CONNECTION_CUSTOMER_KEY=chemistry_k
export TIKTOK_SOURCE_HANDLE=chemistry_k
export MKT_TIKTOK_ROLLOUT_DATABASE_NAME=social-mkt-state-dev
export MKT_TIKTOK_ROLLOUT_SAFE_WRANGLER_CONFIG=wrangler.sync.jsonc
export MKT_TIKTOK_ROLLOUT_AUDIT_WRANGLER_CONFIG=wrangler.sync.tiktok-audit.jsonc
export MKT_TIKTOK_ROLLOUT_WORKER_ORIGIN=https://<actual-sync-worker-origin>
export MKT_TIKTOK_ROLLOUT_EVIDENCE_DIR=outputs/tiktok-post-lark-rollout
```

For the authenticated Audit phase only, expose the existing operator token in the local shell:

```bash
export MKT_CONNECTION_OPERATOR_TOKEN='<read from the authorized secret source>'
```

Never paste or commit the token into a file, command history, issue, PR, log or Lark.

## Deployment identity and route stability

Every Worker deployment phase (`deploy-safe`, `enable-audit` and `disable-audit`) captures the
exact Worker version from Wrangler structured deployment output. Missing, ambiguous or malformed
deployment identity fails closed; the operator never selects a generic UUID from console text.

After deployment, the operator performs exactly three consecutive unauthenticated probes against
the same normalized target. Every probe:

- adds a unique cache-busting query value without changing the handler pathname;
- follows no redirects;
- sends `Cache-Control: no-cache, no-store` and `Pragma: no-cache`;
- sends no Authorization header;
- reads and discards only a bounded amount of response data;
- records only sequence, timestamps, status and the SHA-256 target fingerprint;
- waits for a bounded interval before the next probe.

Evidence never stores the raw origin, URL, query nonce, response body, headers or Token. The
required stable sequence is three `404` responses for safe deployments and three `401` responses
for the Audit-only deployment. A mixed sequence fails with
`TIKTOK_POST_LARK_ROLLOUT_ROUTE_STABILITY_FAILED` and requires immediate safe-close.

## Preview the complete plan

```bash
npm run rollout:tiktok-post-lark
```

Expected: `executed=false`. No external command is run.

## Phase 1 — Read-only preflight

```bash
export CONFIRM_TIKTOK_POST_LARK_PREFLIGHT=READ_ONLY_TIKTOK_POST_LARK_PREFLIGHT
npm run rollout:tiktok-post-lark:preflight
unset CONFIRM_TIKTOK_POST_LARK_PREFLIGHT
```

The phase must prove:

- Repository and focused tests pass;
- Wrangler identity and exact D1 target are available;
- exactly `0016_tiktok_post_lark_pipeline.sql` is pending;
- Migration 0016 table/indexes are absent;
- active Work and Locks are zero;
- State and Observation duplicate groups are zero;
- current State, Observation and Coverage counts are captured;
- no mutation occurs.

Stop on any mismatch.

## Phase 2 — Remote D1 backup

```bash
export CONFIRM_TIKTOK_POST_LARK_BACKUP=BACKUP_BEFORE_0016_TIKTOK_POST_LARK
npm run rollout:tiktok-post-lark:backup
unset CONFIRM_TIKTOK_POST_LARK_BACKUP
```

Verify the backup file and `.sha256` file exist inside the evidence directory. Do not continue
with an empty backup or checksum mismatch.

## Phase 3 — Apply additive Migration 0016

```bash
export CONFIRM_TIKTOK_POST_LARK_MIGRATION=APPLY_0016_TIKTOK_POST_LARK
npm run rollout:tiktok-post-lark:migrate
unset CONFIRM_TIKTOK_POST_LARK_MIGRATION
```

The phase must verify:

- no pending migration remains;
- `tiktok_source_admissions` and all three reviewed indexes exist;
- Admission rows remain zero;
- State, Observation and Coverage counts are unchanged;
- active Work/Locks and duplicate groups remain zero.

Stop immediately on Business fact drift.

## Phase 4 — Deploy all-flags-false Worker

```bash
export CONFIRM_TIKTOK_POST_LARK_SAFE_DEPLOY=DEPLOY_TIKTOK_POST_LARK_ALL_FLAGS_FALSE
npm run rollout:tiktok-post-lark:deploy-safe
unset CONFIRM_TIKTOK_POST_LARK_SAFE_DEPLOY
```

Expected unauthenticated Audit route result: three consecutive HTTP `404` probes. Passed evidence
must include the deployed version ID, deployment timestamps, target fingerprint and probe policy.

## Phase 5 — Temporarily enable Audit-only route

```bash
export CONFIRM_TIKTOK_POST_LARK_AUDIT_ENABLE=ENABLE_TIKTOK_POST_LARK_AUDIT_ONLY
npm run rollout:tiktok-post-lark:enable-audit
unset CONFIRM_TIKTOK_POST_LARK_AUDIT_ENABLE
```

Expected unauthenticated Audit route result: three consecutive HTTP `401` probes. This proves the
same deployed version is stable and protected by the operator token. A failed stability attempt is
written separately and must never overwrite a prior passed `enable-audit.json`.

## Phase 6 — Run one authenticated read-only Audit

```bash
export CONFIRM_TIKTOK_POST_LARK_AUDIT_READ=READ_TIKTOK_POST_LARK_AUDIT_ONCE
npm run rollout:tiktok-post-lark:audit
unset CONFIRM_TIKTOK_POST_LARK_AUDIT_READ
unset MKT_CONNECTION_OPERATOR_TOKEN
```

The Audit phase rejects `enable-audit` evidence that is older than five minutes, incomplete,
superseded by a later failed enable attempt, missing its deployed version ID, from another target,
or missing exactly three successful `401` probes. Rejected evidence uses
`TIKTOK_POST_LARK_ROLLOUT_ENABLE_EVIDENCE_STALE`; do not bypass this gate.

Review the saved evidence for:

- exact Chemistry K identity;
- RAW record count and source watermark;
- D1 State/Observation/Coverage counts and duplicates;
- Canonical Content/Daily counts and key quality;
- cross-layer gaps;
- `readyForManualProcessing`;
- issue codes.

`readyForManualProcessing=false` is a valid read-only result. Do not proceed to a manual
watermark Admission until the issues are reviewed and a separate rollout approval is recorded.

## Phase 7 — Restore safe-closed Worker

Run this phase even when the Audit reports issues:

```bash
export CONFIRM_TIKTOK_POST_LARK_AUDIT_DISABLE=DISABLE_TIKTOK_POST_LARK_AUDIT
npm run rollout:tiktok-post-lark:disable-audit
unset CONFIRM_TIKTOK_POST_LARK_AUDIT_DISABLE
```

Expected unauthenticated Audit route result: three consecutive HTTP `404` probes. Safe-close
remains available after a failed enable attempt even when no authenticated Audit was run.

## Required stop conditions

Stop without continuing when any of the following occurs:

- repository branch/cleanliness/baseline mismatch;
- Cloudflare identity or target mismatch;
- unexpected pending migration;
- active Work or active Lock;
- duplicate State or Observation groups;
- backup/checksum failure;
- post-migration Business count drift;
- any forbidden flag enabled;
- any deployed version identity is missing or ambiguous;
- any route probe sequence differs from stable `404 × 3 → 401 × 3 → 200 → 404 × 3`;
- `enable-audit` evidence is stale, incomplete or superseded;
- Audit identity mismatch;
- Audit route cannot be restored to safe-closed.

## Not authorized by this runbook

- Queue message or watermark Admission;
- DLQ redrive/delete;
- Lark record/schema mutation outside the existing audited read path;
- D1/Canonical processing;
- Report shadow or primary cutover;
- schedule activation;
- retention/delete;
- Production.
