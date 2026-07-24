# TikTok Organic Durable Recovery Rollout — 2026-07-24

## Authorization

- User approval received: `2026-07-24`.
- Scope: exact guarded Integration Workspace rollout and recovery for the immutable 2026-07-23 TikTok Organic bootstrap incident.
- Production, Lark business writes, schedules, cleanup/delete operations and Google Ads PR #17 remain out of scope.

## Authoritative implementation

```text
PR #29 merged
implementation head e77633442cc48454df134c608bd4740254d43d2f
Branch Verification #342 / 30038029278 / PASS
merge commit 1fce94344100a6b1ed9dce471966f3596c00778a
operator PR #32 merged as dbe98d8dbfbb1c47dc6c3ad3c06a9cb56bb41264
partial Coverage validation hotfix PR #33 merged as 28922bdb38ae9fd2be512774225ce3fdf64cf5f2
runbook alignment PR #34 merged as 01c8bca0c0bb55e44369ce737f77b82c0efe04ab
```

Exact operator runbook:

```text
docs/runbooks/tiktok-organic-bootstrap-durable-recovery.md
```

## Authenticated Integration Workspace evidence

Read-only preflight passed with the immutable incident identity and exact durable facts:

```text
organic_content_state = 1309
organic_content_observations = 1000
data_coverage_entities = 1000
Work = active
write phase nextSequence = 2
write phase unitsCompleted = 2
write phase durable counters = 1000
DLQ = open / QUEUE_RETRY_EXHAUSTED
lock = expired
Coverage = partial / expected 2021 / summary observed 0 / 0 / failed 0 / completed_at null
```

Remote D1 backup passed:

```text
backup_file = social-mkt-state-dev-before-0010-20260724T031853642Z.sql
backup_sha256 = 6e6b7d8bb57e63da78b3888f39b95db4f50f4d5e0eb891699d598beb98b4e58b
```

The ignored operator evidence remains on the authenticated machine under:

```text
outputs/tiktok-durable-recovery/exact-2026-07-23/
```

## Migration 0010 first attempt — stopped before Remote apply

The first guarded migration command failed during Wrangler argument parsing:

```text
wrangler = 4.110.0
rejected_argument = --skip-confirmation
error = Unknown arguments: skip-confirmation, skipConfirmation
```

Wrangler rejected the command before applying any migration. No `migrate.json` passed evidence was created, the evidence chain did not advance and no Worker deployment or Queue send was attempted.

Cloudflare's Wrangler 4.110 migration apply contract has no `--skip-confirmation` option. Non-interactive or CI execution skips the prompt while still capturing Wrangler's migration backup. The operator hotfix removes only the unsupported argument and sets `CI=true` only for the migration apply subprocess. All pre-apply backup/checksum and exact pending-migration gates remain mandatory.

## Current execution status

```text
REMOTE_D1_PREFLIGHT = passed
REMOTE_D1_BACKUP = passed
REMOTE_MIGRATION_0010 = not applied; first command stopped at CLI parsing
WORKER_DEPLOYMENT = not run
QUEUE_MESSAGE = not sent
LIVE_RECOVERY = not executed
LARK_BUSINESS_WRITE = none
SCHEDULE_CHANGE = none
PRODUCTION_CHANGE = none
GOOGLE_ADS_PR_17 = draft / hold
```

## Prepared safeguards

- exact incident identity is embedded in code and payload printer;
- Migration `0010` is additive only;
- read-only identity/fact preflight passed before any write attempt;
- backup and SHA-256 passed and must be revalidated before retry;
- pending migration set must be exactly Migration `0010`;
- post-migration business facts must remain `1309 / 1000 / 1000`;
- deploy requires all schedules false;
- recovery requires one exact initial Queue message;
- Worker-owned continuations process at most one source Unit per invocation;
- final proof requires 2,021 State, Observation and Coverage entities, zero duplicates, complete Coverage, completed original Work and retained/redriven exact DLQ;
- exact replay must leave business facts unchanged;
- rollback is flag-only and non-destructive.

## Remaining operator evidence

```text
migration_0010_apply = pending
post_migration_schema = pending
post_migration_counts = pending
deployed_worker_version = pending
schedule_flags = pending
initial_queue_response = pending
unit_3_checkpoint = pending
unit_4_checkpoint = pending
unit_5_checkpoint = pending
final_work_proof = pending
final_coverage_proof = pending
final_dlq_proof = pending
final_duplicate_checks = pending
idempotent_replay_proof = pending
lark_business_writes = pending
```

## Stop-on-mismatch rule

Any mismatch remains a hard stop. Do not delete or rewrite the 309 partially durable State rows, create a new operation/generation, manually alter Work/checkpoint/DLQ state, enable schedules or proceed to Production.
