# Current Task — TikTok Organic Post-Lark Merge Closeout & Rollout Gate

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_MERGED_ROLLOUT_NOT_AUTHORIZED
CURRENT_PROGRAM                     = TIKTOK_ORGANIC_POST_LARK_DAILY_PIPELINE_AND_REPORT_D1_PARITY
MERGED_PR                           = #65
MERGE_COMMIT                        = acb0b76bb3be936319e0e8bed4849592c96761b5
REVIEWED_HEAD                       = 5d596d78753f29284667853c46fe87865701ff7e
FINAL_BRANCH_VERIFICATION           = #522 PASS
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
CUSTOMER_KEY                        = chemistry_k
ACCOUNT_KEY                         = chemistry_k
SOURCE_HANDLE                       = chemistry_k
SOURCE                              = lark_native_tiktok_for_creator
LARK_NATIVE_SYNC_TIME               = approximately 07:00 Asia/Bangkok
SNAPSHOT_DATE_CONTRACT              = previous_completed_day
REMOTE_MIGRATION_0016               = NOT_APPLIED
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
SCHEDULES                           = DISABLED
RETENTION_DELETE                    = PROHIBITED
LIVE_UAT                            = NOT_RUN
PRODUCTION                          = BLOCKED
```

## Result

PR `#65` was Squash Merged into `main` at
`acb0b76bb3be936319e0e8bed4849592c96761b5` after the final reviewed head
`5d596d78753f29284667853c46fe87865701ff7e` passed Branch Verification `#522`.

The merged implementation provides a fail-closed TikTok Organic post-Lark path that:

- reads the protected Lark Native TikTok RAW source without mutating it;
- derives a deterministic compact source watermark from bounded source state;
- requires two identical probes before admitting new work;
- creates one logical admission per account, watermark and completed Snapshot date;
- reuses the existing Durable staging, Reliability, Queue/DLQ, D1 history, Coverage and Canonical Lark contracts;
- verifies the exact staged watermark before the first Business write;
- supports more than 800 TikTok Content identities from D1 historical observations;
- preserves missing `null`, observed zero and cumulative correction semantics;
- compares Lark-primary and D1-shadow Report results deterministically;
- blocks D1-primary cutover on incomplete Coverage or parity mismatch;
- admits a Daily Report only after the corresponding processing and Coverage complete;
- uses the previous completed Asia/Bangkok day for scheduled Snapshot and Report boundaries.

No second TikTok connector, Reliability engine, Queue framework, D1 history writer,
Canonical writer, Lark sync engine or Report formula engine was introduced.

## Retained verified Live facts

```text
RAW_TikTok_Creator_Videos             approximately 2021 / protected Lark Native source
organic_content_state                 2021
organic_content_observations          2021
data_coverage_entities                2021
D1 duplicate State groups             0
D1 duplicate Observation groups       0
MKT_Content last verified             22
MKT_Content_Daily last verified       208
```

These are retained historical facts, not a new freshness claim. Any new count, freshness,
Coverage or parity claim requires the guarded read-only audit and external evidence.

The complete pre-Merge implementation task is preserved at:

```text
docs/archive/current-task-before-tiktok-post-lark-parity-merge-2026-07-26.md
```

Detailed architecture and implementation evidence remain at:

```text
docs/project-brain/tiktok-organic-post-lark-d1-parity-2026-07-26.md
docs/project-brain/tiktok-post-lark-parity-merge-closeout-2026-07-26.md
```

## Merged contracts

### Protected source and identity

```text
customerKey=chemistry_k
accountKey=chemistry_k
sourceHandle=chemistry_k
source=lark_native_tiktok_for_creator
```

`RAW_TikTok_Creator_Videos` remains read-only. The Worker must not mutate its Table,
Fields, Views, Formula, Filter or Records.

### Date contract

```text
metricDate = local scheduled date - 1 day
Daily report periodEnd = the same completed day
```

### Pipeline contract

```text
Lark Native TikTok sync approximately 07:00
→ bounded read-only RAW probes
→ stable new source watermark
→ durable same-watermark admission
→ existing Durable source staging
→ exact staged-watermark fence
→ full-unit preflight
→ existing D1 Observation / State / Coverage
→ existing Canonical Lark writer
→ completed Coverage re-read
→ idempotent Daily Report request
→ Lark-primary + D1-shadow or D1-primary Report calculation
→ bounded Lark metadata hydration
→ existing Lark Report output
→ optional deterministic D1 materialization
```

### Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
```

Storage and Report flags do not implicitly enable schedules.

## Verification result

Final Branch Verification `#522` passed on the reviewed PR head:

```text
Install locked dependencies          PASS
Syntax / architecture / hygiene      PASS
Focused staged TikTok tests          4 / 4 PASS
Node Unit / Integration tests        868 / 868 PASS
Workers runtime tests                9 / 9 PASS
Report reliability regression        91 / 91 PASS
Dependency audit                     0 vulnerabilities
Wrangler deployment dry-run          PASS / no deployment
Diagnostics upload                   PASS
```

The branch was mergeable, was `behind_by=0`, and had no unresolved Review thread or
Requested Changes at Merge time.

## Safety closeout

PR `#65` and this documentation closeout did not perform:

```text
Remote D1 backup or Migration 0016 apply    NOT RUN
Worker deployment                           NOT RUN
Queue send                                  NOT SENT
DLQ redrive/delete                          NOT RUN
Recovery                                    NOT RUN
Remote Lark schema/data mutation            NONE
Remote D1 Business mutation                 NONE
Schedule enablement                         NONE
Retention/delete                            NONE
LIVE UAT                                    NOT RUN
Production                                  BLOCKED
Google Ads runtime-state change             NONE
```

## Next separately approved rollout gate

Merge does not authorize Live execution. The next rollout must remain bounded, manual and
schedule-disabled in this exact order:

1. read-only Remote configuration and schema preflight;
2. Remote D1 backup;
3. additive Migration `0016` apply;
4. flags-false Worker deployment and route smoke;
5. guarded read-only RAW/D1/Canonical audit;
6. manual freshness probe;
7. one new-watermark processing admission;
8. D1/Canonical/Coverage reconciliation;
9. Lark-primary + D1-shadow parity;
10. exact same-watermark rerun with zero Business drift;
11. D1-primary Report validation with an immediate Lark-primary rollback path;
12. only then propose controlled schedule activation.

Every Remote migration, deployment, Queue send, Business write, LIVE UAT and schedule step
requires a separate explicit approval. Parallel Meta, YouTube, Chatwoot and WooCommerce
Workstreams must not perform these Integration-runtime actions.
