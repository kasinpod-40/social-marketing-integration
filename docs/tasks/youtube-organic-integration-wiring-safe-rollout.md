# YouTube Organic Integration Wiring and Safe Rollout

## Status

```text
TASK                         = youtube-organic-integration-wiring-safe-rollout
SOURCE_DRAFT_PR              = #72
SOURCE_REVIEW_DECISION       = PASS_FOR_INTEGRATION
INTEGRATION_PR               = #85 / MERGED
MERGE_COMMIT                 = dce3bd954ee75ee55a29efac303e9973ca060fca
REVIEWED_HEAD                = c5ffc4327ffec405f82472c7b7098b45bac82722
FINAL_BRANCH_VERIFICATION    = #581 PASS
REMOTE_SCHEMA_CHECK          = NOT_RUN
WORKER_DEPLOYMENT            = NOT_RUN
QUEUE_MESSAGE                = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION   = NONE
SCHEDULE                     = DISABLED
LIVE_UAT                     = NOT_RUN
PRODUCTION                   = BLOCKED
```

## Objective and result

นำ YouTube Organic End-to-End ที่ผ่าน Integration Review เข้าสู่ Shared Worker routing โดยไม่เปลี่ยนพฤติกรรมเดิมเมื่อ Feature flag ใหม่ยังปิด งาน Repository สำเร็จและ Squash Merged เข้า `main` ผ่าน PR `#85`.

## Merged routing contract

```text
YouTube job + MKT_YOUTUBE_END_TO_END_ENABLED=true
  -> processYouTubeOrganicEndToEndJob

YouTube job + flag false/unset
  -> existing Google Ads/TikTok/History/Active router chain
  -> existing legacy YouTube route

Non-YouTube job
  -> existing router chain unchanged
```

The dedicated route retains its own Connector, D1-write and Lark-write gates. Shared selection does not bypass any fail-closed check.

## Feature flags

All release examples contain these values and default them to false:

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

## Merged implementation

```text
apps/sync-worker/src/youtube-organic-active-job-router.js
apps/sync-worker/src/index.js
apps/sync-worker/src/youtube-organic-job-router.js
packages/config/src/youtube-organic-runtime-config.js
.dev.vars.example
wrangler.sync.example.jsonc
tests/application/youtube-organic-shared-routing.test.js
```

The Integration PR also imported the reviewed End-to-End source/storage/report implementation and regressions from Draft PR `#72`.

No new Migration was added. The implementation reuses Storage Foundation `0009` and the existing Shared Connector, Reliability, Queue/DLQ, D1 history, Coverage, Lark `TableSyncEngine`, OAuth and Report contracts.

## Verification evidence

Final exact-head Branch Verification:

```text
Run / workflow ID                 #581 / 30241561017
Head                              c5ffc4327ffec405f82472c7b7098b45bac82722
Install locked dependencies       PASS
Syntax / architecture / hygiene   PASS
Focused staged TikTok             PASS
Node Unit / Integration           PASS
Workers runtime                   PASS
Report reliability                PASS
Dependency audit                  PASS
Wrangler dry-run                  PASS
Diagnostics upload                PASS
```

Prior exact-code run `#579` recorded:

```text
Node Unit / Integration           916/916 PASS
Workers runtime                   9/9 PASS
Report reliability                91/91 PASS
Focused staged TikTok             4/4 PASS
Dependency audit                  0 vulnerabilities
```

## Acceptance criteria

- [x] PR #72 implementation imported without altering Business facts
- [x] Shared router selects End-to-End only when the dedicated flag is true
- [x] Flag false/unset preserves the existing route
- [x] Non-YouTube routing remains unchanged
- [x] Dedicated and Lark flags exist in Shared runtime config
- [x] Example/Wrangler flags default false
- [x] No Migration added
- [x] Syntax / architecture / hygiene PASS
- [x] Focused TikTok regression PASS
- [x] Unit and Workers runtime tests PASS
- [x] Report reliability regression PASS
- [x] Dependency audit PASS
- [x] Wrangler dry-run PASS
- [x] Integration PR reviewed and merged into `main`
- [x] No Remote or LIVE action performed

## Safe rollout order after repository merge

Every Remote phase requires separate authorization and an authenticated local Integration Workspace runtime:

1. Verify real Remote D1 schema contains Storage Foundation `0009` tables; read-only only.
2. Confirm current deployed Worker and all YouTube/Storage/Report/Schedule flags.
3. Deploy exact merged code with all dedicated/shared Business and Schedule flags false.
4. Verify Worker health and unrelated Google Ads/TikTok/Meta routes remain safe.
5. Enable only Connector + End-to-End route for a separately approved dry-run/read-only job.
6. Verify non-dry execution is rejected while D1 or Lark gate remains false.
7. Authorize controlled Integration Workspace D1-first/Lark UAT separately.
8. Validate Coverage, idempotent rerun and D1 Report shadow parity.
9. Keep Schedule and Production blocked until a new explicit approval.

## Authority boundary

Repository merge does not authorize Remote schema inspection, deployment, Provider calls, Business writes, Queue messages, Schedule activation or LIVE UAT. No such action occurred in this task.
