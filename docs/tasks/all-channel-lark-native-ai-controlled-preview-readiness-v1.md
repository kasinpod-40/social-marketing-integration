# All-channel Lark Native AI Controlled Preview Readiness v1

## Status

```text
WORKSTREAM                         = ALL_CHANNEL_LARK_NATIVE_AI_CONTROLLED_PREVIEW_READINESS_V1
BRANCH                             = work/all-channel-lark-native-ai-controlled-preview-readiness-v1
BASE_MAIN                          = db7a09e6d5b2a78f4e7e25bd0a7822cbef85bdeb
MODE                               = REPOSITORY_ONLY_READINESS
AI_SCOPE                           = ALL_CHANNELS
WINDOW_SCOPE                       = 1D_3D_7D_30D
TARGET_TABLE                       = 🧠 MKT_AI_Report_Runs
AI_CALL_COUNT                      = 0
LARK_RECORD_READ_WRITE             = 0 / 0
REMOTE_ACTION_COUNT                = 0
NOTIFICATION_COUNT                 = 0
SCHEDULE_ENABLED                   = false
PRODUCTION                         = BLOCKED
```

`docs/current-task.md` remains unchanged because the active Chatwoot workstream owns it.

## Objective

Prepare one deterministic, reviewable package for a future separately authorized Lark Native AI controlled Preview.
The package reuses the merged all-channel offline contract from PR #446 and the existing additive Lark schema that
finished at `zero_drift`. It does not introduce another AI bundle, Report engine, Lark writer or execution runtime.

```text
validated/frozen Shared Report evidence
→ merged offline AI bundle
→ exact prompt + SHA-256
→ deterministic reference output + validation
→ 10-row Lark Preview plan
→ readiness/approval/Remote-lock gates
```

## All-channel scope

Business rows per Report window:

```text
TikTok Organic
Facebook Organic
Instagram Organic
YouTube Organic
Meta Ads
Google Ads
TikTok Ads
WooCommerce
Chatwoot
Executive
```

Operations/Data Quality remains part of the all-channel AI input and is embedded in the Executive
`channel_status_vector_json`. It is intentionally not a separate Lark row because the already-applied
`channel_key` schema contains nine business channels plus `executive`.

One execution plan therefore contains exactly 10 rows for one supported window. The same contract is reusable for
`1D / 3D / 7D / 30D` without introducing window-specific code.

## Reused authorities

The workstream reuses:

- `buildLarkNativeAiOfflineBundle`;
- `buildLarkNativeAiOfflinePrompt`;
- `renderLarkNativeAiOfflinePreview`;
- `validateLarkNativeAiOfflineOutput`;
- the existing `🧠 MKT_AI_Report_Runs` reused and additive fields;
- the six applied Lark Native AI Views;
- existing Report identities and validated/frozen availability evidence.

The stale `implementation/lark-native-ai-all-channel-preview-v1` branch is not extended. Its duplicate bundle
implementation is superseded by PR #446. Only its still-valid concept of ten bounded Lark rows per window is retained.

## Readiness gates

A plan is `blocked` unless all hard gates pass:

1. Repository authority states clean exact `main` Head.
2. Retained schema authority is validated/frozen and proves:
   - target table `🧠 MKT_AI_Report_Runs`;
   - status `zero_drift`;
   - required Views `6`;
   - exact View filters `6`;
   - remaining logical actions `0`.
3. Retained runtime authority is validated/frozen and proves:
   - all Worker execution flags false;
   - Preview URLs disabled;
   - Production blocked;
   - Schedule disabled.
4. TikTok Golden Dataset is complete, fully covered, fresh and contains at least one observed available metric.
5. Prompt has one exact untrusted-data boundary and remains inside the bounded size contract.
6. The deterministic reference output passes the merged anti-fabrication/output validator.
7. The Lark plan has exactly 10 unique rows and every required field.
8. Every row remains Preview-only and notification-disabled.

After hard gates pass:

```text
Meta Remote lock retained
→ waiting_for_remote_lock

Remote lock released, no exact approval
→ awaiting_explicit_preview_approval

Remote lock released + exact Head-bound approval
→ ready_for_controlled_preview
```

Even `ready_for_controlled_preview` retains:

```text
executorImplemented=false
executionAuthorized=false
```

Actual Lark Native AI execution requires another reviewed workstream and explicit action.

## Stable identities

```text
previewRunKey
= SHA-256(customer + all-channel scope + period/window + prompt/output versions)

evidenceChecksum
= SHA-256(bundle + prompt + reference output + schema/runtime evidence checksums)

dedupeKey
= SHA-256(previewRunKey + evidenceChecksum)
```

Each Lark row receives a separate stable `ai_run_key`, source evidence checksum and dedupe key.
Repeated identical inputs produce identical identities and do not create duplicate Preview work.

## Lark row safety

Every planned row is locked to:

```text
preview_mode=true
notification_eligible=false
notification_reason=controlled_preview
sent_to_group=false
sent_at=null
cooldown_until=null
```

AI output fields remain `null` before a future controlled Preview. Unavailable or pending channels are retained as
truthful readiness rows with `generation_status=skipped`; missing values are never converted to zero. Observed zero
remains zero inside the validated metric summary.

## Terminal

The terminal is plan-only and requires a private input file:

```bash
node scripts/lark-native-ai-controlled-preview-readiness.mjs \
  --input /private/path/controlled-preview-input.json \
  --output /private/path/controlled-preview-plan.json
```

The output file is written mode `0600` because it contains the exact prompt and bounded business evidence.

These modes are always rejected:

```text
--execute
--apply
```

with:

```text
LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTION_NOT_IMPLEMENTED
```

## Files

```text
packages/config/src/lark-native-ai-controlled-preview-contract.js
packages/application/src/reports/build-lark-native-ai-controlled-preview-rows.js
packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js
scripts/lark-native-ai-controlled-preview-readiness.mjs
tests/application/lark-native-ai-controlled-preview-readiness.test.js
tests/scripts/lark-native-ai-controlled-preview-readiness.test.js
docs/tasks/all-channel-lark-native-ai-controlled-preview-readiness-v1.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-controlled-preview-readiness.test.js
node --test tests/scripts/lark-native-ai-controlled-preview-readiness.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must also pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head.

## Out of scope

- Lark Native AI call;
- Lark Record read/write;
- Lark schema/View mutation;
- external AI provider;
- custom AI Worker or Queue;
- Report materialization;
- Automation or Group notification;
- Worker upload/deployment;
- D1 mutation;
- Provider call;
- Schedule activation;
- Production.
