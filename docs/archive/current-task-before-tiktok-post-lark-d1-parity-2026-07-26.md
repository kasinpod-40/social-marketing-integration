# Current Task — Google Ads Manager Script LIVE UAT Closeout

## Authoritative status

```text
TASK_STATUS                         = COMPLETE_SAFE_CLOSED
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
CLOSEOUT_DATE                       = 2026-07-26
INCIDENT_RUN_ID                     = 88351cb4-714d-49ef-91db-d95550a93ebf
WORK_KEY                            = google_ads:88351cb4-714d-49ef-91db-d95550a93ebf
GENERATION                          = 1785048890422
TRANSPORT_MODE                      = LIVE
TRANSPORT_CHUNKS                    = 7 / 7
TRANSPORT_ROWS                      = 1375 / 1375
ADMISSION_STATUS                    = completed
ADMISSION_SEND_ATTEMPTS             = 4
WORK_LIFECYCLE_STATUS               = completed
D1_ADS_ENTITY_ROWS                  = 1090
D1_ADS_DAILY_ROWS                   = 285
COVERAGE_RUNS                       = 6 / 6
COVERAGE_FAILED_ROWS                = 0
PAYLOAD_REDACTION                   = PASS
OPERATOR_VERIFY                     = PASS
SAFE_WORKER_VERSION                 = dcee150f-34cc-4a6f-aafa-5b52ece44093
SCRIPT_MODE                         = DRY_RUN
SCRIPT_DELIVERY_ENABLED             = false
GOOGLE_ADS_SCHEDULE                 = DISABLED
PRODUCTION                          = BLOCKED
```

## Objective

Record the final sanitized runtime evidence for the guarded Google Ads Manager Script LIVE UAT,
close the retained incident after exact recovery, and preserve the safe post-run boundary without
performing another Manager Script execution, Queue send, DLQ redrive, D1/Lark mutation, deployment,
schedule activation or Production cutover from this documentation task.

## Final runtime result

The original signed run was recovered from its retained staged transport payload. The Manager Script
was not rerun. The final operator verification returned `ok=true` and confirmed:

```text
mode                              LIVE
transport status                  assembling
expected / received chunks        7 / 7
expected / received rows          1375 / 1375
transport payload redacted        true
admission status                  completed
admission payload redacted        true
admission completed               true
work lifecycle                    completed
ads_entity_state rows             1090
ads_daily_facts rows              285
data_coverage_runs                6
```

`transport_status=assembling` is retained as the stored transport-state value. It does not invalidate
the closeout because chunk and row reconciliation are exact, both staged payload locations are
redacted, admission and durable work are completed, and the guarded operator accepted the row.

## Incident recovery progression

The same original run crossed three reviewed fail-closed boundaries before completing:

1. PR `#61` corrected `RAW_Ads_Daily.metric_date` serialization and guarded exact recovery from
   `failed_permanent`.
2. PR `#62` aligned Canonical Ads output with the already-applied Ads v2 Lark field contract.
3. PR `#63` aligned Campaign, Ad Group and Creative routing keys with the Canonical stable-key fields.

The exact retained terminal records are:

```text
FIRST_DLQ_ID      = terminal:a6ed54413000c25efd73ce7888cc2d10
FIRST_DLQ_STATUS  = redriven
SECOND_DLQ_ID     = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
SECOND_DLQ_STATUS = redriven
THIRD_DLQ_ID      = terminal:f909996a2e4985697f3e67feacfe7c69
THIRD_DLQ_STATUS  = redriven
```

All three records are retained forensic evidence. None may be redriven, deleted or reused again.

## Reconciliation result

```text
destination preflight             8 / 8 complete
D1 business operations            2756 / 2756 complete
account coverage                   1 / 1 / failed 0
campaign coverage                 58 / 58 / failed 0
ad-group coverage                 110 / 110 / failed 0
ad coverage                       760 / 760 / failed 0
YouTube asset coverage            161 / 161 / failed 0
campaign daily coverage           285 / 285 / failed 0
total source/business rows         1375
new open Google Ads terminal DLQ   0 at final controlled checks
```

Durable work completion occurred only after destination preflight, D1 Ads/Coverage processing and
Lark destination processing completed through the continuation workflow.

## Final safe runtime boundary

The guarded Recovery Window was closed by deploying the normal Sync configuration. Verified Worker
version:

```text
dcee150f-34cc-4a6f-aafa-5b52ece44093
```

Verified disabled flags:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_DLQ_REDRIVE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
```

The Worker still has the expected D1, main Queue and DLQ bindings. Cron triggers may remain attached
to the shared Worker, but Google Ads scheduling is disabled and cannot start this connector.

## Acceptance result

```text
original transport reconciled        PASS
same run recovered without rerun      PASS
admission completed                  PASS
durable work completed               PASS
D1 Ads facts written                 PASS
Coverage 6/6, failed rows 0           PASS
staged payload redaction              PASS
operator verification                 PASS
Recovery Window closed                PASS
all Google Ads execution flags false  PASS
Google Ads schedule disabled          PASS
Production remains blocked            PASS
```

## Documentation scope

This closeout changes documentation only. It must not change Source, Tests, dependencies, migrations,
Wrangler runtime configuration, D1, Queue/DLQ, Lark, Secrets, Manager Script properties, schedules or
Production resources.

## Permanent boundaries

- Do not rerun the completed Manager Script LIVE delivery.
- Do not redrive or delete any of the three retained terminal DLQ records.
- Do not reopen Lark Schema/View/Formula work for these incidents.
- Do not enable Google Ads Connector, ingress, Queue admission, D1/Lark writes, redrive or schedule
  without a separately approved task and a new bounded rollout plan.
- Keep the Manager Script at `DRY_RUN` with delivery disabled.
- Production remains a separate customer-owned rollout and is not authorized by this UAT.

## Next task boundary

```text
CURRENT_TASK_STATUS = COMPLETE_SAFE_CLOSED
NEXT_TASK            = SEPARATELY_APPROVED_WORK_ONLY
```

No additional Google Ads runtime action is required for this incident. The next implementation or
Production-planning task must be opened separately with its own scope, acceptance criteria and safety
gates.

## Archived predecessor

The complete pre-closeout task is preserved at:

```text
docs/archive/current-task-before-google-ads-live-uat-closeout-2026-07-26.md
```
