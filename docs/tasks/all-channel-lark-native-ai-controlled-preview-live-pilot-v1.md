# All-channel Lark Native AI Controlled Preview Live Pilot v1

## Status

```text
WORKSTREAM                         = ALL_CHANNEL_LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_V1
BRANCH                             = work/all-channel-lark-native-ai-controlled-preview-live-pilot-v1
BASE_MAIN                          = 48cb63c70b95f306a5a101a68a4706d010762e68
TARGET_TABLE                       = 🧠 MKT_AI_Report_Runs
EXPECTED_ROWS                      = 40
LIVE_EXECUTION                     = NOT_RUN
AI_CALL_COUNT                      = 0
AUTOMATION_NOTIFICATION            = 0 / 0
SCHEDULE_ENABLED                   = false
PRODUCTION                         = BLOCKED
```

`docs/current-task.md` remains owned by the active Chatwoot recovery workstream. PR #421 Meta and PR #445 Report closure files are not modified.

## Objective

Turn the merged four-window Controlled Preview execution plan into one bounded Remote Lark Record pilot so the user can see truthful all-channel readiness data in Lark.

```text
real validated Report evidence
→ exact approved 1D / 3D / 7D / 30D readiness plans
→ Remote Stable-key inventory
→ create / update / no-op plan
→ at most 40 Preview Record writes
→ fresh Stable-key read-back
→ exact zero drift
```

The pilot does not call Lark Native AI. The first visible result is the 40 Preview input/readiness rows. Native AI output generation remains a separate reviewed step after the Record pilot is verified.

## Exact shape

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

Four supported windows produce exactly 40 retained identities.

## Input authority

The private `0600` input must use:

```text
schemaVersion = lark_native_ai_controlled_preview_live_pilot_input_v1
readinessPlans = exact approved [1D, 3D, 7D, 30D]
```

Each plan is independently revalidated by the merged Readiness and Executor contracts. This includes:

- exact clean `main` Head;
- retained plan hash recomputation;
- exact 10-row topology per window;
- Lark schema `zero_drift` and 6/6 View filter parity;
- Meta Remote lock released;
- all Worker flags false;
- Preview URLs disabled;
- Schedule disabled;
- Production blocked;
- exact Head-bound explicit approval;
- 40 unique `ai_run_key` and `dedupe_key` identities.

Fixture/test readiness plans are forbidden for Live execution. The input must be generated from actual validated Report evidence.

## Remote allowlist

Allowed requests only:

```text
POST tenant token
GET  Base Tables
POST Record search by ai_run_key
POST Record search by dedupe_key
POST batch_create Preview Records
POST batch_update Preview Records
```

Boundaries:

```text
Table reads                  <= 1
Record search requests       2..4
Batch write requests         <= 2
Record writes                <= 40
Delete                       0
Schema/View mutation         0
AI call                      0
Automation/notification      0
```

Every request outside this list is rejected before `fetch`.

## Record behavior

- missing identity → create;
- exact retained evidence → no-op;
- display-only drift → bounded update while preserving validated AI output;
- evidence drift/revision → update the same Record and clear stale AI output;
- sent/non-preview/duplicate/conflicting identity → fail closed;
- unmanaged legacy Records → untouched;
- delete authority → none.

After any write, the operator performs a fresh Stable-key read-back. Success requires:

```text
status  zero_drift
no_op   40
write   0
delete  0
```

Ambiguous/partial writes are not blindly retried. A later reviewed rerun searches Stable keys first and resumes only missing or divergent identities.

## Terminal

Plan-only:

```bash
node scripts/lark-native-ai-controlled-preview-live-pilot.mjs
```

Reviewed execution after merge, exact real input, Remote-lock release and new explicit approval:

```bash
chmod 600 outputs/lark-native-ai-controlled-preview/live-pilot-input.json

CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW=APPLY_LARK_NATIVE_AI_CONTROLLED_PREVIEW_40_ROWS \
MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/lark-native-ai-controlled-preview-live-pilot.mjs --execute
```

Sanitized private evidence:

```text
outputs/lark-native-ai-controlled-preview/live-pilot-summary.json
```

No App token, credential, Table/Record ID, raw URL, prompt or full AI reference output is written to evidence.

## Files

```text
packages/config/src/lark-native-ai-controlled-preview-live-pilot-contract.js
packages/application/src/reports/apply-lark-native-ai-controlled-preview-live-pilot.js
scripts/lib/lark-native-ai-controlled-preview-live-pilot.js
scripts/lark-native-ai-controlled-preview-live-pilot.mjs
tests/application/lark-native-ai-controlled-preview-live-pilot.test.js
tests/scripts/lark-native-ai-controlled-preview-live-pilot.test.js
docs/tasks/all-channel-lark-native-ai-controlled-preview-live-pilot-v1.md
docs/project-brain/lark-native-ai-controlled-preview-live-pilot.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-controlled-preview-live-pilot.test.js
node --test tests/scripts/lark-native-ai-controlled-preview-live-pilot.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must pass all focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head. Repository implementation and CI perform zero Remote action.

## Current external blockers

Live execution remains blocked until both conditions are true:

1. the active Chatwoot/Meta Remote mutation owner explicitly releases the Integration Workspace Remote lock;
2. actual validated Report evidence produces the exact four approved readiness plans.

The user request authorizes preparing and, once these gates are satisfied, performing the bounded Preview Record pilot. It does not authorize fake data, a Provider replay, a second Remote owner, Notification, Schedule activation or Production.
