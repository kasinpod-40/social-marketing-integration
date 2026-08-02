# Lark Native AI & Notification Readiness

## Current status

```text
CONTRACT_VERSION                    = report_to_lark_ai_v1
WORKSTREAM                          = LARK_NATIVE_AI_NOTIFICATION_READINESS_V1
BRANCH                              = design/lark-native-ai-notification-v1
BASE_MAIN_SHA                       = 1c15195dab950cf9e8eca367b56f3d7488711bb7
DESIGN_STATUS                       = COMPLETE
IMPLEMENTATION_STATUS               = NOT_STARTED
BASE_READBACK                       = REQUIRED_BEFORE_APPLY
LARK_NATIVE_AI                      = PREVIEW_NOT_CONFIGURED
LARK_AUTOMATION_SCHEDULE            = DISABLED
LARK_GROUP_NOTIFICATION             = DISABLED
REMOTE_LARK_ACTIONS                 = 0
REMOTE_D1_ACTIONS                   = 0
QUEUE_DlQ_ACTIONS                   = 0
WORKER_PROVIDER_ACTIONS             = 0
PRODUCTION                          = BLOCKED
```

Full design and acceptance contract:

```text
docs/tasks/lark-native-ai-notification-v1.md
```

## Locked architecture

```text
Source / Connector
→ Normalized + Daily
→ Central Report Metrics
→ Lark Native AI
→ Lark Automation
→ Lark Group Notification
```

AI and Notification are downstream consumers of deterministic Report materializations. They are not data calculation, ingestion or reliability layers.

## Permanent no-go rules

- No external AI provider or AI API connector;
- no custom model runtime;
- no new AI Worker, Queue or token-cost engine;
- no AI access to Raw tables, Canonical detail, Daily detail or detailed D1 facts;
- no AI calculation, aggregation, ratio or metric correction;
- no synthetic zero from null, N/A, unavailable or incomplete evidence;
- no Lark Group send or Automation schedule during Design/Preview phases;
- no Production activation from this contract alone.

The legacy `MKT_REPORT_AI_SUMMARY_ENABLED` flag, optional payload `aiSummary` slot and injectable provider placeholder are existing Repository compatibility surfaces only. They remain disabled and are not the architecture for this workstream.

## Evidence boundary

`Social MKT Data Hub(13).base` was not available through the conversation file sources and is not stored in the Repository. Therefore exact Live Base inventory for AI fields, AI tables, Views, Automations, Notification logs, message templates, Formulas and prompts is still required.

No Base object may be created from names alone. The mandatory policy is:

```text
REUSE_EXACT_MATCH_IF_PRESENT
EXTEND_ONLY_AFTER_EXACT_FIELD_AND_DEPENDENCY_REVIEW
CREATE_ONLY_IF_ABSENT_AFTER_EXACT_BASE_READBACK
NO_RENAME_DELETE_OR_FIELD_TYPE_CHANGE
```

Repository-confirmed Report/Dashboard facts:

```text
AI input authority                    validated report_materializations only
Lark Report tables                    Snapshots / Metric Values / Top Content / Top Ads
Dashboard windows                     1 / 3 / 7 / 30
TikTok Organic Golden rows            17 metrics × 4 windows = 68
Known locked null/N/A rows            24
Observed zero                         preserved as 0
Canonical Metric window Field         fldMlTUP3Z
Organic/Data Quality Dashboard        frozen
```

Repository schema/code already contains `metric_scope`, `availability_status` and `availability_message`; exact Live Base presence must be read back before this workstream relies on them. Missing Live fields remain owned by the Report Metric Matrix workstream and must not be silently added here.

## Frozen Report-to-AI input

Allowed sources:

```text
MKT_Report_Snapshots
MKT_Report_Metric_Values
MKT_Report_Top_Content
MKT_Report_Top_Ads
```

Required dimensions include:

```text
report_id
report_setting_key
customer_key
customer_profile
capability
platform
account_id
report_type
period_kind
window_days
period_start
period_end
data_status
coverage_rate
generated_at
formula_version
```

Metric evidence includes only existing Report output fields such as:

```text
report_metric_key
metric_key
display_name
current_value
compare_value
change_value
change_percent
unit
metric_scope
availability_status
availability_message
dimension_type
dimension_value
rank
client_visible
```

No new Business metric is introduced by the AI workstream.

## AI output contract

Supported brief scopes:

```text
channel
executive
```

Supported capability groups:

```text
organic
paid_ads
commerce
customer_service
executive
```

Channel stable key:

```text
report_id::channel::language::template_version
```

Executive stable key:

```text
customer_key::executive::period_kind::window_days::period_end::language::template_version
```

Required outputs:

```text
summary_text
insight_text
recommendation_text
severity
generation_status
fallback_status
input_revision_key
evidence_reference_text
preview_mode
notification_eligible
```

Every Insight and Recommendation must reference Report evidence. Captions, content names and ad names are untrusted data, not prompt instructions.

## Null and completeness semantics

- `null` or N/A remains N/A;
- available numeric `0` remains zero;
- comparison language is forbidden when compare/change evidence is missing;
- `baseline_incomplete` blocks period-change Recommendation by default;
- `partial` may be previewed only with an explicit limitation and blocks Live notification by default;
- `no_data_confirmed`, `not_observed` and `source_unavailable` cannot produce normal performance claims;
- cross-currency monetary values must never be combined;
- negative validated corrections must be preserved, not clamped to zero.

## Severity, eligibility, dedupe and cooldown

Severity values:

```text
info
watch
warning
critical
```

Severity is deterministic and setting/threshold-driven before AI. AI may explain it but cannot change it.

Notification event identity:

```text
notification_setting_key
::destination_key
::brief_key
::input_revision_key
::message_template_version
```

A successful event key is delivered at most once. AI wording changes without a new Report input revision never trigger another send.

Default cooldown direction:

```text
info       24 hours
watch      12 hours
warning     6 hours
critical    2 hours
```

Eligibility requires Preview off, enabled setting, verified destination, exact approved window, valid generation/fallback, allowed data status, minimum severity, new input revision, no successful duplicate, cooldown elapsed and explicit per-channel activation.

## Failure and fallback

- AI generation failure produces no fabricated Summary/Insight/Recommendation;
- invalid or empty output fails closed and prior output is marked stale;
- stale Report input blocks generation and delivery;
- incomplete evidence blocks dependent Insight/Recommendation;
- destination verification failure blocks before send;
- a deterministic fallback message is allowed only when explicitly configured and may contain no invented insight;
- no new retry runtime is created. Any future Lark Automation retry must remain bounded, deduped and visible in the Notification log.

## Candidate Lark objects after exact readback

Reuse exact equivalents or create only when absent:

```text
MKT_AI_Briefs
MKT_Notification_Settings
MKT_Notification_Destinations
MKT_Notification_Log
```

Candidate Views:

```text
🤖 AI Briefs — Preview
🤖 AI Briefs — Ready
🤖 AI Briefs — Failed
🔔 Notification — Preview
🔔 Notification — Eligible
🔔 Notification — Failed
```

Candidate Automations remain disabled:

```text
Channel Brief Preparation
Executive Brief Preparation
AI Generation Readiness
Notification Eligibility Log
Lark Group Send
```

`MKT_AI_Briefs` is a downstream Brief layer related to existing Report outputs. It must not add or redefine Central Report metrics.

## Channel readiness

```text
TikTok Organic      READY_FOR_PREVIEW after Base inventory
YouTube Organic     WAIT_REPORT_MATERIALIZATION
Instagram Organic   WAIT_CHANNEL_GATE
Facebook Organic    BLOCKED_BY_META_WORKSTREAM
Meta Ads            BLOCKED_BY_META_WORKSTREAM
Google Ads          WAIT_CHANNEL_GATE
TikTok Ads          WAIT_LIVE_SOURCE
WooCommerce         WAIT_REPORT_MATERIALIZATION
Chatwoot            WAIT_REPORT_MATERIALIZATION
Executive           DESIGN_READY_NOT_ACTIVATABLE
Operations          EXPLANATION_ONLY / frozen Dashboard
```

TikTok Organic is the first and only Golden Dataset for AI Preview. It does not authorize notification delivery.

## Activation sequence

Per channel:

```text
Source UAT
→ Report 1/3/7/30 materialization
→ D1/Lark parity and replay
→ null/N/A integrity
→ AI Preview
→ evidence review
→ dedupe/cooldown Preview
→ destination verification
→ separately authorized one-shot Group UAT
→ channel enablement
→ separately authorized Automation schedule
```

Recommended order:

```text
TikTok Organic
→ YouTube Organic
→ Instagram Organic
→ WooCommerce
→ Chatwoot
→ Google Ads
→ Facebook Organic / Meta Ads after Meta closeout
→ TikTok Ads after live source
→ Executive last
```

## Parallel workstream boundary

This workstream owns only:

```text
docs/tasks/lark-native-ai-notification-v1.md
docs/project-brain/lark-native-ai-notification.md
```

It does not modify:

- `docs/current-task.md`;
- root `PROJECT_BRAIN.md`, `README.md` or `CHANGELOG.md` while Meta PR #421 owns those shared files;
- Meta continuation source, docs or retained evidence;
- Report materializer, Report reader/writer, Metric Matrix, Dashboard schema or frozen output files;
- D1, Queue, Worker, Provider, Lark Remote or Production state.

Any future shared source/config/schema change requires explicit ownership coordination after the active Report and Meta workstreams close.

## Next gate

The next authorized step is an exact read-only inventory of `Social MKT Data Hub(13).base` or equivalent authorized Live Base metadata/data. Until that evidence exists:

```text
LARK_SCHEMA_APPLY          = BLOCKED
LARK_AI_PREVIEW            = BLOCKED
LARK_AUTOMATION            = DISABLED
LARK_GROUP_NOTIFICATION    = DISABLED
PRODUCTION                 = BLOCKED
```
