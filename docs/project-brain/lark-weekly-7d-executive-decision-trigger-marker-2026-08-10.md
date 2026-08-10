# Fresh Weekly Executive Decision Trigger Marker Incident — 2026-08-10

## Incident

Fresh Weekly Executive Decision Preview for `2026-08-03..2026-08-09` passed Report freshness, metric-summary budget and status-vector budget, then created exactly one fresh AI Run row and wrote one Fresh-only failure-code marker.

The retained row stayed:

```text
generation_status      pending
insight_summary         empty
strengths               empty
weaknesses              empty
recommendations         empty
preview_mode            true
notification_eligible   false
sent_to_group           false
```

The execute observation timed out after 36 polls and a later poll-only recovery timed out after another 36 polls. No Queue admission, group message, Notification Automation activation, Schedule activation or Production action occurred.

## Root cause

The Fresh operator introduced this marker:

```text
CONTROLLED_WEEKLY_EXECUTIVE_DECISION_PREVIEW_V1
```

The existing Native AI Automation path had already been proven with the shared Full-channel Weekly marker:

```text
CONTROLLED_UAT_FULL_CHANNEL_AI_SYNTHESIS_V1
```

The Fresh workstream was required to reuse the existing AI Automation, not create or reconfigure a duplicate Automation. Therefore the Fresh-only marker was an incompatible trigger identity for the retained live Automation.

## Correction

Fresh Executive Decision Preview now aliases its trigger marker to the already-proven Full-channel Weekly Native AI trigger marker.

The Fresh-only marker remains recognized only as a legacy prepared-state compatibility value for the one already-retained pending row. An unrelated failure code still fails closed.

After merge, the retained row may run one guarded `--execute` compatibility correction. That run must reuse the same `ai_run_key`; it must not create a row. It replaces only `failure_code` with the proven shared marker and then observes Native AI generation.

After the shared marker is written, blind `--execute` retrigger remains forbidden. Any later observation uses `--recover` only.

## Safety

```text
new AI identity                 0
Notification admission         0
Lark group send                0
Queue admission                0
Worker deployment              0
Schedule activation            0
Production                     BLOCKED
persisted preview_mode         true
persisted notification_eligible false
persisted sent_to_group        false
```

Automatic Weekly Notification remains blocked until the generated Fresh Executive Decision passes the existing Decision Quality Gate and its message preview is reviewed.