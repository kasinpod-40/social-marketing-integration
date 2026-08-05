# Retained Multichannel Report Handoff Builder v1

## Objective

ปิดช่องว่างระหว่าง exact-head SELECT-only Report readiness กับ Shared Run All materialization โดยเพิ่ม
builder ที่สร้าง `multichannel_report_live_closure_handoff_v1` จาก Evidence ที่ Repository ตรวจแล้ว
แทนการเขียน JSON ด้วยมือ

## Confirmed gap

`main@79ca79c0def08a4fdcc298ea1a75a530b442868e` มีครบ:

- Report Finalizer;
- per-channel SELECT-only readiness terminal;
- reviewed multiwindow closeout;
- `report-all-ready-channels-terminal.mjs`;
- retained handoff validators.

แต่ไม่มีไฟล์ `scripts/build-retained-multichannel-report-handoff.mjs` หรือ builder อื่นที่ประกอบ
Finalizer + per-channel readiness + Meta Remote lock release authority เป็น retained all-channel handoff
ตาม Post-merge boundary ใน `docs/current-task.md`.

## Existing authorities reused

Builder ใช้ของกลางเดิมเท่านั้น:

- `assertReviewedRepositoryState`;
- `assertReportRuntimeFinalizerEvidence`;
- `assertReviewedChannelCloseoutHandoff`;
- `selectAllReadyReportChannels`;
- `sanitizeReportLiveClosureEvidence`;
- `writePrivateJson`.

ไม่มี Report engine, Queue framework, D1/Lark writer, Reliability engine, Coverage engine หรือ Runtime wrapper ใหม่

## Inputs

Default retained inputs:

```text
outputs/report-runtime-finalize/report-runtime-finalize-summary.json
outputs/facebook-report-remote-readiness/readiness-summary.json
outputs/instagram-report-remote-readiness/readiness-summary.json
outputs/youtube-report-remote-readiness/readiness-summary.json
outputs/meta_ads-report-remote-readiness/readiness-summary.json
outputs/google_ads-report-remote-readiness/readiness-summary.json
outputs/woocommerce-report-remote-readiness/readiness-summary.json
outputs/chatwoot-report-remote-readiness/readiness-summary.json
```

Meta Remote lock release authority is immutable merged PR #421:

```text
d69aa6c08bd6b87b6ab28d3fc33398f22eb18033
```

Builder requires this commit to be an ancestor of the exact clean `main == origin/main` Head.

## Output

```text
outputs/report-all-ready-channels/retained-all-channel-handoff.json
```

Output is mode `0600`, sanitized, exact-head-bound and contains:

- `liveMaterializationAuthorized=true`;
- `metaRemoteLock.released=true` with exact audit Head;
- exact Repository/Finalizer authority;
- exact readiness for every non-planned reviewed channel;
- per-channel shared closeout authority;
- Notification Admission false;
- Schedules false;
- Production blocked.

TikTok Ads remains `planned` and is skipped without fabricated readiness or Report.

## Commands

Plan-only:

```bash
node scripts/build-retained-multichannel-report-handoff.mjs
```

Guarded builder execution:

```bash
CONFIRM_BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF=BUILD_RETAINED_MULTICHANNEL_REPORT_HANDOFF \
node scripts/build-retained-multichannel-report-handoff.mjs --execute
```

Builder execution performs no Provider request, Queue action, Remote D1/Lark mutation, Worker deployment,
Schedule activation or Production action.

After this PR is merged, exact-main CI passes and the builder output validates, Live materialization remains a
separate explicit command through the existing Run All terminal:

```bash
MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=outputs/report-all-ready-channels/retained-all-channel-handoff.json \
CONFIRM_REPORT_ALL_READY_CHANNELS=RUN_ALL_READY_CHANNEL_REPORTS \
node scripts/report-all-ready-channels-terminal.mjs --execute
```

The Run All command is Remote mutation authority and is not executed by this implementation workstream.

## Verification

```bash
npm ci
npm run check
node --test tests/scripts/retained-multichannel-report-handoff.test.js
node --test tests/scripts/report-all-ready-channels.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-binding.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Safety

```text
Provider request                    0
Queue action                        0
Remote D1 mutation                  0
Remote Lark mutation                0
Worker deployment                   0
Schedule activation                 0
Notification Admission              false
Production                          BLOCKED
```
