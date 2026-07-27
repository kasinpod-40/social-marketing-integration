# Current Task — YouTube Worker Dry-run Rollout Operator

## Authoritative status

```text
TASK_STATUS                 = PASS_FOR_REVIEW
CURRENT_PROGRAM             = YOUTUBE_WORKER_DRY_RUN_ROLLOUT_OPERATOR
BASE_MAIN_SHA               = 1ec60980c3897f01cef9bdc5f24aa6f5b7eba295
BRANCH                      = integration/youtube-worker-dry-run-rollout-operator
REMOTE_ACTION_AUTHORIZED    = false
REMOTE_ACTIONS              = NONE
PRODUCTION                  = BLOCKED
```

The prior TikTok sanitized error-code Hotfix task is preserved verbatim at:

```text
docs/archive/current-task-before-youtube-worker-dry-run-rollout-operator-2026-07-27.md
```

## Objective

เพิ่ม guarded rollout operator สำหรับ YouTube Worker dry-run ที่ผูก intent กับ Stable Queue
operation โดยไม่ใช้ Cloudflare delivery `message.id` เป็น durable identity พร้อม evidence chain,
exact Git provenance, one-message rule, scoped operational snapshots และ independently callable
safe restore.

## In scope

- Conditional Stable Queue contract สำหรับ `youtube_worker_dry_run`
- Dedicated YouTube router identity และ fail-closed dry-run boundary
- Shared Queue helper สำหรับสร้าง Job identity
- ข้าม unrelated warning drain และ expired-work cleanup เฉพาะ Operator dry-run
- Sanitized dry-run write outcomes และ operational mutation summary
- Plan-only-by-default rollout operator และ exact confirmation ต่อ phase
- Local/injected command tests สำหรับ deployment, Queue send, verification และ restore
- Scoped SQL builders/validators สำหรับ before/after evidence
- Documentation, tests, package scripts และ Draft PR

## Out of scope

```text
Worker deploy/version upload/rollback
Remote Worker flag or binding mutation
Remote D1 read/write/migration
YouTube/Analytics/OAuth request
Lark API request or record write
Queue send/Ack/Retry/DLQ action
Cron/Schedule activation
Secret mutation
Customer or Production LIVE UAT
Production
PR merge
```

## Architecture contract

- Extend the central Job/Queue identity contract; do not create a parallel catalog.
- Reuse the Shared Queue/DLQ router, Queue operation store, Reliability runner and distributed lock.
- Reuse the existing D1 resumable work/generation fence, history/Coverage and checkpoint stores.
- Reuse the existing YouTube clients/adapters/normalizers and `TableSyncEngine`.
- The operator is an orchestration and validation layer only.

## Stable Queue identity contract

```text
type                 = youtube.channel.organic.sync
trigger              = youtube_worker_dry_run
dryRun               = true
operationId          = explicit safe identifier
workKey              = youtube:{operationId}
generation           = originalRequestedAt
requestedAt          = ISO(originalRequestedAt)
durable delivery ID  = operationId/workKey, never message.id
syncRunId            = youtube-dry-run:{operationId}
```

Normal scheduled or legacy YouTube jobs that do not use this trigger keep their existing behavior.

## Dry-run side-effect contract

Allowed:

- public YouTube Data API GET;
- Lark GET-only planning;
- D1 checkpoint read;
- `sync_runs`, `sync_locks`, Queue attempt, resumable work/generation fence and reliability mirror
  operational mutations;
- normal Main Queue Ack/Retry classification.

Forbidden:

- YouTube Analytics and OAuth refresh;
- Lark record writes;
- Organic business state/observation/account daily facts;
- Coverage writes;
- incremental checkpoint writes;
- schedule changes or automatic Provider resend.

Operator dry-run skips pending warning drain and global expired-work cleanup.

## Operator phases

```text
plan
preflight
deploy-safe-baseline
verify-safe-baseline
deploy-dry-run-gates
verify-deployment
snapshot-operational-state
send-one-dry-run
verify-dry-run
restore-all-false
verify-restore
summary
```

Every executable phase requires a distinct exact confirmation and validates prior evidence,
contract version, repository head, target fingerprint and operation identity.

## Config/flag matrix

True only during the dry-run window:

```text
MKT_CONNECTOR_YOUTUBE_ENABLED=true
MKT_YOUTUBE_END_TO_END_ENABLED=true
```

All YouTube Business-write, Analytics, Report, Retention and Schedule gates remain false.
Meta, WooCommerce, TikTok guarded flags and unrelated Connector/Schedule gates remain false.
CLI `--var` overrides are forbidden.

## Operational mutation allowlist

```text
sync_runs
sync_locks
queue_operation_attempts
sync_work_runs
sync_work_phases
sync_work_units
sync_generation_fences
reliability_mirror_outbox
operation-scoped system_alerts only
```

## Forbidden Business mutations

```text
organic_content_state
organic_content_observations
organic_account_daily_facts
data_coverage_runs
data_coverage_entities
sync_cursors
source_record_states
YouTube Lark target records
```

## Acceptance criteria

- Operator-controlled YouTube dry-run uses Stable operation identity independent of delivery ID.
- Same operation and generation replay completed work without another Provider request.
- Different operation ID creates new work; identity drift fails before Provider access.
- Operator dry-run has zero Business/Coverage/checkpoint/Lark writes and zero Analytics/OAuth.
- Warning drain and expired-work cleanup are skipped only for the Operator path.
- Operator defaults to plan-only, sends at most one originated Queue message and never auto-resends.
- Deployment messages contain the exact full Git SHA and phase.
- Evidence is sanitized, chained and target/head/operation bound.
- Post-activation failure produces an explicit independent restore instruction without hiding failure.
- Existing routes and non-Operator YouTube behavior remain unchanged.

## Required tests

- Stable Queue identity and delivery-ID independence
- Integrated Queue dry-run/replay/Ack/Retry/DLQ classification
- Zero Business/Coverage/checkpoint/Lark write assertions
- Lark planning GET and public Provider GET allowance
- No Analytics/OAuth, warning drain or cleanup
- Operator plan/confirmation/config/provenance/evidence/one-send/restore tests
- Non-YouTube route-order and legacy YouTube regressions
- Full repository gates from `AGENTS.md`

## Implementation result

```text
IMPLEMENTATION_RESULT       = PASS_FOR_REVIEW
REVIEWED_HEAD               = ff140b090aa846fdad70847560159931e032118f
REVIEW_DECISION             = BLOCKERS_REMEDIATED; READY_FOR_REVIEW
REVIEW_BLOCKERS             = 8/8 addressed in repository implementation
FOCUSED_TESTS               = PASS (69/69)
UNIT_TESTS                  = PASS (1028/1028)
WORKERS_RUNTIME_TESTS       = PASS (11/11)
REPORT_RELIABILITY_TESTS    = PASS (91/91)
NPM_CI                      = PASS
NPM_CHECK                   = PASS (285 source files; 760 dependencies; 0 cycles)
DEPENDENCY_AUDIT            = PASS (0 vulnerabilities)
DEPLOY_DRY_RUN              = PASS (wrangler.example.jsonc + wrangler.sync.example.jsonc)
LIVE_VALIDATION             = NOT_RUN (repository-only authorization)
REMOTE_ACTION_COUNT         = 0
DRAFT_PR_REQUIRED           = true
```

### Blocker resolution

1. Restore อ่าน active version ก่อนเสมอ, no-op บน safe baseline, deploy ได้เฉพาะ exact
   attempted dry-run version ที่มี SHA/phase evidence และ block concurrent version.
2. Verification ใช้ terminal Sync/Work fields, completion JSON, released lock และ zero DLQ;
   terminal non-success ล้มทันที.
3. Evidence ทุก phase มี canonical SHA-256 และ prior hash; sequence validator ปฏิเสธ tamper,
   skip, reorder และ head/target/operation drift รวม recovery chain.
4. Workers runtime test ใช้ migrations และ D1 Reliability/Resumable/History/Checkpoint storesจริง;
   mock เฉพาะ external YouTube/Lark transports.
5. Dry-run completion replay คง warnings/reconciliation/source summary, บังคับ
   `checkpointSaved=false`, ไม่สร้าง/drain warning outbox และ Provider replay เท่ากับศูนย์.
6. Remote verifier parse/validate Worker versions, deployment traffic, Queue consumers และอ่าน
   Cron/routes/workers.dev จาก Cloudflare read-only endpoints; local config เป็น expected contract.
7. `new_execution` ต้องผ่าน operation-scoped empty guard; `replay_verification` ต้องเป็น completed
   operation และตรวจ Provider count ตาม mode.
8. Task, Project Brain, README และ CHANGELOG ระบุสถานะ Repository-only ตามผลจริง.

### Commands run

```text
npm ci
node --test <6 focused YouTube/operator/reliability test files>  # 69/69
npm run check
npm test                                                       # 1028 + 11
npm run test:report-reliability                                # 91/91
npm audit --audit-level=high                                   # 0 vulnerabilities
npm run deploy:dry-run                                         # both configs pass
git diff --check
```

### Remaining risk / handoff

- ยังไม่ได้ทดลอง Remote response จริง; parser ใช้ Wrangler 4.110.0/Cloudflare contract fixtures
  และ fail closed เมื่อ schema/state ไม่ครบ.
- ไม่มี Worker deploy, Remote D1, Queue, Provider, Lark, migration, schedule หรือ Production action.
- PR #101 ต้องคง Draft และต้องได้รับ review ก่อนอนุญาต Runtime phase แยกต่างหาก.
