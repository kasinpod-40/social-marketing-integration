# Current Task — Facebook Organic Live Rematerialization Rollout v1

## Status

```text
TASK_STATUS                         = LIVE_EXECUTION_BLOCKED_REPOSITORY_HOTFIX_IN_PROGRESS
CURRENT_PROGRAM                     = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
AGGREGATION_REPAIR_PR               = 662_MERGED
AGGREGATION_REPAIR_SHA              = 0d8cac334405d755a108f2adea65e9cc6f4cd646
ROLLOUT_PR                          = 663_MERGED
ROLLOUT_PR_HEAD                     = c2c73ebe1117018c73375f9903e152c6430c8848
ROLLOUT_MERGE_SHA                   = 55435bbabbf5788a2cb76790ed5e0b3d137587fb
FINAL_BRANCH_VERIFICATION           = 32446529335_SUCCESS
FINAL_BRANCH_VERIFICATION_JOB       = 96667104644_SUCCESS
LIVE_PREFLIGHT_INCIDENT             = JSON_BOOLEAN_WORKER_BINDING_NOT_ADMITTED
HOTFIX_BRANCH                       = work/facebook-organic-json-flag-binding-hotfix-v1
INTEGRATION_WORKSPACE               = LIVE_EXECUTION_BLOCKED_BEFORE_MUTATION
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

นำ Shared Organic aggregation repair ที่ merge แล้วไป materialize จริงใน Integration Workspace โดย deploy current `main` แบบรักษา execution/runtime flags ปัจจุบันของ Worker exact แล้ว refresh เฉพาะ Facebook Organic Report 1D/3D/7D/30D จาก authoritative D1 facts ไป Lark Report tables โดยไม่ยิง Facebook Provider ใหม่ ไม่เปิด/ปิด Schedule โดยไม่ตั้งใจ และไม่แตะ Production/Customer Base.

## Repository state

Repository implementation หลักปิดแล้ว:

- PR #662 แก้ Shared Organic aggregation และ merge ที่ `0d8cac334405d755a108f2adea65e9cc6f4cd646`.
- PR #663 เพิ่ม exact-runtime-preserving live operator และ merge ที่ `55435bbabbf5788a2cb76790ed5e0b3d137587fb`.
- Final Branch Verification ของ PR #663: Run `32446529335`, Job `96667104644`, `SUCCESS` ทุก step.
- prior active `CHANGELOG.md` ถูก preserve verbatim ที่ `docs/archive/CHANGELOG-before-facebook-observed-aggregation-live-rollout-2026-08-21.md` ก่อนเริ่ม concise active changelog ปัจจุบัน.

## Live execution incident — 2026-08-21

Controlled live attempts ยังไม่ถึง remote mutation boundary. รอบล่าสุดผ่าน exact main/config-authority/local topology validationแล้ว แต่หยุดที่ `local-config-and-current-runtime` ด้วย `FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_BINDING_TYPE_INVALID` สำหรับ `MKT_CONNECTOR_FACEBOOK_ENABLED`; `overlayDeploymentAttempted=false`, Provider request = 0 และ Production mutation = 0.

Root cause อยู่ใน live operator readback contract: `extractRemoteExecutionFlagMap()` ยอมรับเฉพาะ Cloudflare Worker binding type `plain_text`. Wrangler/Workers รองรับ `vars` ที่เป็น non-string ด้วย โดย serialize เป็น Worker binding type `json`; Boolean feature flag จึงสามารถกลับมาจาก `wrangler versions view --json` เป็น `{ type: "json", json: true|false }` ได้อย่างถูกต้อง. Hotfix ต้องรับเฉพาะ `plain_text` boolean text และ `json` boolean จริง, ปฏิเสธ binding type อื่นทั้งหมด และคง fail-closed สำหรับ JSON ที่ไม่ใช่ Boolean.

Live retries ก่อนหน้านี้เกิดก่อน `deploy-baseline.attempt.json`/Queue send จึงไม่มี retained mutation attempt. ห้ามอ้างว่า Live สำเร็จก่อน hotfix merge + CI + controlled execution ใหม่.

## Live operator

```text
scripts/facebook-organic-live-rematerialization-rollout.mjs
```

Contract:

1. Plan-only เป็น default; live ต้องมี exact confirmation token.
2. Execute/recovery ต้องรันจาก clean `main == origin/main` และ main ต้องมี aggregation repair SHA เป็น ancestor.
3. อ่าน active Worker version และทุก remote `MKT_*_ENABLED` flag ก่อน mutation. Boolean flags อาจมาจาก Cloudflare `plain_text` หรือ `json` binding; ค่าอื่น/ชนิดอื่น fail closed.
4. Remote flag ที่ไม่มีใน current main = hard fail; local-only flag ใหม่ต้อง default false.
5. Deploy current main ด้วย captured runtime flag vector exact.
6. ถ้าสอง Shared Report flags ยังไม่เปิด ให้เปิดชั่วคราวเฉพาะ `MKT_REPORT_D1_READ_ENABLED` และ `MKT_REPORT_PRESET_MATERIALIZATION_ENABLED`.
7. Refresh เฉพาะ existing stable Facebook Report IDs 1D/3D/7D/30D ผ่าน existing Queue/materializer.
8. Provider request = 0, manual Lark patch = 0, synthetic history = 0.
9. ก่อน Queue send ต้อง zero active Report work/locks/open Report DLQ/critical alerts และ zero pending migrations.
10. สร้าง private D1 backup หนึ่งครั้งก่อน Queue mutation แรก.
11. ทุก window ต้องเปลี่ยน payload checksum ภายใต้ Stable ID เดิม, complete, แล้ว D1↔Lark stable metric parity ต้อง zero drift.
12. Latest Likes/Comments/Shares/Engagement ต้องกลับเป็น numeric observed aggregates โดย source missing members ยังคง null; ห้าม fabricate zero.
13. ถ้ามี temporary Report overlay ต้อง restore exact captured baseline ใน `finally` และ verify complete flag vector.
14. Recorded deploy/send attempt ห้าม blind `--execute` ซ้ำ; `--recover` restore/verify ได้แต่ Queue send = 0.
15. Production และ PR #661 = zero mutation.

## Required hotfix verification

ก่อน merge hotfix ต้องผ่านอย่างน้อย:

- focused `facebook-organic-live-rematerialization-rollout` unit tests
- `plain_text` Boolean flag extraction
- Cloudflare `json` Boolean flag extraction from `binding.json`
- reject JSON non-Boolean execution flag
- reject unsupported/secret execution binding type
- existing exact baseline/overlay/restoration tests
- full `npm run check`
- full unit + Workers runtime
- `npm run test:report-reliability`
- `npm audit`
- `npm run deploy:dry-run`

## Prior verification evidence

Final PR #663 Branch Verification:

```text
Head  = c2c73ebe1117018c73375f9903e152c6430c8848
Run   = 32446529335
Job   = 96667104644
State = SUCCESS
```

## Remaining action

1. Merge the minimal Worker-binding readback hotfix after CI.
2. Controlled Live Integration execution one time from clean updated `main` using the retained local Integration authority config; no Provider refresh and no Production mutation.
3. Live success must return exact Worker version IDs, 4 Facebook Report IDs/checksums, D1↔Lark mismatch 0, numeric latest aggregate totals, zero Report DLQ/locks/work/critical alerts, exact pre/post runtime flag fingerprint, Provider request 0 and Production mutation 0.
4. Only after that evidence passes may `TASK_STATUS` become `COMPLETE`.
