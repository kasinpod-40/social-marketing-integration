# Current Task — YouTube Organic Integration Wiring and Safe Rollout

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_VERIFICATION_PENDING
CURRENT_PROGRAM                     = YOUTUBE_ORGANIC_INTEGRATION_WIRING
INTEGRATION_BRANCH                  = integration/youtube-organic-safe-rollout
BASE_MAIN                           = 8b7f9a879ba0c1b0b5d89dcfa2373ad3bb3c2ce8
SOURCE_DRAFT_PR                     = #72
SOURCE_REVIEW_DECISION              = PASS_FOR_INTEGRATION
REMOTE_SCHEMA_CHECK                 = NOT_RUN
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
SCHEDULES                           = DISABLED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT_RUN
PRODUCTION                          = BLOCKED
```

## Objective

นำ YouTube Organic End-to-End ที่ผ่าน Review เข้าสู่ Shared Worker route และ Shared configuration โดยรักษา Safe state เมื่อ Dedicated flag ยังปิด จากนั้นผ่าน Full Repository Verification ก่อนเสนอ Merge เข้า `main`.

Detailed contract:

```text
docs/tasks/youtube-organic-integration-wiring-safe-rollout.md
```

Reviewed source implementation and review evidence:

```text
docs/tasks/youtube-organic-end-to-end.md
docs/tasks/youtube-organic-end-to-end-integration-review.md
```

## In scope

- Import exact reviewed YouTube PR #72 implementation into a new Integration branch.
- Wire Shared `processJob` through a guarded YouTube active router.
- Route YouTube D1-first only when `MKT_YOUTUBE_END_TO_END_ENABLED=true`.
- Preserve the existing active YouTube route when the flag is false or unset.
- Preserve every non-YouTube route and existing Google Ads/TikTok/Meta behavior.
- Add `MKT_YOUTUBE_END_TO_END_ENABLED` and `MKT_YOUTUBE_LARK_WRITE_ENABLED` to Shared runtime config and release examples with default `false`.
- Add focused routing/config regressions and run all Repository gates.
- Update Project Brain, README and CHANGELOG before Merge.

## Out of scope

```text
Remote D1 schema inspection or migration
Remote D1 Business writes
Remote Lark read/write/schema mutation
Worker deployment
Queue send or DLQ action
Schedule enablement
Provider/API execution
Controlled DEV or Customer LIVE UAT
Report D1-primary cutover
Retention/delete
Production
```

## Routing and flag contract

```text
YouTube + MKT_YOUTUBE_END_TO_END_ENABLED=true
  -> dedicated D1-first End-to-End route

YouTube + dedicated flag false/unset
  -> existing active router and legacy YouTube route

Non-YouTube
  -> existing active router chain unchanged
```

All examples remain safe-closed:

```text
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_YOUTUBE_END_TO_END_ENABLED=false
MKT_TIME_SERIES_D1_WRITE_ENABLED=false
MKT_YOUTUBE_LARK_WRITE_ENABLED=false
MKT_YOUTUBE_ANALYTICS_ENABLED=false
MKT_SCHEDULE_YOUTUBE_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
```

## Implementation result

Completed on `integration/youtube-organic-safe-rollout`:

- Fast-forwarded the Integration branch from current `main` to reviewed PR #72 head.
- Added `youtube-organic-active-job-router.js` as a guarded wrapper around the existing router chain.
- Updated Worker `index.js` to export the guarded router as `processJob`.
- Extended the existing YouTube runtime config rather than creating a duplicate flag framework.
- Updated the dedicated route to use the Shared YouTube config loader.
- Added default-false flags to `.dev.vars.example` and `wrangler.sync.example.jsonc`.
- Added focused routing/config tests.
- Archived the previous TikTok current task without altering its historical facts.

No Migration, Remote action, Queue message, deployment, schedule or LIVE UAT occurred.

## Acceptance criteria

- [x] Existing Shared Connector/Reliability/Queue/D1/Lark contracts reused
- [x] No duplicate engine/framework introduced
- [x] Shared router wiring implemented
- [x] Legacy route preserved while new flag is false
- [x] Non-YouTube routing unchanged
- [x] Dedicated flags default false in Shared config/examples/Wrangler
- [x] No Migration added
- [x] No Remote or LIVE action
- [ ] `npm ci`
- [ ] `npm run check`
- [ ] Focused staged TikTok regression
- [ ] `npm test`
- [ ] `npm run test:report-reliability`
- [ ] `npm audit --audit-level=high`
- [ ] `npm run deploy:dry-run`
- [ ] Exact-head PR review and Merge into `main`

## Next gate

Run Branch Verification on the exact Integration head. Only after all gates pass may the repository PR be considered for Merge. Merge does not authorize Remote deployment or UAT; the next Remote phase must begin with an authenticated read-only schema/config preflight under a separately recorded approval.

## Immutable history

Previous current task:

```text
docs/archive/current-task-before-youtube-organic-integration-2026-07-27.md
```
