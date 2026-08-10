# Weekly Executive AI Status Vector Hotfix — 2026-08-10

## Incident

Fresh Weekly Executive Decision Preview for `2026-08-03..2026-08-09` passed the prior metric-summary budget fixes, then stopped at `build-fresh-period-authority` before any mutation:

```text
code                 LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_LIMIT_EXCEEDED
observedChars        2522
maximumChars         700
recordWriteCount     0
triggerWriteCount    0
queueAdmissionCount  0
messageSendCount     0
scheduleActivation   0
production           BLOCKED
```

## Root cause

The Executive status vector carried seven fields for each of nine channels: `channelKey`, `displayName`, `readinessStatus`, `readinessMessage`, `severity`, `sourceReportChecksum` and `availableMetricCount`.

At the downstream Executive Decision AI boundary, the business evidence is already carried by `metric_summary_json`. The status reference is internal readiness context, so display text, readiness explanation, checksum and metric-count metadata duplicate authority without adding decision facts.

## Fix

Compact the downstream AI status vector to exactly:

```text
channelKey
readinessStatus
```

for all nine channel identities. The 700-character reviewed ceiling remains unchanged. The original upstream Executive status authority/checksum construction is not altered.

## Safety

- Business facts and ranked Content/Ads candidates are unchanged.
- Decision Quality Gate is unchanged.
- `MAX_STATUS_VECTOR_CHARS=700` is unchanged.
- Notification Runtime, Automatic Weekly Notification and group send remain OFF.
- Production remains BLOCKED.
- The live failure occurred before any AI row/trigger mutation, so Fresh Preview `--execute` may be attempted again only after this hotfix is merged to current `main`.
