# All-channel Lark Native AI Controlled Preview Executor v1

## Status

```text
WORKSTREAM                         = ALL_CHANNEL_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_V1
BRANCH                             = work/all-channel-lark-native-ai-controlled-preview-executor-v1
BASE_MAIN                          = b22ffd4c54075fc8e434b85a4c1d43be200094d9
MODE                               = REPOSITORY_ONLY_EXECUTION_PLAN
WINDOWS                            = 1D_3D_7D_30D
EXPECTED_ROWS                      = 40
TARGET_TABLE                       = 🧠 MKT_AI_Report_Runs
REMOTE_APPLY_IMPLEMENTED           = false
EXECUTION_AUTHORIZED               = false
AI_CALL_COUNT                      = 0
LARK_RECORD_READ_WRITE             = 0 / 0
REMOTE_ACTION_COUNT                = 0
NOTIFICATION_COUNT                 = 0
SCHEDULE_ENABLED                   = false
PRODUCTION                         = BLOCKED
```

`docs/current-task.md` remains unchanged because the active Chatwoot recovery workstream owns it.

## Objective

Convert four exact approved Controlled Preview Readiness plans into one deterministic 40-row Lark execution plan without reading or writing Remote Lark Records.

```text
4 approved readiness plans
→ validate common Repository/Schema/Remote/Approval authority
→ flatten 4 × 10 desired rows
→ compare with sanitized existing-record inventory
→ create / update / no-op plan
→ pure partial-resume simulation
→ same-input replay
→ zero-drift evidence
```

The executor is all-channel and reuses the merged readiness rows from PR #448. It does not calculate Report metrics, rebuild AI prompts, call Lark Native AI or create a second Lark writer.

## Exact shape

Each window contains:

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

Total:

```text
4 windows × 10 rows = 40 rows
```

Operations/Data Quality remains embedded in each Executive status vector through the readiness plan merged in PR #448.

## Input authority

Every readiness plan must independently prove:

- schema `lark_native_ai_controlled_preview_plan_v1`;
- status `ready_for_controlled_preview`;
- zero readiness blockers;
- exact clean `main` Head matching the executor input;
- exact Head-bound explicit Preview approval;
- Lark schema `zero_drift`, six Views and six exact filters;
- Meta Remote lock released;
- Worker flags all false;
- Preview URLs disabled;
- Schedule disabled;
- Production blocked;
- zero AI/Lark/notification action;
- exact prompt/reference/evidence hashes;
- exact target table and ten rows.

The four plans must share customer, period end, comparison mode, prompt/output version, schema evidence, Remote evidence and approval identity. Their window set must be exactly `1/3/7/30`.

## Stable identity and ownership

Primary row identity:

```text
ai_run_key
```

Evidence revision identity:

```text
dedupe_key
```

The executor owns only Report-input, readiness and Preview-safety fields. AI output fields remain owned by Lark Native AI:

```text
insight_summary
strengths
weaknesses
recommendations
```

Generation state remains runtime state:

```text
generation_status
failure_code
```

### Same evidence

When `ai_run_key` and `dedupe_key` match:

- exact managed fields → `no_op`;
- managed-field drift → bounded `update`;
- generated AI output and generation state are preserved.

### Evidence revision

When `ai_run_key` matches and `dedupe_key` changes:

- update the same Preview Record;
- replace managed evidence fields;
- clear stale AI output fields;
- reset `generation_status` to the desired readiness state;
- clear `failure_code`;
- never delete or create a duplicate identity.

## Safety conflicts

The planner blocks before any action when a retained target Record:

- duplicates `ai_run_key`;
- reuses a desired `dedupe_key` under another identity;
- has conflicting `scope_type`, `channel_key`, `capability` or `window_days`;
- is not `preview_mode=true`;
- is notification eligible;
- was sent to a group;
- has non-null `sent_at`.

Unmanaged/legacy Records remain untouched. No delete action exists.

## Partial resume and replay

A retained subset of correct rows becomes `no_op`; only missing rows become `create`. Safe drift becomes `update`.

Pure simulation applies only planned create/update actions to an in-memory inventory. Replanning the simulated result with identical readiness evidence must return:

```text
status       zero_drift
create       0
update       0
no_op        40
write        0
delete       0
```

## Terminal

Plan-only command:

```bash
node scripts/lark-native-ai-controlled-preview-executor.mjs \
  --input /private/path/executor-input.json \
  --output /private/path/execution-plan.json
```

The output is private mode `0600` because it contains bounded Report evidence and planned Record fields.

These arguments always fail before input read:

```text
--execute
--apply
```

with:

```text
LARK_NATIVE_AI_CONTROLLED_PREVIEW_REMOTE_APPLY_NOT_IMPLEMENTED
```

## Files

```text
packages/config/src/lark-native-ai-controlled-preview-executor-contract.js
packages/application/src/reports/build-lark-native-ai-controlled-preview-execution-plan.js
scripts/lark-native-ai-controlled-preview-executor.mjs
tests/helpers/lark-native-ai-controlled-preview-readiness-plans.js
tests/application/lark-native-ai-controlled-preview-executor.test.js
tests/scripts/lark-native-ai-controlled-preview-executor.test.js
docs/tasks/all-channel-lark-native-ai-controlled-preview-executor-v1.md
```

## Required verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-controlled-preview-executor.test.js
node --test tests/scripts/lark-native-ai-controlled-preview-executor.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification must also pass focused Meta, WooCommerce, Chatwoot and TikTok regressions on the exact Head.

## Out of scope

- Remote Lark Record read/write;
- actual Lark Native AI invocation;
- schema/View mutation;
- D1/Queue/Worker/Provider action;
- Automation or Group Notification;
- Schedule activation;
- Production;
- modification of PR #421 or PR #445 files.
