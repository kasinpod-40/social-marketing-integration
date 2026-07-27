# Meta D1-only Rollout Runbook

> Repository implementation does not authorize these Remote phases. Execute only after the
> implementation PR is reviewed, merged and the exact phase is separately approved.

## Safety boundary

This operator processes exactly one target per evidence chain:

```text
facebook | instagram | chemistry_k2 | chemistry_k3
```

During the active window only the selected Connector, Meta source-read and Meta D1-write gates may
be true. Lark, Report, Schedule, DLQ redrive, unrelated Connectors and Production remain false.

## Required local inputs

Do not print or commit secret values.

```bash
export MKT_ENV=development
export MKT_CUSTOMER_PROFILE=integration_workspace
export MKT_CONNECTION_CUSTOMER_KEY=chemistry_k

export MKT_META_D1_ONLY_ACCOUNT_KEY=chemistry_k
export MKT_META_D1_ONLY_TARGET=facebook
export MKT_META_D1_ONLY_REPOSITORY_HEAD='<exact reviewed full SHA>'
export MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION='<current 100% Worker version UUID>'
export MKT_META_D1_ONLY_WRANGLER_CONFIG='wrangler.sync.jsonc'
export MKT_META_D1_ONLY_READ_ONLY_SUMMARY='outputs/meta-read-only-validation/summary.json'

export MKT_META_D1_ONLY_OPERATION_ID='meta-d1-facebook-20260727'
export MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT='2026-07-27T15:00:00+07:00'
export MKT_META_D1_ONLY_PERIOD_START='2026-07-01'
export MKT_META_D1_ONLY_PERIOD_END='2026-07-26'

export MKT_META_D1_ONLY_WORKER_NAME='social-mkt-sync-worker'
export MKT_META_D1_ONLY_DATABASE_NAME='social-mkt-state-dev'
export MKT_META_D1_ONLY_MAIN_QUEUE='social-mkt-sync-jobs'
export MKT_META_D1_ONLY_DLQ='social-mkt-sync-dlq'

export CLOUDFLARE_ACCOUNT_ID='<authorized account id>'
export CLOUDFLARE_API_TOKEN='<authorized local token>'
export MKT_META_D1_ONLY_QUEUE_ID='<exact main Queue id>'
```

`CLOUDFLARE_API_TOKEN` and Worker Provider Tokens remain local/secret-store values. Evidence stores
neither their values nor Authorization headers.

## Phase 0 — plan only

```bash
npm run rollout:meta-d1-only
```

Review:

- exact target and operation identity;
- Safe/Active config fingerprints;
- read-only summary fingerprint;
- phase list and confirmation names;
- no Remote action

## Phase 1 — preflight

```bash
CONFIRM_META_D1_ONLY_PREFLIGHT=PREFLIGHT_META_D1_ONLY_ROLLOUT \
npm run rollout:meta-d1-only:preflight
```

Expected:

- exact Git HEAD and clean tree;
- local Safe/Active bundles pass dry-run;
- active Worker version matches;
- required D1 tables exist;
- required Worker Secret name exists;
- new operation identity has zero prior state;
- zero Provider requests and zero Remote mutations

Stop when any unexpected migration is pending. The only explicitly tolerated unrelated pending
migration is `0018_chatwoot_analytics.sql` while every Chatwoot flag remains false.

## Phase 2 — checksum backup

```bash
CONFIRM_META_D1_ONLY_BACKUP=BACKUP_META_D1_ONLY_STATE \
npm run rollout:meta-d1-only:backup
```

Review the private local backup path, byte count and SHA-256. Do not upload the SQL backup to Git,
PR, Lark or chat.

## Phase 3 — safe baseline deployment

```bash
CONFIRM_META_D1_ONLY_DEPLOY_SAFE=DEPLOY_META_D1_ONLY_SAFE_BASELINE \
npm run rollout:meta-d1-only:deploy-safe

CONFIRM_META_D1_ONLY_VERIFY_SAFE=VERIFY_META_D1_ONLY_SAFE_BASELINE \
npm run rollout:meta-d1-only:verify-safe
```

Expected Remote state: all MKT execution flags false and exact Queue topology retained.

## Phase 4 — active D1-only deployment

```bash
CONFIRM_META_D1_ONLY_DEPLOY_ACTIVE=DEPLOY_META_D1_ONLY_GATES \
npm run rollout:meta-d1-only:deploy-active

CONFIRM_META_D1_ONLY_VERIFY_ACTIVE=VERIFY_META_D1_ONLY_DEPLOYMENT \
npm run rollout:meta-d1-only:verify-active
```

Expected true flags are exactly:

```text
selected Connector flag
MKT_META_SOURCE_READ_ENABLED
MKT_META_D1_WRITE_ENABLED
```

`MKT_META_LARK_WRITE_ENABLED` and `MKT_META_REPORT_READ_ENABLED` must remain false.

## Phase 5 — operation baseline

```bash
CONFIRM_META_D1_ONLY_SNAPSHOT=SNAPSHOT_META_D1_ONLY_BASELINE \
npm run rollout:meta-d1-only:snapshot
```

Expected operation-scoped Run/Work/Queue/Coverage state is absent and no active lock exists.

## Phase 6 — send one operation

```bash
CONFIRM_META_D1_ONLY_SEND=SEND_ONE_META_D1_ONLY_OPERATION \
npm run rollout:meta-d1-only:send
```

The operator creates an attempt record before calling the Queue API. Never delete the attempt file
to bypass a failed or uncertain send. Investigate the exact outcome instead.

Source and D1 continuations are generated only by the Shared Worker. Do not manually send
continuations.

## Phase 7 — verify D1-only completion

```bash
CONFIRM_META_D1_ONLY_VERIFY=VERIFY_META_D1_ONLY_OPERATION \
npm run rollout:meta-d1-only:verify
```

Required evidence:

```text
sync_runs.status=success
D1 phase complete
Coverage run count > 0
Coverage failed_rows=0
no Lark phase
no full-completion phase
no active lock
Work lifecycle remains active / completed_at NULL
```

This is the intentional `lark_gate_disabled` boundary.

## Phase 8 — same-operation idempotent rerun

```bash
CONFIRM_META_D1_ONLY_RESEND=RESEND_SAME_META_D1_ONLY_OPERATION \
npm run rollout:meta-d1-only:resend

CONFIRM_META_D1_ONLY_VERIFY_RERUN=VERIFY_META_D1_ONLY_IDEMPOTENT_RERUN \
npm run rollout:meta-d1-only:verify-rerun
```

Expected:

- Queue attempt increases;
- target Business counts unchanged;
- operation-scoped Business counts unchanged;
- Coverage run/entity counts unchanged;
- no Lark/completion phase;
- no active lock

## Phase 9 — all-false restore

Run restore after a successful rerun and immediately after any failed Active/Send/Verify phase:

```bash
CONFIRM_META_D1_ONLY_RESTORE=RESTORE_META_D1_ONLY_ALL_FALSE \
npm run rollout:meta-d1-only:restore

CONFIRM_META_D1_ONLY_VERIFY_RESTORE=VERIFY_META_D1_ONLY_RESTORE \
npm run rollout:meta-d1-only:verify-restore
```

Do not proceed while the selected Connector, Meta source-read or D1-write flag remains true.

## Phase 10 — summary

```bash
CONFIRM_META_D1_ONLY_SUMMARY=SUMMARIZE_META_D1_ONLY_ROLLOUT \
npm run rollout:meta-d1-only:summary
```

A passed summary proves one target only. Create a fresh operation ID and evidence chain for the next
target. Never reuse another target's operation or Evidence directory.

## Required target order

Unless a later explicit approval changes the order:

```text
facebook
→ instagram
→ chemistry_k2
→ chemistry_k3
```

Complete and restore one target before opening the next target window.

## Stop conditions

Stop and restore all false when:

- exact Git or Worker version changes;
- Working Tree is dirty;
- read-only summary is absent or invalid;
- config contains an extra true flag;
- D1 schema is incomplete;
- operation identity already exists;
- backup is empty or checksum unavailable;
- Queue send result is uncertain;
- sync run fails, times out or retains an active lock;
- Coverage failed/partial/source-unavailable state appears;
- any Lark or full-completion phase appears;
- rerun changes Business or Coverage counts;
- Remote flags cannot be verified or restored

## Explicitly not authorized

- Lark parity or write;
- Report cutover/materialization;
- Schedule activation;
- DLQ redrive;
- Retention/delete;
- Production;
- executing the next target without a new approval
