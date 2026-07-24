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
```

Exact operator runbook:

```text
docs/runbooks/tiktok-organic-bootstrap-durable-recovery.md
```

## Execution status

```text
REMOTE_EXECUTOR = unavailable in ChatGPT GitHub connector environment
LOCAL_WRANGLER_CONFIG = unavailable
CLOUDFLARE_AUTH = unavailable
REMOTE_D1_PREFLIGHT = not run
REMOTE_D1_BACKUP = not run
REMOTE_MIGRATION_0010 = not applied
WORKER_DEPLOYMENT = not run
QUEUE_MESSAGE = not sent
LIVE_RECOVERY = not executed
```

The GitHub connector can inspect and edit the Repository but cannot authenticate to the private Cloudflare account, execute Wrangler commands, export D1, deploy the Worker or push a Queue message. The available container also has no `gh`, no authenticated Wrangler session, no repository checkout and no ignored `wrangler.sync.jsonc`; DNS access to GitHub/npm is unavailable. No Remote result is claimed.

## Prepared safeguards

- exact incident identity is embedded in code and payload printer;
- Migration `0010` is additive only;
- runbook requires read-only identity/fact preflight before any write;
- backup and SHA-256 are mandatory;
- pending migration set must be exactly Migration `0010`;
- post-migration business facts must remain `1309 / 1000 / 1000`;
- deploy requires all schedules false;
- recovery requires one exact initial Queue message;
- Worker-owned continuations process at most one source Unit per invocation;
- final proof requires 2,021 State, Observation and Coverage entities, zero duplicates, complete Coverage, completed original Work and retained/redriven exact DLQ;
- exact replay must leave business facts unchanged;
- rollback is flag-only and non-destructive.

## Required operator evidence

Populate only from an authenticated Integration Workspace machine:

```text
checked_out_main_sha = pending
wrangler_identity = pending
d1_info = pending
incident_preflight = pending
backup_file = pending
backup_sha256 = pending
pending_migrations = pending
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
