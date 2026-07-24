# Current Task — TikTok Organic Bootstrap Durable Recovery Rollout Closeout

## Status

```text
TASK_STATUS                         = ROLLOUT_COMPLETE
CLOSED_AT                           = 2026-07-24
INTEGRATION_WORKSPACE               = development / integration_workspace
TIKTOK_ORGANIC_D1_BOOTSTRAP         = PASS
DURABLE_RECOVERY                    = PASS
COMPLETION_CLOSURE                  = PASS
SAME_GENERATION_REPLAY              = PASS
BUSINESS_FACT_DRIFT                 = FALSE
LARK_BUSINESS_WRITE                 = 0
SCHEDULES                           = DISABLED
PRODUCTION                          = BLOCKED
GOOGLE_ADS_PR_17                    = DRAFT_HOLD
RUNTIME_ACTION_REQUIRED             = NONE
```

This file records the completed Integration Workspace rollout. It does not authorize another recovery, replay, cleanup, schedule change, Lark Canonical write or Production action.

## Authoritative runtime identity

```text
MKT_ENV                    = development
MKT_CUSTOMER_PROFILE       = integration_workspace
customerKey                = chemistry_k
accountKey                 = chemistry_k
sourceHandle               = chemistry_k
reportingTimezone          = Asia/Bangkok
Worker                     = social-mkt-sync-worker
D1                         = social-mkt-state-dev
Main Queue                 = social-mkt-sync-jobs
DLQ                        = social-mkt-sync-dlq
```

Production remains customer-owned and separate.

## Immutable incident identity

```text
original_requested_at      = 1784829780000 / 2026-07-23T18:03:00Z
operation_id               = f59b852f00634005c7ff4da51afee964
work_key                   = tiktok:f59b852f00634005c7ff4da51afee964
cursor_key                 = integration_workspace:tiktok:chemistry_k:organic_history_bootstrap
generation                 = 1784829780000
original_dlq_id            = dlq:8d1b9077657385a417cb32a0ed3114cb
failed_recovery_dlq_id     = dlq:06f7660b796808ebca3b8cd2e7780894
terminal_closure_dlq_id    = terminal:a90a4dbf2f281124d40601f2f7799a90
coverage_run_id            = coverage:tiktok:d398495edc3b070b815f99559ecce1a2f24f4c9ac4e0335810e287636fc2f2e0
```

## Final verified D1 result

```text
organic_content_state                     = 2021
organic_content_observations              = 2021
initial_observations                      = 2021
data_coverage_entities                    = 2021
state_duplicate_groups                    = 0
observation_duplicate_groups              = 0
work.lifecycle_status                     = completed
work.generation                           = 1784829780000
work.requested_at                         = 1784829780000
work.completed_at                         = 1784880407927
completion.nextSequence                   = 5
completion.rawRecords                     = 2021
completion.d1.contentRowsDurable          = 2021
completion.d1.observationRowsDurable      = 2021
completion.d1.coverageEntitiesWritten     = 2021
coverage.status                           = complete
coverage.expected_entities                = 2021
coverage.observed_entities                = 2021
coverage.expected_rows                    = 2021
coverage.observed_rows                    = 2021
coverage.failed_rows                      = 0
coverage.completed_at                     = 1784880407496
completion.lark.contentWrites             = 0
completion.lark.dailyWrites               = 0
completion.lark.blocked                   = true
main_queue_attempts_after_exact_replay     = 10
unexpected_terminal_failures              = 0
business_fact_drift_after_replay           = false
```

`sync_work_phases` and `sync_work_units` are zero after completed-work cleanup. Durable completion proof is retained in `sync_work_runs.completion_json` and the Coverage tables.

## DLQ and audit result

```text
original_dlq.status                = redriven
original_recovery.status           = completed
original_recovery.reference        = recovery:dlq:8d1b9077657385a417cb32a0ed3114cb:tiktok:f59b852f00634005c7ff4da51afee964
terminal_closure_dlq.status        = redriven
terminal_closure_recovery.status   = completed
terminal_closure.reference         = closure:terminal:a90a4dbf2f281124d40601f2f7799a90:tiktok:f59b852f00634005c7ff4da51afee964
failed_recovery_dlq.status         = open
```

The failed-recovery DLQ remains open as retained forensic evidence. It must not be deleted, redriven or normalized as routine cleanup.

## Completed rollout sequence

1. Read-only Remote D1 preflight passed.
2. Remote D1 export completed before Migration `0010`.
3. Backup file: `social-mkt-state-dev-before-0010-20260724T031853642Z.sql`.
4. Backup SHA-256: `6e6b7d8bb57e63da78b3888f39b95db4f50f4d5e0eb891699d598beb98b4e58b`.
5. Remote Migration `0010_tiktok_bootstrap_durable_recovery.sql` applied and verified.
6. Worker was deployed with TikTok/D1 write/backfill enabled and every schedule/report-reader/retention/notification/redrive flag disabled.
7. Exact recovery resumed the original generation without deleting partial business facts.
8. The 101-bind D1 observation-read defect was fixed and redeployed.
9. Cloudflare OAuth/API-token isolation was added for guarded operators.
10. Terminal Work was reactivated through an exact incident-specific guarded operator.
11. Exact recovery Queue resume was accepted once; it must never be sent again.
12. Business facts reached 2,021/2,021/2,021 with Coverage complete and zero duplicate groups.
13. Completion-closure defect was diagnosed: completed-work cleanup removed phase rows before the incident verifier read them.
14. Completion-closure hotfix was deployed.
15. Exact operational repair restored Work and DLQ metadata without changing business facts.
16. Read-only final verification passed.
17. Exact same-generation replay was accepted once.
18. Replay verification passed with `businessFactDrift=false`.

## Repository implementation chain

| PR | Purpose | Merge commit |
| --- | --- | --- |
| #29 | Durable TikTok bootstrap recovery implementation | `1fce94344100a6b1ed9dce471966f3596c00778a` |
| #37 | Guarded deploy/resume operator | `9c1f4e17a1addcd94422e4e840300856a3cff15c` |
| #38 | Cloudflare auth isolation | `7970b8d707650150af548684defac6ccb74c7c33` |
| #39 | Exact terminal Work reactivation/resume | `cfed6355b1db426c271235572522a6e751b4e808` |
| #40 | Completion-closure and replay safety | `870ac618c75e3d9efa1fd1e20ea3618b56f8aceb` |

Supporting PRs #30–#36 contain the rollout documentation, evidence contract, guarded CLI and intermediate corrections. Their exact commits remain available in Git/PR history. The final deployed source head for completion closure is `870ac618c75e3d9efa1fd1e20ea3618b56f8aceb`.

## Local rollout evidence set

```text
terminal-reactivate.json
terminal-resume.json
completion-closure-deploy.json
completion-closure-repair.json
completion-closure-verify.json
completion-closure-replay.json
completion-closure-replay-verify.json
```

Evidence root used by the guarded operators:

```text
outputs/tiktok-durable-recovery/exact-2026-07-23
```

The `outputs/` evidence is local operational material and must not be added to source releases unless a separate sanitized evidence policy approves it.

## Final acceptance

- [x] Original generation and Work identity preserved.
- [x] Existing partial State rows preserved.
- [x] Missing initial Observations repaired exactly once.
- [x] State, Observation, initial Observation and Coverage entity counts equal 2,021.
- [x] Duplicate State/Observation groups equal zero.
- [x] Coverage expected=observed=2,021 and failed=0.
- [x] Work lifecycle is `completed`.
- [x] Original DLQ is retained and marked `redriven` with completed recovery metadata.
- [x] Terminal completion-closure DLQ is retained and marked `redriven` with completed closure metadata.
- [x] Failed-recovery DLQ remains retained as forensic evidence.
- [x] Exact same-generation replay changes no durable business facts.
- [x] Lark business writes remain zero.
- [x] Schedules remain disabled.
- [x] Production remains blocked.

## Prohibited follow-up actions

Do not rerun any of the following for this incident:

```text
bootstrap send
recovery send
terminal resume
completion-closure repair
exact replay
manual SQL cleanup
DLQ deletion
business-fact deletion
Lark Canonical backfill
schedule enablement
```

A new incident requires a new immutable identity, new task, new evidence root and separate approval.

## Next task boundary

```text
CURRENT_TASK = TIKTOK_ORGANIC_DURABLE_RECOVERY_ROLLOUT_COMPLETE
NEXT_TASK = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_CONNECTOR_PLANNING
NEXT_TASK_STATUS = NOT_STARTED
GOOGLE_ADS_PR_17 = DRAFT_HOLD
SCHEDULES = DISABLED
PRODUCTION = BLOCKED
```

The next task must begin by reading `AGENTS.md`, this file, `PROJECT_BRAIN.md` and the relevant Google Ads/Storage contracts. It must not reuse or merge Draft PR #17 without a full current-codebase review and a new approved implementation scope.
