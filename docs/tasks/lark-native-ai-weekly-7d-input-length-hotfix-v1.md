# Lark Native AI Weekly 7D Input-Length Hotfix v1

## Incident

The first real controlled weekly Executive AI attempt reached the existing `AI Materialization → MKT_AI_Report_Runs` Automation and failed in the first `AI-generated text (GPT model)` action with:

```text
The input length exceeds the limit in AI-generated text.
```

Trigger identity and safety were correct:

```text
template_version       weekly_executive_quality_v2_uat
scope_type             executive
channel_key             executive
window_days             7
readiness_status        report_partial
preview_mode            true
notification_eligible  false
sent_to_group           false
generation_status      pending
```

Notification Automation remained inactive.

## Confirmed root cause

The Executive AI Run carries both the full `metric_summary_json` business-evidence object and a second `channel_status_vector_json`. Prompt v2 references both. The evidence is valid but duplicates internal metadata and retains more per-item fields/ranked rows than the native Lark AI action accepts in one input.

The failure occurred before any AI output was produced. It is not a Trigger, Filter, Notification, Report, Queue or Worker failure.

## Correction

Reuse the existing Report evidence, AI Run, Lark client and two existing Automations. Do not create another AI engine or Automation.

Add a deterministic compact projection for the existing weekly Executive evidence:

- preserve all nine channel identities and readiness states;
- preserve current/previous business metric values needed for comparison;
- preserve bounded Top Content, Top Ads and Commerce/Customer collections;
- remove duplicate source IDs, watermarks, checksums, long internal prose and unused nested payload fields from the AI prompt projection;
- retain `evidenceShape=executive_business_first_v2` and add `promptShape=lark_ai_compact_v1`;
- hard-bound `metric_summary_json <= 2,800` characters;
- hard-bound `channel_status_vector_json <= 700` characters;
- fail closed rather than silently truncate beyond the reviewed tiering policy.

No canonical Report facts are changed. `source_report_checksum`, Report IDs and source tables remain untouched.

## Controlled repair/retry

After merge, the exact one-shot operator:

1. requires clean current `main`;
2. verifies the exact AI Automation identity is active;
3. verifies the exact Notification Automation identity is inactive;
4. resolves exactly one pending `weekly_executive_quality_v2_uat` Executive 7D row;
5. compacts only the two prompt-evidence text fields;
6. updates that same row once and sets `failure_code=CONTROLLED_UAT_RETRY_COMPACT_V1` to trigger the already-configured `failure_code` update trigger;
7. observes the same `ai_run_key` until generated/failed/timeout;
8. never enables Notification, Schedule or Production and never sends Queue/Worker/Provider actions itself.

The Automation final Update remains responsible for four AI outputs, `generation_status=generated`, clearing `failure_code`, and `generated_at`.

## Safety

```text
New AI engine / Automation      0
Report materialization          0
Source connector action         0
Remote D1                       0
Queue                           0
Worker deployment               0
Notification Automation         must remain inactive
Notification Admission          false
Schedule                        disabled
Production                      BLOCKED
Repair record writes            exactly 1
```

## Verification

```bash
npm ci
npm run check
node --test tests/application/compact-lark-native-ai-weekly-evidence.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```
