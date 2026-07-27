# YouTube Worker Dry-run Rollout Operator — 2026-07-27

## Verified repository decision

เพิ่ม guarded orchestration/validation layer บน Shared Queue, Reliability, D1 operational stores,
resumable-work/generation fence, YouTube flow และ `TableSyncEngine` เดิม ไม่มี Queue framework,
Reliability engine, connector, Lark engine หรือ Business writer ชุดใหม่.

```text
contract                  youtube-dry-run-rollout-v1
stable trigger            youtube_worker_dry_run
workKey                   youtube:{operationId}
syncRunId                 youtube-dry-run:{operationId}
generation                originalRequestedAt
delivery message.id       transport only
normal YouTube behavior   unchanged outside the trigger
```

## Runtime boundary

Operator pathรับเฉพาะ `development / integration_workspace / chemistry_k` และ YouTube
connector account `dev_ft_pumkin`. ก่อน Provider request จะปฏิเสธ operation identity drift,
non-dry-run, Analytics request, Business D1/Lark gates, YouTube schedule หรือ runtime identity
ที่ไม่ตรง.

Client factory ใช้ API-key public-only mode แม้ Environment จะมี OAuth Secrets:

```text
Public YouTube Data GET   allowed
Owner Analytics client   absent
OAuth refresh provider   absent
Lark planning GET         allowed
Lark record write         forbidden
```

Dry-run completes the existing resumable work so a delivery ID ใหม่ที่ใช้ operation เดิม
returns `already_completed` without another Provider request. Operation ID ใหม่สร้าง Work ใหม่.

## Mutation model

Dry-run is not zero-mutation. Allowed operational mutations:

```text
sync_runs / sync_locks
queue_operation_attempts
sync_work_runs / sync_work_phases / sync_work_units
sync_generation_fences
reliability_mirror_outbox
operation-scoped system_alerts
```

Forbidden:

```text
organic_content_state / organic_content_observations
organic_account_daily_facts
data_coverage_runs / data_coverage_entities
sync_cursors / source_record_states
YouTube Lark target records
Analytics requests / OAuth refresh
```

Operator dry-run ข้าม `drainPendingSyncWarnings` และ `cleanupExpiredWork`; non-Operator route
ยังคงทำสองขั้นนี้ตาม behavior เดิม.

## Rollout safety

Operator defaults to plan-only. ทุก Remote phaseใช้ exact confirmation แยกและ evidence chain
ผูก contract version, full Git SHA, target fingerprint และ operation. Deployment provenance:

```text
youtube-dry-run-rollout-v1 phase={phase} git={FULL_SHA}
```

Config comparator อนุญาตให้เปลี่ยนเฉพาะ YouTube connector/end-to-end gates false → true และ
ตรวจ bindings, Queue/DLQ consumers, Cron/routes/workers_dev, required mappings กับ Secret names.
One-message phaseสร้าง exclusive attempt marker ก่อนส่งจึงส่งได้หนึ่งครั้งแม้ command failure;
verify phaseส่งไม่ได้. Post-activation failure สร้าง
independent safe-restore instruction; restoreใช้ exact code/config และเปลี่ยนเฉพาะสอง gatesกลับ
false.

Evidence path `outputs/youtube-dry-run-rollout/` ถูก Git ignore. Evidence เก็บ sanitized hashes,
fingerprints, IDs และ countersเท่านั้น.

## Remote status

```text
Worker deploy/upload/rollback  NOT RUN
Remote D1 read/write/migrate   NOT RUN
YouTube/Lark API               NOT RUN
OAuth/Analytics                NOT RUN
Queue/DLQ                      NOT RUN
Schedules/Production           NOT RUN
```

Remote rollout, dry-run Queue message และ restore ยังต้องได้รับอนุญาตใหม่เป็นราย phaseหลัง PR
review/merge และ reviewed config พร้อม.
