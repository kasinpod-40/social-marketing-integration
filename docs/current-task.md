# Current Task — Multichannel Report & Schedule Final Closure v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_LOCAL_GATES_PASS
CURRENT_PROGRAM                     = MULTICHANNEL_REPORT_SCHEDULE_FINAL_CLOSURE_V1
BRANCH                              = codex/multichannel-report-schedule-final-closure-v1
EXACT_BASE                          = 4ce122e399210f45c92249f0235baa63c5ccc2a3
PR                                  = PENDING
VERIFIED_CODE_HEAD                  = PENDING_COMMIT
INTEGRATION_WORKSPACE_ACTIVATION    = PENDING_POST_MERGE_CONTROLLED_PREFLIGHT
PRODUCTION                          = BLOCKED
```

## Objective

ปิดงาน Report และ Schedule ของ Integration Workspace บน Shared runtime เดิม โดย:

- promote `meta_ads`, `google_ads` และ `chatwoot` จาก retained Live/UAT evidence เท่านั้น;
- ใช้ `report.materialization.generate` สำหรับทุก reviewed channel และช่วง `1D/3D/7D/30D`;
- เติม Source schedule ที่ขาดสำหรับ Meta Ads และ Chatwoot;
- รักษา Google Ads Manager Script เป็น external provider-owned scheduler;
- สร้าง Daily/Weekly Report schedule ที่ใช้ Stable operation identity, D1-primary source,
  Shared Lark materializations และ Queue batch fan-out;
- ให้ทุก execution/schedule flag ยัง default `false`; Production ไม่อยู่ใน scope.

## Authority and retained evidence

Repository review เริ่มจาก latest `origin/main` และ open PRs ก่อน implementation. ไม่มี open PR
ที่แก้ไฟล์ runtime/catalog/scheduler ชุดเดียวกัน ณ เวลาเริ่มงาน.

Retained evidence ที่อนุญาตให้ promote:

- Meta Ads: reviewed July activity D1/Lark parity และ Shared Report multiwindow closure;
- Google Ads: retained signed-delivery LIVE UAT, 1,375 rows / six datasets / D1-Lark parity;
- Chatwoot: retained Initial + Daily source UAT, 65 Conversations, 2,071 Messages และ
  Shared Report `1D/3D/7D/30D` closure;
- Facebook R2 evidence:
  `outputs/meta-d1-only-rollout/facebook/meta-facebook-daily-20260808-r2/summary.json`
  และ `outputs/meta-lark-parity-rollout/facebook/meta-facebook-daily-20260808-r2/`;
  accepted repository Head `2f4bcda22af2e8b3084e7f6c53ba8e9dac85098c`, parity/rerun pass,
  restored all-false และ schedule activation count `0`.

ห้าม replay/resend Facebook R2 และห้ามแก้ retained evidence.

## Implementation contract

### Catalog and routing

- `meta_ads`, `google_ads`, `chatwoot` เป็น `active` แต่ยังต้องผ่าน explicit runtime flags;
- Meta Ads รองรับ `manual_uat` และ `scheduled`;
- Chatwoot รองรับ Initial, manual daily incremental และ `chatwoot_scheduled_daily`;
- Google Ads signed delivery รองรับ manual/external scheduled ingress เดิม;
- Shared Report รองรับ manual preset, custom range และ `dashboard_scheduled`.

### Source schedules

| Channel | Source schedule contract | Default |
|---|---|---|
| Facebook | primary cron, 07:30 Asia/Bangkok | false |
| Instagram | primary cron, 07:35 Asia/Bangkok | false |
| TikTok Organic | existing Lark watermark probe on primary cron | false |
| YouTube | existing six-hour cron; Analytics 07:50 source timezone | false |
| Meta Ads | primary cron, prior completed Bangkok day, one Stable job/account alias, 07:40 | false |
| Google Ads | external Manager Script trigger; signed ingress and Queue reference job | false |
| WooCommerce | existing primary cron, 01:30 Asia/Bangkok | false |
| Chatwoot | primary cron, Daily incremental 3-day overlap, 07:45 | false |

### Report schedules

- Daily 08:10 Asia/Bangkok: 32 jobs = 8 active platforms × `1D/3D/7D/30D`;
- Weekly Monday 08:15 Asia/Bangkok: 8 jobs = 8 active platforms × `7D`;
- platforms: Facebook, Instagram, TikTok, YouTube, Meta Ads, Google Ads, WooCommerce, Chatwoot;
- TikTok Ads ยัง `planned` และถูก exclude โดย registry status;
- each job uses canonical `report_setting_key`, previous completed local day,
  Stable `operationId/workKey/generation` and Shared D1/Lark runtime;
- duplicate cron delivery and Daily/Weekly 7D overlap converge by stable Report keys/upsert;
- Queue uses `sendBatch` for fan-out when available and retains sequential compatibility fallback;
- scheduled reports require global D1/preset gates plus Meta/Woo report-read gates before enqueue.

### Safety

- every example flag remains `false`;
- Producer/consumer gate drift fails before Queue mutation;
- Chatwoot Webhook + polling schedule is rejected;
- Meta Ads requires reviewed account mappings and D1/Lark write gates;
- money/null semantics remain owned by the existing Shared platform adapters and materializer;
- no new channel-specific report engine, schema migration, Provider replay or Production action.

## Acceptance criteria

- Catalog and Job Catalog match retained evidence and no protected-UAT alias remains required.
- All reviewed Report channels emit `1D/3D/7D/30D` through one shared job type.
- Meta Ads and Chatwoot schedules emit deterministic, retry-safe Queue identities.
- Google Ads schedule boundary remains the external Manager Script and does not create a duplicate cron producer.
- Daily/Weekly fan-out is bounded and batched.
- Source and Report schedules can coexist where their runtime contracts permit it.
- Default config stays all-false and Production stays blocked.
- Full repository gates pass on exact PR Head, then again after synchronization with latest main.
- Merge and post-merge CI must complete before any Integration Workspace activation.

## Implementation result

### Files and behavior

- Promoted three retained-UAT connectors/jobs and centralized new trigger contracts.
- Added Meta Ads and Chatwoot primary-cron jobs with gate parity and Stable identity.
- Replaced legacy scheduled Daily/Weekly TikTok-only report jobs with registry-derived Shared
  multichannel materializations.
- Added scheduled Report Stable Queue identity and canonical setting-key construction.
- Enabled independent source/report runtime gates and Queue `sendBatch` fan-out.
- Updated all-false examples and regression tests; no migration or retained evidence changed.

### Commands and local verification

```text
npm ci                                      PASS
npm run check                               PASS
npm test                                    PASS (Unit 2,873; Workers 18)
npm run test:report-reliability             PASS (105)
npm audit --audit-level=high                PASS (0 vulnerabilities)
WRANGLER_LOG_PATH=/tmp/... npm run deploy:dry-run
                                            PASS (both Workers)
focused catalog/router/scheduler tests      PASS
```

The Workers runtime suite is invoked through `vitest.worker.config.js`; a direct standalone
Vitest attempt was discarded because it did not load the Cloudflare Workers pool and therefore
could not resolve `cloudflare:test`.

Initial push-event CI on Head `d031353f` completed every functional gate but its final whitespace
step built the invalid revision `origin/...HEAD` because `github.base_ref` is empty on `push`.
The PR-event Branch Verification and Meta End-to-End Verification on the same exact Head passed.
The workflow now falls back to the repository default branch for push/manual events and includes a
regression test; no product runtime behavior was changed by this CI correction.

### Remote and release result

```text
Branch push / PR / exact-head CI             PENDING
Latest-main synchronization                  PENDING
Merge / post-merge CI                        PENDING
Integration Workspace source activation      PENDING
Integration Workspace report activation      PENDING
Google Ads external trigger activation        PENDING_PROVIDER_BOUNDARY
Production                                    BLOCKED
```

Before remote activation, require exact merged main, clean worktree, current credentials,
Queue/DLQ/lock idle checks, zero schedule conflicts, reviewed account mappings/table bindings and
fresh readback. Activate channel source schedules separately; activate Daily/Weekly reports only
after every required source/report gate is verified. If any boundary is unavailable, stop without
partial flag drift and provide one exact continuation command.

## Required gates

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
WRANGLER_LOG_PATH=/tmp/social-mkt-wrangler-dry-run.log npm run deploy:dry-run
git diff --check
```
