# Lark Native AI Weekly Executive Quality v2

## Objective

Make the existing Lark Native AI output read like a real weekly marketing report before automatic Group Notification is enabled.

The primary downstream Group report is the **7D Executive report**. The 1D, 3D and 30D AI rows remain available for Lark views and analysis, but this task does not enable any Notification Admission, Automation or Schedule.

## User-facing quality requirement

The Executive report must answer:

1. What happened in each channel during the latest 7 days?
2. What changed versus the previous 7-day period when comparison evidence exists?
3. Which Content, Ad, product or customer-service item is notable when ranked evidence exists?
4. Which channels are strongest or weakest on comparable evidence?
5. Which channels have no usable evidence for this period?
6. What should the marketing team do next week based on the evidence?

A channel with real data must be analyzed on its own merits. For example, TikTok Organic with validated metrics and Top Content must produce TikTok performance insight, not merely the sentence “TikTok has data”.

A channel without evidence remains visible and is described naturally, for example:

```text
ยังไม่พบข้อมูลสำหรับช่วงนี้
```

Internal control vocabulary must not leak into the executive prose.

## Confirmed root cause

Two existing contracts caused the observed low-quality message.

### 1. Executive AI evidence was status-only

Channel AI rows already carried validated business evidence inside `metric_summary_json`:

- available and unavailable Metric Values;
- Top Content;
- Top Ads;
- Shared Report collections.

The Executive row, however, retained only a per-channel readiness/status vector and source Report IDs. Lark AI therefore had no actual per-channel business metrics or ranked objects to summarize at Executive scope.

### 2. Prompt v1 treated control status as report content

The prompt accepted `data_status`, `readiness_status`, `readiness_message` and Executive channel statuses as visible context and explicitly instructed the model how to discuss states such as missing/unavailable/Coverage. This encouraged schema-to-sentence output such as `report_partial`, `source_pending`, `unavailable` and Coverage commentary rather than marketing analysis.

## Correction

### Business-first Executive evidence

Reuse the existing `metric_summary_json` field. Do not add a table, field, writer or AI runtime.

Executive evidence now includes bounded `channelBusinessEvidence` for all nine business channels:

- natural channel display name;
- capability;
- control readiness evidence;
- source Report identity/watermark;
- up to 24 summary-level available metrics;
- unavailable metric count;
- up to 3 Top Content rows;
- up to 3 Top Ads rows;
- bounded Shared Report collections.

The Executive evidence checksum includes this business evidence so a real evidence change changes the downstream dedupe authority.

No `operations` pseudo-channel is introduced.

### Prompt v2

Prompt version:

```text
lark_native_ai_automation_prompts_v2
```

The prompt keeps the existing Lark reference slots and existing four output fields:

```text
insight_summary
strengths
weaknesses
recommendations
```

No Lark schema change is required.

The user-facing rules are now:

- write as a marketing analyst for executives;
- business performance comes before data-readiness commentary;
- use metrics and ranked evidence when present;
- trend words require actual comparison evidence;
- data readiness/freshness is not a marketing strength;
- missing channels use natural Thai such as `ยังไม่พบข้อมูลสำหรับช่วงนี้`;
- internal status vocabulary is control-only and must not be repeated in the final prose;
- 7D recommendations are written as actions for the next week;
- no invented numbers, campaign/content/product names or business conclusions.

## Weekly Group target

After Report closeout and a separate AI live-quality UAT pass, the downstream Notification workstream should use the 7D Executive AI Run as the primary scheduled Group report.

Expected future flow:

```text
Latest complete 7D Report materializations
+ previous 7D comparison
+ Top Content / Top Ads / Shared collections
→ Lark Native AI channel analysis
→ Executive cross-channel synthesis
→ separately controlled Notification Admission
→ Social MKT Executive Reports Group
```

This task does **not** activate that flow.

## Architecture preserved

```text
Validated Central Report
→ MKT_Report_Snapshots / Metric Values / Top Content / Top Ads
→ existing MKT_AI_Report_Runs
→ existing Lark Native AI actions
→ separately controlled Notification Runtime
```

Forbidden and unchanged:

- external AI provider;
- custom AI Worker/Queue;
- Raw/detail-table AI reads;
- duplicate AI table;
- duplicate Report or Lark writer;
- direct Notification send from this task.

## Parallel-workstream boundary

`docs/current-task.md` remains owned by the active Report/Chatwoot closeout workstream and is intentionally not modified here.

This task does not run Report Finalizer, Report readiness, Report materialization or Chatwoot continuation.

## Verification

Focused regression:

```bash
node --test tests/application/lark-native-ai-all-channel-preview.test.js
node --test tests/application/lark-native-ai-weekly-executive-quality.test.js
node --test tests/application/lark-native-ai-disabled-configuration-preview.test.js
node --test tests/scripts/lark-native-ai-disabled-configuration-preview.test.js
```

Repository gates:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Definition of Done for this repository phase

- Prompt v2 is business-first and natural Thai.
- Executive AI evidence contains bounded per-channel business evidence.
- 7D previous-period comparison evidence remains available.
- Top Content / Top Ads evidence can reach Executive AI when the Shared Report contains it.
- Missing channels remain explicit without internal-status leakage.
- All regressions and Branch Verification pass on the exact PR Head.
- Remote action count remains zero.

## Safety state

```text
Remote Lark read/write       0 / 0
Native AI call               0
Workflow create/update       0 / 0
Notification send            0
Queue action                 0
Remote D1 action             0
Worker deployment            0
Schedule activation          0
Notification Admission       false
Production                   BLOCKED
```
