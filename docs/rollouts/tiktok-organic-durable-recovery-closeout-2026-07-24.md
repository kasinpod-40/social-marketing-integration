# TikTok Organic Durable Recovery Rollout Closeout — 2026-07-24

## Decision

```text
ROLLOUT_DECISION                    = PASS
TIKTOK_ORGANIC_BOOTSTRAP            = COMPLETE
DURABLE_RECOVERY                    = COMPLETE
COMPLETION_CLOSURE                  = COMPLETE
SAME_GENERATION_REPLAY              = PASS
BUSINESS_FACT_DRIFT                 = FALSE
LARK_BUSINESS_WRITES                = 0
SCHEDULES                           = DISABLED
PRODUCTION                          = BLOCKED
```

This document is the sanitized repository closeout for the Integration Workspace rollout. Local operator evidence remains outside source under `outputs/tiktok-durable-recovery/exact-2026-07-23`.

## Scope

In scope:

- recover the interrupted TikTok Organic D1-only bootstrap for the exact original generation;
- retain and repair partial State/Observation/Coverage facts without deletion;
- close the original DLQ with durable Work and Coverage proof;
- correct the D1 observation-read bind defect;
- correct Cloudflare auth isolation in operators;
- recover the terminalized exact Work safely;
- correct completed-work closure ordering/verification;
- perform one exact same-generation replay and prove idempotency.

Out of scope:

- Lark Canonical backfill;
- Report D1 reader or shadow-read cutover;
- Lark retention/delete;
- any schedule enablement;
- Production deployment;
- Google Ads connector implementation;
- generic DLQ cleanup.

## Target

```text
Environment       development
Profile           integration_workspace
Worker            social-mkt-sync-worker
D1                social-mkt-state-dev
Main Queue        social-mkt-sync-jobs
DLQ               social-mkt-sync-dlq
Customer key      chemistry_k
Account key       chemistry_k
Source handle     chemistry_k
Timezone          Asia/Bangkok
```

## Immutable incident

```text
requested_at              1784829780000
operation_id              f59b852f00634005c7ff4da51afee964
work_key                  tiktok:f59b852f00634005c7ff4da51afee964
cursor_key                integration_workspace:tiktok:chemistry_k:organic_history_bootstrap
generation                1784829780000
original_dlq              dlq:8d1b9077657385a417cb32a0ed3114cb
failed_recovery_dlq       dlq:06f7660b796808ebca3b8cd2e7780894
terminal_closure_dlq      terminal:a90a4dbf2f281124d40601f2f7799a90
coverage_run              coverage:tiktok:d398495edc3b070b815f99559ecce1a2f24f4c9ac4e0335810e287636fc2f2e0
```

## Protected backup and migrations

Before applying the recovery migration, the remote D1 database was exported.

```text
backup_file   social-mkt-state-dev-before-0010-20260724T031853642Z.sql
sha256        6e6b7d8bb57e63da78b3888f39b95db4f50f4d5e0eb891699d598beb98b4e58b
```

Remote migrations confirmed in the completed rollout:

```text
0009_storage_foundation.sql                 applied
0010_tiktok_bootstrap_durable_recovery.sql  applied
```

No destructive migration, table drop or business-fact cleanup was used.

## Failure sequence and fixes

### Interrupted bootstrap

The original durable checkpoint stopped after two completed write units:

```text
nextSequence                 2
unitsCompleted               2
rawRecordsCompleted          1000
contentRowsDurable           1000
observationRowsDurable       1000
coverageEntitiesWritten      1000
```

A partial Unit 3 had already produced 309 additional State rows. Those rows were retained.

### D1 observation-read failure

Recovery retries failed with `D1_ORGANIC_OBSERVATION_READ_FAILED`. Diagnosis proved a 101-bind D1 statement: 100 content keys plus `observed_at`. The bounded read was corrected to 99 keys plus `observed_at`.

### Cloudflare authentication isolation

Guarded D1 commands require Wrangler OAuth while the Queue HTTP push requires an API token. Operators now clone the environment and remove only `CLOUDFLARE_API_TOKEN` from Wrangler subprocesses, preserving the parent token for the exact Queue push.

### Terminal Work recovery

After Queue retry exhaustion, the exact Work was terminal. An incident-specific two-phase operator:

1. verified exact terminal evidence and reactivated one Work row without business mutation;
2. required passed reactivation evidence and sent the existing exact recovery payload once.

### Completion-closure defect

The final business unit completed all D1 facts and Coverage. `completeWork()` then removed temporary phase/unit rows before `markTikTokBootstrapIncidentRecovered()` attempted to read the phase, causing `TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE` and terminalizing an already-completed Work.

The completion-closure hotfix:

- validates completion from retained `completion_json` and Coverage when completed-work cleanup has removed phase rows;
- prevents Queue failure handling from reversing an already-completed Work;
- provides guarded deploy, repair, verify, replay and replay-verify phases.

The repair changed only Work/DLQ operational metadata. It changed no Organic or Coverage business facts.

## Final proof

```text
organic_content_state                     2021
organic_content_observations              2021
initial_observations                      2021
data_coverage_entities                    2021
state_duplicate_groups                    0
observation_duplicate_groups              0
work_status                               completed
work_generation                           1784829780000
work_requested_at                         1784829780000
work_completed_at                         1784880407927
completion_next_sequence                  5
completion_content_rows_durable           2021
completion_observation_rows_durable       2021
completion_coverage_entities_written      2021
coverage_status                           complete
coverage_expected_entities                2021
coverage_observed_entities                2021
coverage_expected_rows                    2021
coverage_observed_rows                    2021
coverage_failed_rows                      0
coverage_completed_at                     1784880407496
lark_content_writes                       0
lark_daily_writes                         0
unexpected_terminal_failures              0
main_queue_attempts_after_replay           10
business_fact_drift                       false
```

## DLQ result

```text
original DLQ          redriven / recovery completed
terminal closure DLQ  redriven / closure completed
failed-recovery DLQ   open / retained forensic evidence
```

The open failed-recovery DLQ is intentional. It records the exhausted pre-fix recovery path and must not be deleted or redriven as routine cleanup.

## Deployment safety state

Enabled:

```text
MKT_CONNECTOR_TIKTOK_ENABLED
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_TIME_SERIES_D1_BACKFILL_ENABLED
```

Disabled:

```text
MKT_SCHEDULE_TIKTOK_ENABLED
MKT_SCHEDULE_YOUTUBE_ENABLED
MKT_SCHEDULE_DAILY_REPORT_ENABLED
MKT_SCHEDULE_WEEKLY_REPORT_ENABLED
MKT_REPORT_D1_SHADOW_READ_ENABLED
MKT_REPORT_D1_READ_ENABLED
MKT_LARK_DAILY_RETENTION_ENABLED
MKT_NOTIFICATION_RUNTIME_ENABLED
MKT_DLQ_REDRIVE_ENABLED
```

The completion-closure deployment used repository head:

```text
870ac618c75e3d9efa1fd1e20ea3618b56f8aceb
```

## Operator evidence

Guarded phases that passed:

```text
terminal-reactivate
terminal-resume
completion-closure-deploy
completion-closure-repair
completion-closure-verify
completion-closure-replay
completion-closure-replay-verify
```

The exact replay was sent once and accepted by the Queue API with HTTP 200. Replay verification proved no change to durable business facts.

## Do not rerun

The following exact-incident actions are complete and must not be repeated:

```text
recovery send
terminal resume
completion-closure repair
same-generation replay
manual business-fact SQL
DLQ cleanup/delete
```

## Handoff

```text
CURRENT_TASK             TIKTOK_ORGANIC_DURABLE_RECOVERY_ROLLOUT_COMPLETE
NEXT_TASK                GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_CONNECTOR_PLANNING
GOOGLE_ADS_PR_17         DRAFT_HOLD
SCHEDULES                DISABLED
PRODUCTION               BLOCKED
```

The next task is separate. It begins with a full current-codebase review and a new approved contract; it does not inherit permission to deploy, schedule or merge Draft PR #17.
