# YouTube Organic Integration Wiring and Safe Rollout

## Status

```text
TASK                         = youtube-organic-integration-wiring-safe-rollout
BRANCH                       = integration/youtube-organic-safe-rollout
BASE_MAIN                    = 8b7f9a879ba0c1b0b5d89dcfa2373ad3bb3c2ce8
SOURCE_DRAFT_PR              = #72
SOURCE_REVIEW_DECISION       = PASS_FOR_INTEGRATION
IMPLEMENTATION               = COMPLETE / VERIFICATION_PASS
INTEGRATION_PR               = #85 / DRAFT
VERIFIED_HEAD                = a8f39d1460982cf84ca69e27b6519b1037f71c4d
BRANCH_VERIFICATION          = #579 PASS
MERGE_TO_MAIN                = NOT_RUN
REMOTE_SCHEMA_CHECK          = NOT_RUN
WORKER_DEPLOYMENT            = NOT_RUN
QUEUE_MESSAGE                = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION   = NONE
SCHEDULE                     = DISABLED
LIVE_UAT                     = NOT_RUN
PRODUCTION                   = BLOCKED
```

## Objective

นำ YouTube Organic End-to-End ที่ผ่าน Integration Review เข้าสู่ Shared Worker routing โดยไม่เปลี่ยนพฤติกรรมเดิมเมื่อ Feature flag ใหม่ยังปิด และเตรียมค่า Configuration สำหรับการ deploy แบบ safe-closed ในงาน Remote ที่อนุมัติแยกต่างหาก

## In scope

- นำ Reviewed YouTube implementation จาก PR #72 เข้าสาขา Integration
- เพิ่ม Shared active router ที่เลือก D1-first route เฉพาะเมื่อ `MKT_YOUTUBE_END_TO_END_ENABLED=true`
- รักษา Legacy YouTube route เมื่อ Flag ไม่ระบุหรือเป็น `false`
- ใช้ Shared YouTube runtime config สำหรับ Dedicated flags
- เพิ่ม Flag ตัวอย่างใน `.dev.vars.example` และ `wrangler.sync.example.jsonc`
- เพิ่ม Regression สำหรับ route selection, default-false config และ non-YouTube fallback
- อัปเดต Current Task และ Project Brain ก่อน Merge; README/CHANGELOG closeout remains merge-owned documentation follow-up
- รัน Repository gates บน Exact Integration head

## Out of scope

```text
Remote D1 schema read/apply
Remote D1 Business write
Remote Lark read/write/schema mutation
Queue send or DLQ action
Worker deployment
Schedule enablement
Provider/API execution
Customer or Production LIVE UAT
Report D1-primary cutover
Retention or delete
```

## Routing contract

```text
YouTube job + MKT_YOUTUBE_END_TO_END_ENABLED=true
  -> processYouTubeOrganicEndToEndJob

YouTube job + flag false/unset
  -> existing Google Ads/TikTok/History/Active router chain
  -> existing legacy YouTube route

Non-YouTube job
  -> existing router chain unchanged
```

The dedicated route retains its own fail-closed check. Shared selection does not bypass Connector, D1-write or Lark-write gates.

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

## Safe rollout order after repository merge

Every Remote phase requires separate operator authorization and an authenticated local Integration Workspace runtime:

1. Verify real Remote D1 schema contains Storage Foundation `0009` tables; read-only only.
2. Confirm current deployed Worker and all YouTube/Storage/Report/Schedule flags.
3. Deploy exact merged code with all dedicated/shared Business and Schedule flags false.
4. Verify Worker health and unrelated Google Ads/TikTok/Meta routes remain safe.
5. Enable only Connector + End-to-End route for a separately approved dry-run/read-only job.
6. Verify non-dry execution is rejected while D1 or Lark gate remains false.
7. Authorize controlled DEV D1-first/Lark UAT separately.
8. Validate Coverage, idempotent rerun and D1 Report shadow parity.
9. Keep Schedule and Production blocked until a new explicit approval.

## Implementation result

Repository changes:

```text
apps/sync-worker/src/youtube-organic-active-job-router.js          added
apps/sync-worker/src/index.js                                      shared processJob export wired
apps/sync-worker/src/youtube-organic-job-router.js                 shared flag loader adopted
packages/config/src/youtube-organic-runtime-config.js              dedicated flags added
.dev.vars.example                                                  default-false flags added
wrangler.sync.example.jsonc                                        default-false flags added
tests/application/youtube-organic-shared-routing.test.js           added
docs/archive/current-task-before-youtube-organic-integration-2026-07-27.md added
```

The integration branch was fast-forwarded from current `main` to the exact reviewed PR #72 head before shared wiring. No direct push to `main` occurred.

## Verification evidence

GitHub Actions Branch Verification on exact head `a8f39d1460982cf84ca69e27b6519b1037f71c4d`:

```text
Run / workflow ID                 #579 / 30241398413
Install locked dependencies       PASS
Syntax / architecture / hygiene   PASS
Focused staged TikTok             4/4 PASS
Node Unit / Integration           916/916 PASS
Workers runtime                   9/9 PASS
Report reliability                91/91 PASS
Dependency audit                  0 vulnerabilities
Wrangler dry-run                  PASS
Diagnostics upload                PASS
```

## Acceptance criteria

- [x] PR #72 implementation imported without altering Business facts
- [x] Shared router selects End-to-End only when the dedicated flag is true
- [x] Flag false/unset preserves the existing route
- [x] Non-YouTube routing remains unchanged
- [x] Dedicated and Lark flags exist in shared runtime config
- [x] Example/Wrangler flags default false
- [x] No migration added
- [x] No Remote action performed
- [x] Syntax / architecture / hygiene PASS
- [x] Focused TikTok regression PASS
- [x] Unit and Workers runtime tests PASS
- [x] Report reliability regression PASS
- [x] Dependency audit PASS
- [x] Wrangler dry-run PASS
- [ ] Integration PR reviewed and merged into main

## Remaining authority boundary

Repository merge does not authorize Remote schema inspection, deployment, Provider calls, Business writes, Queue messages, Schedule activation or LIVE UAT. Those actions require an authenticated runtime and a separately recorded approval/evidence chain.
