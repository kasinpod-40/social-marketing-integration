# All-channel Lark Native AI Offline Preview v1

## Status

```text
WORKSTREAM               = ALL_CHANNEL_LARK_NATIVE_AI_OFFLINE_PREVIEW_V1
BRANCH                   = work/all-channel-lark-native-ai-offline-preview-v1
BASE_MAIN_SHA            = fac11f0f95b56ab0944da02dcb0360d2f5c43710
AI_SCOPE                 = ALL_CHANNELS
MODE                     = OFFLINE_PREVIEW
SCHEMA_CHANGE_COUNT      = 0
AI_CALL_COUNT            = 0
LARK_WRITE_COUNT         = 0
REMOTE_ACTION_COUNT      = 0
NOTIFICATION_COUNT       = 0
SCHEDULE_ENABLED         = false
PRODUCTION               = BLOCKED
```

`docs/current-task.md` is intentionally unchanged because the active Chatwoot workstream owns it.
PR #421 files, Generic Report closure, Source readers/connectors and Shared Lark writer remain untouched.

## Frozen input authority

The offline bundle accepts only:

1. a Shared Report materialization that passes `validateReportMaterializationPayload` and is explicitly marked `validationStatus=validated` plus `frozen=true`; or
2. validated/frozen availability evidence from `shared_report_availability` for a channel whose Report materialization does not exist yet.

Raw tables, Source state, Daily facts, provider payloads, connector responses and unvalidated Report previews are rejected.

## Supported channels

```text
tiktok
youtube
instagram
facebook
meta_ads
google_ads
tiktok_ads
woocommerce
chatwoot
operations
executive (derived only)
```

## Availability contract

```text
complete
partial
unavailable
no_data_confirmed
source_pending
coverage_incomplete
```

Observed zero remains zero only when an available metric contains an observed value. Missing, unavailable, incomplete and missing-baseline evidence never becomes zero.

## Output sections

```text
Executive Summary
Organic Performance
Paid Ads Performance
Commerce & Conversion
Customer Service & Leads
Data Quality & Operations
Recommendations
Warnings / Missing Data
```

Every section exists in the output contract and is either `rendered` or `suppressed` by deterministic availability policy.

## Validation behavior

- Every numeric statement must map to one exact `traceId`, Report identity and metric identity.
- Unknown or altered numeric claims are rejected.
- Trend language is rejected when the referenced metric has no complete baseline.
- Multi-currency aggregation is rejected; conversion evidence is not accepted in this version.
- Paid Ads ratios require `sum_before_ratio` plus exact numerator and denominator metric keys.
- Average-of-averages requires an exact weight metric.
- Recommendations are full, limited or disabled according to availability, coverage, freshness, baseline and critical data-quality evidence.
- Prompt-shaped text inside dimensions remains inert data inside an explicit `UNTRUSTED_REPORT_DATA` boundary.

## Offline fixtures

The test suite covers all required scenarios:

1. TikTok complete Golden Dataset
2. YouTube ready but missing materialization
3. Instagram partial
4. Facebook blocked/pending continuation
5. Meta Ads partial
6. Google Ads source pending
7. TikTok Ads unavailable
8. WooCommerce mixed summary/dimension evidence
9. Chatwoot accepted partial UAT
10. Operations complete
11. Executive mixed availability
12. Multi-currency rejection
13. Observed zero
14. Missing baseline
15. Coverage incomplete
16. `no_data_confirmed`
17. Stale Report
18. Duplicate/invalid identity
19. Unsupported 9/15/90-day windows
20. Prompt injection-shaped dimension text

## Verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-offline-bundle.test.js
node --test tests/application/lark-native-ai-offline-output-validator.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository implementation performs no AI, Lark Record, Remote D1, Queue, Worker, Provider, Automation, notification, schedule or Production action.
