# Lark Native AI Weekly 7D Controlled UAT

## Current authority

Weekly Executive Group delivery is 7D-first. Prompt v2 and Executive business-evidence enrichment are merged; the remaining quality gate is one real Lark Native AI generation against latest available validated 7D Base evidence.

Two existing Base UI Automations are proven present and inactive through Bitable v1 List automations. Their numeric Automation IDs are retained only through private authority and public SHA-256 identity. They must be reused; Base v3 `wkf...` Workflows are not replacements.

## Controlled UAT shape

```text
latest aligned validated 7D Report evidence in Lark
→ existing all-channel AI Preview builder
→ Executive business evidence v2
→ one isolated MKT_AI_Report_Runs UAT row
→ existing inactive AI Materialization Automation
→ manual Test Results
→ review Thai AI output
```

The isolated row uses:

```text
template_version       weekly_executive_quality_v2_uat
scope_type             executive
window_days            7
preview_mode           true
notification_eligible  false
sent_to_group          false
generation_status      pending
```

This identity does not overwrite the retained 40-row Preview generation and does not reuse the closed Notification smoke identity.

## Evidence selection

Do not mix channel Reports from different weekly periods.

Choose the newest exact 7D period that has the maximum number of aligned channel Report snapshots. For that exact period:

- validated channels contribute Metric Values, previous-period comparison, Top Content, Top Ads and bounded dimensional evidence;
- configured channels without an aligned Report are missing for this UAT period;
- missing values stay null/N/A and never become zero.

## AI quality rule

The actual generated text must be business-first:

- summarize TikTok performance when TikTok has data;
- mention Top Content and actual view/like/engagement evidence when present;
- compare previous 7D only when the Report contains comparison evidence;
- compare channels only where compatible evidence exists;
- channels without evidence use natural Thai such as `ยังไม่พบข้อมูลสำหรับช่วงนี้`;
- no internal `report_partial`, `source_pending`, `Coverage`, readiness field names or monitoring prose.

## Automation boundary

The AI Materialization Automation remains inactive during configuration and `Test Results`.

Expected topology:

```text
AI Run trigger
→ Delay 1 minute
→ GenerateAiTextAction x4
→ Update current AI Run
```

Four outputs:

```text
insight_summary
strengths
weaknesses
recommendations
```

Notification is not part of this Automation phase. `Eligible AI Run → Lark Group Notification` remains unchanged and inactive.

## Safety

```text
AI UAT row writes            <= 1
AI calls by Terminal          0
Automation mutation          0
Automation activation        0
Notification sends           0
Remote D1 / Queue / Worker   0
Schedule                     disabled
Production                   BLOCKED
```

After the generated text passes quality review, the next work returns to the downstream Notification sequence: Notification Admission → automatic 7D end-to-end UAT → weekly trigger/schedule → stability/closeout.
