# Current Task — Facebook Organic Live Rematerialization Rollout v1

## Status

```text
TASK_STATUS                         = REPOSITORY_COMPLETE_LIVE_EXECUTION_PENDING
CURRENT_PROGRAM                     = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
AGGREGATION_REPAIR_PR               = 662_MERGED
AGGREGATION_REPAIR_SHA              = 0d8cac334405d755a108f2adea65e9cc6f4cd646
ROLLOUT_PR                          = 663_MERGED
ROLLOUT_MERGE_SHA                   = 55435bbabbf5788a2cb76790ed5e0b3d137587fb
HOTFIX_PR                           = 665_MERGED
HOTFIX_PR_HEAD                      = 728cdfec7b0ec082db1b0d8e23c4829f37f32c26
HOTFIX_BRANCH_VERIFICATION          = 32453689935_SUCCESS
HOTFIX_BRANCH_VERIFICATION_JOB      = 96686791658_SUCCESS
HOTFIX_MERGE_SHA                    = 0c7a06430d7f9f87bf85bda3313e2d3b5940bb91
LIVE_PREFLIGHT_INCIDENT             = JSON_BOOLEAN_WORKER_BINDING_FIXED
INTEGRATION_WORKSPACE               = LIVE_TERMINAL_EXECUTION_PENDING
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

นำ Shared Organic aggregation repair ที่ merge แล้วไป materialize จริงใน Integration Workspace โดย deploy current `main` แบบรักษา execution/runtime flags ปัจจุบันของ Worker exact แล้ว refresh เฉพาะ Facebook Organic Report 1D/3D/7D/30D จาก authoritative D1 facts ไป Lark Report tables โดยไม่ยิง Facebook Provider ใหม่ ไม่เปิด/ปิด Schedule โดยไม่ตั้งใจ และไม่แตะ Production/Customer Base.

## Repository state

Repository implementation พร้อมสำหรับ controlled live retry แล้ว:

- PR #662 แก้ Shared Organic aggregation และ merge ที่ `0d8cac334405d755a108f2adea65e9cc6f4cd646`.
- PR #663 เพิ่ม exact-runtime-preserving live operator และ merge ที่ `55435bbabbf5788a2cb76790ed5e0b3d137587fb`.
- PR #665 แก้ Cloudflare JSON Boolean Worker-binding readback ทั้ง live preflight และ shared post-deploy verifier; exact head `728cdfec7b0ec082db1b0d8e23c4829f37f32c26`, Branch Verification Run `32453689935`, Job `96686791658`, `SUCCESS` ทุก step, merge เข้า `main` ที่ `0c7a06430d7f9f87bf85bda3313e2d3b5940bb91`.
- prior active `CHANGELOG.md` ถูก preserve verbatim ที่ `docs/archive/CHANGELOG-before-facebook-observed-aggregation-live-rollout-2026-08-21.md` ก่อนเริ่ม concise active changelog ปัจจุบัน.

## Live execution incident — 2026-08-21

Controlled live attempts ก่อน PR #665 ยังไม่ถึง remote mutation boundary. รอบล่าสุดผ่าน exact main/config-authority/local topology validationแล้ว แต่หยุดที่ `local-config-and-current-runtime` ด้วย `FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_BINDING_TYPE_INVALID` สำหรับ `MKT_CONNECTOR_FACEBOOK_ENABLED`; `overlayDeploymentAttempted=false`, Provider request = 0 และ Production mutation = 0.

Root cause แรกอยู่ใน live operator readback contract: `extractRemoteExecutionFlagMap()` เดิมยอมรับเฉพาะ Cloudflare Worker binding type `plain_text`. Wrangler/Workers รองรับ non-string `vars` เป็น Worker binding type `json`; Boolean feature flag จึงสามารถกลับมาจาก `wrangler versions view --json` เป็น `{ type: "json", json: true|false }` ได้อย่างถูกต้อง.

Audit ต่อพบ guard ชั้นที่สองใน shared `report-runtime-closeout-reviewed-remote.js`: deployment verifier เดิมนับ true execution flags จาก `plain_text` เท่านั้น. PR #665 ปิดทั้งสองจุดก่อนอนุญาต live retry เพื่อไม่ให้รอบถัดไปผ่าน preflight แล้วค่อย fail หลัง baseline deploy.

Hotfix ที่ merge แล้วรับเฉพาะ `plain_text` boolean text และ `json` boolean จริง, ปฏิเสธ binding type อื่นทั้งหมด, fail-closed สำหรับ JSON ที่ไม่ใช่ Boolean, ตรวจ duplicate conflict และ preserve Boolean-vs-string representation ของ local Wrangler vars ตอนสร้าง baseline/overlay.

Live attempts เดิมเกิดก่อน `deploy-baseline.attempt.json`/Queue send จึงไม่มี retained mutation attempt และไม่ต้อง recovery/rollback.

## Live operator

```text
scripts/facebook-organic-live-rematerialization-rollout.mjs
```

Contract:

1. Plan-only เป็น default; live ต้องมี exact confirmation token.
2. Execute/recovery ต้องรันจาก clean `main == origin/main` และ main ต้องมี aggregation repair SHA เป็น ancestor.
3. อ่าน active Worker version และทุก remote `MKT_*_ENABLED` flag ก่อน mutation. Boolean flags อาจมาจาก Cloudflare `plain_text` หรือ `json` binding; ค่าอื่น/ชนิดอื่น fail closed.
4. Shared deployment verification ใช้ semantic Boolean vector เดียวกันและห้าม ignore JSON Boolean flags.
5. Remote flag ที่ไม่มีใน current main = hard fail; local-only flag ใหม่ต้อง default false.
6. Deploy current main ด้วย captured runtime flag vector exact และ preserve local binding representation.
7. ถ้าสอง Shared Report flags ยังไม่เปิด ให้เปิดชั่วคราวเฉพาะ `MKT_REPORT_D1_READ_ENABLED` และ `MKT_REPORT_PRESET_MATERIALIZATION_ENABLED`.
8. Refresh เฉพาะ existing stable Facebook Report IDs 1D/3D/7D/30D ผ่าน existing Queue/materializer.
9. Provider request = 0, manual Lark patch = 0, synthetic history = 0.
10. ก่อน Queue send ต้อง zero active Report work/locks/open Report DLQ/critical alerts และ zero pending migrations.
11. สร้าง private D1 backupหนึ่งครั้งก่อน Queue mutation แรก.
12. ทุก window ต้องเปลี่ยน payload checksum ภายใต้ Stable ID เดิม, complete, แล้ว D1↔Lark stable metric parity ต้อง zero drift.
13. Latest Likes/Comments/Shares/Engagement ต้องกลับเป็น numeric observed aggregates โดย source missing members ยังคง null; ห้าม fabricate zero.
14. ถ้ามี temporary Report overlay ต้อง restore exact captured baseline ใน `finally` และ verify complete flag vector.
15. Recorded deploy/send attempt ห้าม blind `--execute` ซ้ำ; `--recover` restore/verify ได้แต่ Queue send = 0.
16. Production และ PR #661 = zero mutation.

## Hotfix verification evidence

PR #665 exact head:

```text
Head  = 728cdfec7b0ec082db1b0d8e23c4829f37f32c26
Run   = 32453689935
Job   = 96686791658
State = SUCCESS
Merge = 0c7a06430d7f9f87bf85bda3313e2d3b5940bb91
```

Passed:

- syntax architecture and hygiene
- focused Report source readiness
- focused Meta history finalizer
- focused Woo completed-state race recovery
- focused Chatwoot final UAT
- focused staged TikTok
- full Unit + Workers runtime, including JSON Boolean rollout/shared-verifier tests
- Report reliability regression
- dependency audit
- Wrangler deploy dry-run
- diff whitespace check
- diagnostics/post steps

## Remaining action

1. Controlled Live Integration execution one time from clean current `main` at/after `0c7a06430d7f9f87bf85bda3313e2d3b5940bb91` using the retained local Integration authority config; no Provider refresh and no Production mutation.
2. Live success must return exact Worker version IDs, 4 Facebook Report IDs/checksums, D1↔Lark mismatch 0, numeric latest aggregate totals, zero Report DLQ/locks/work/critical alerts, exact pre/post runtime flag fingerprint, Provider request 0 and Production mutation 0.
3. Only after that evidence passes may `TASK_STATUS` become `COMPLETE`.
