# Lark Native AI All-channel Preview Implementation v1

## Status

```text
WORKSTREAM                         = LARK_NATIVE_AI_ALL_CHANNEL_PREVIEW_IMPLEMENTATION_V1
BRANCH                             = implementation/lark-native-ai-all-channel-preview-v1
DRAFT_PR                           = 431
BASE                               = main
SUPERSEDES_DESIGN_PR               = 430
DESIGN_HEAD                        = 9cc04ce0c223877f43e32e2dd8eeba33ecc5b62f
CONTRACT_VERSION                   = report_to_lark_ai_v1
IMPLEMENTATION_MODE                = REPOSITORY_ONLY_PREVIEW_BUILDER
CHANNEL_SCOPE                      = ALL_EXPECTED_CHANNELS
WINDOW_SCOPE                       = 1D_3D_7D_30D
EXPECTED_PREVIEW_ROWS              = 40
LARK_NATIVE_AI_CALL                = 0
LARK_WRITE                         = 0
LARK_AUTOMATION                    = 0
GROUP_NOTIFICATION                 = 0
REMOTE_D1_QUEUE_WORKER_PROVIDER    = 0
PRODUCTION                         = BLOCKED
```

## Objective

Implement the machine-readable repository contract that prepares one Preview row for every expected channel plus one Executive row for each `1D / 3D / 7D / 30D` period.

The implementation does not call AI. It produces the exact bounded evidence and readiness rows that Lark Native AI will consume later.

```text
9 channel rows + 1 executive row per window
4 windows × 10 rows = 40 rows
```

Channels with validated Report evidence expose only Report values. Channels without Report evidence remain visible with a truthful readiness status and no fabricated metrics.

## Files

```text
docs/tasks/lark-native-ai-notification-v1.md
docs/project-brain/lark-native-ai-notification.md
packages/config/src/lark-native-ai-all-channel-contract.js
packages/application/src/reports/build-all-channel-ai-preview.js
tests/application/lark-native-ai-all-channel-preview.test.js
docs/tasks/lark-native-ai-all-channel-preview-implementation-v1.md
```

## Implemented contract

### Expected channel registry

```text
tiktok_organic
facebook_organic
instagram_organic
youtube_organic
meta_ads
google_ads
tiktok_ads
woocommerce
chatwoot
```

### Readiness states

```text
report_available
report_partial
no_data_confirmed
source_unavailable
not_observed
report_missing
configuration_missing
validation_failed
```

### Input authority

The builder accepts only validated Report bundles:

- Frozen `report_materialization` payload;
- exact Report ID and Report Setting key;
- Report Metric Value rows;
- Report Top Content rows;
- Report Top Ads rows.

No Raw, Canonical, Daily detail or Provider input is accepted.

### Null and zero

```text
availability_status=available + current_value=0
→ preserve observed zero

current_value=null or availability_status!=available
→ keep in unavailable/N/A inventory

missing Report
→ empty metric inventories, never a synthetic zero set
```

### Stable and idempotent identity

`ai_run_key` is stable for:

```text
customer + scope + channel/account + window + period + template version
```

Evidence changes do not create duplicate run identities. They update the evidence checksum and dedupe key.

Conflicting exact Report identities or duplicate enabled Settings fail closed as `validation_failed` while the complete 40-row Preview shape is retained.

### Preview safety

Every generated row is locked to:

```text
preview_mode=true
notification_eligible=false
notification_reason=preview_mode
sent_to_group=false
sent_at=null
cooldown_until=null
```

Available/partial Report rows use `generation_status=pending` so Lark Native AI may fill the existing AI output fields later. Missing/no-data rows use deterministic status text and `generation_status=skipped`. Validation conflicts use `generation_status=failed`.

## Machine-readable Lark schema contract

The config module records:

- additive fields for existing `MKT_AI_Report_Runs`;
- additive `platforms` and `report_type` options;
- six Preview Views;
- the nine-channel registry;
- fixed Thai readiness messages and deterministic severity.

It does not perform Lark Apply.

## Tests

Focused regression covers:

1. exact 40-row all-channel Preview;
2. every missing channel remains visible;
3. TikTok partial Report keeps 11 available and 6 N/A metrics;
4. observed zero remains zero;
5. missing/null is never converted to zero;
6. repeated Preview is idempotent;
7. all missing Reports produce `no_reports_available` Executive state;
8. conflicting Report checksums fail closed;
9. duplicate Settings fail closed;
10. `no_data_confirmed` remains an empty verified period, not a zero metric set;
11. Notification fields remain disabled for every Preview row.

## Current Base expectation

Using the audited `Social MKT Data Hub(14).base` state:

```text
TikTok Organic 1/3/7/30  = report_partial
7 configured channels    = report_missing
Chatwoot                  = configuration_missing
Executive                 = partial_coverage
Total                     = 40 Preview rows
Notification sends        = 0
```

## Out of scope

- Remote Lark field/View Apply;
- Lark Native AI prompt binding;
- creation of Lark Automation;
- `MKT_Notification_Log` Apply;
- Group message send;
- schedule activation;
- external AI/API/provider runtime;
- D1/Queue/Worker mutation;
- Production.

## Definition of Done

- all new focused tests pass;
- full repository Branch Verification passes on exact Head;
- no existing Report materializer/writer/Metric Matrix files change;
- no current-task, Meta continuation or retained evidence files change;
- no Remote action occurs;
- Draft PR #431 remains blocked from Live activation.
