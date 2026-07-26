# Current Task — TikTok Post-Lark Guarded Rollout Operator

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = TIKTOK_POST_LARK_GUARDED_ROLLOUT_OPERATOR
APPROVED_DATE                       = 2026-07-26
BASE_COMMIT                         = ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4
IMPLEMENTATION_BRANCH               = agent/tiktok-post-lark-rollout-operator
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
CUSTOMER_KEY                        = chemistry_k
ACCOUNT_KEY                         = chemistry_k
SOURCE_HANDLE                       = chemistry_k
SOURCE                              = lark_native_tiktok_for_creator
REMOTE_RUNTIME_ACCESS               = UNAVAILABLE_IN_CONNECTED_ENVIRONMENT
REMOTE_MIGRATION_0016               = NOT_APPLIED
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
SCHEDULES                           = DISABLED
PRODUCTION                          = BLOCKED
```

## Objective

Implement a manual, evidence-chained and fail-closed operator for the first TikTok Organic
post-Lark Integration rollout gates after PR `#65` merged:

```text
plan
→ read-only Remote preflight
→ D1 backup
→ additive Migration 0016
→ all-flags-false Worker deployment
→ temporary audit-only deployment
→ one authenticated read-only RAW/D1/Canonical audit
→ restore all-flags-false Worker deployment
```

The operator prepares these phases only. This implementation task does not execute any phase
against Remote infrastructure.

## Starting evidence

- PR `#65` was Squash Merged at `acb0b76bb3be936319e0e8bed4849592c96761b5`.
- TikTok merge closeout was merged at `ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4`.
- Final implementation Branch Verification `#522` passed.
- A temporary GitHub Actions read-only preflight passed Repository gates and confirmed the
  deployed unauthenticated Audit route remains safe-closed with HTTP `404`.
- GitHub Actions and the connected execution environment have no Cloudflare credentials,
  Wrangler session or local `wrangler.sync.jsonc`; Remote D1 inspection was therefore skipped.
- No Migration, deployment, Queue, D1/Lark write, schedule or Production action occurred.

## In scope

1. Add a pure rollout-contract module with:
   - phase and exact-confirmation parsing;
   - exact Integration Workspace target validation;
   - safe/audit-only Wrangler config validation;
   - exact pending Migration `0016` gate;
   - read-only preflight and post-migration SQL;
   - additive business-count parity validation;
   - Wrangler D1 JSON parsing;
   - HTTP `404` / `401` / `200` route-state gates;
   - authenticated Audit response validation.

2. Add a CLI operator with evidence chaining for:
   - `preflight`
   - `backup`
   - `migrate`
   - `deploy-safe`
   - `enable-audit`
   - `audit`
   - `disable-audit`

3. Add npm commands and focused tests.

4. Add a runbook for the authorized local Integration Workspace runtime.

## Safety contracts

- Default invocation is plan-only.
- Every executable phase requires a distinct exact environment confirmation.
- Operator must run from clean `main` containing merge closeout
  `ad6614dd8ee0cb2a1dda5cdbe7035f44b40581d4`.
- Target is locked to:
  - `MKT_ENV=development`
  - `MKT_CUSTOMER_PROFILE=integration_workspace`
  - `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`
  - `TIKTOK_SOURCE_HANDLE=chemistry_k`
  - D1 `social-mkt-state-dev`
  - Worker `social-mkt-sync-worker`
- Safe config keeps Audit, Admission, D1 write/backfill, Report cutover, Queue redrive,
  schedules, retention and Google Ads execution flags false.
- Audit config may set only `MKT_TIKTOK_AUDIT_HTTP_ENABLED=true`; all Business and schedule
  gates remain false.
- Migration phase requires a readable checksum-verified backup and exactly one pending
  migration: `0016_tiktok_post_lark_pipeline.sql`.
- Post-migration verification requires:
  - table and three indexes present;
  - zero Admission rows;
  - zero active Work and Locks;
  - zero State/Observation duplicate groups;
  - unchanged State, Observation and Coverage counts.
- Audit phase is GET-only and uses the operator token from local secret environment.
- Audit result may report `readyForManualProcessing=false`; this is valid diagnostic evidence,
  not fake success.
- The operator contains no Queue send, DLQ redrive, Lark write, schedule activation,
  retention/delete or Production path.

## Out of scope

- Running any Remote rollout phase in this implementation task.
- Manual watermark probe or processing Admission.
- D1/Canonical write execution.
- Lark-primary/D1-shadow report parity execution.
- D1-primary report cutover.
- Schedule activation.
- Production.

## Acceptance criteria

- Pure operator tests cover argument/confirmation, target identity, safe/audit configs,
  Migration 0016, read-only SQL, pre/post migration count parity, D1 response parsing,
  Audit identity/readiness and HTTP route states.
- `npm run check` passes.
- `npm test` passes.
- focused TikTok rollout operator tests pass.
- `npm run test:report-reliability` passes.
- `npm audit --audit-level=high` reports no unacceptable vulnerabilities.
- `npm run deploy:dry-run` passes.
- No Remote action occurs.
- Draft PR is opened for Integration Review and is not merged automatically.

## Implementation result

```text
STATUS          = IN_PROGRESS
DRAFT_PR        = PENDING
TESTS           = PENDING
LIVE_VALIDATION = NOT_RUN
REMOTE_ACTIONS  = NONE
```

## Archived predecessor

The merge-closeout Current Task is preserved unchanged at:

```text
docs/archive/current-task-before-tiktok-post-lark-rollout-operator-2026-07-26.md
```
