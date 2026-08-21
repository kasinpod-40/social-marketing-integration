# Current Task — Facebook Organic Live Rematerialization Rollout v1

## Status

```text
TASK_STATUS                         = REPOSITORY_COMPLETE_LIVE_EXECUTION_PENDING
CURRENT_PROGRAM                     = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
AGGREGATION_REPAIR_PR               = 662_MERGED
AGGREGATION_REPAIR_SHA              = 0d8cac334405d755a108f2adea65e9cc6f4cd646
ROLLOUT_PR                          = 663_MERGED
ROLLOUT_PR_HEAD                     = c2c73ebe1117018c73375f9903e152c6430c8848
ROLLOUT_MERGE_SHA                   = 55435bbabbf5788a2cb76790ed5e0b3d137587fb
FINAL_BRANCH_VERIFICATION           = 32446529335_SUCCESS
FINAL_BRANCH_VERIFICATION_JOB       = 96667104644_SUCCESS
INTEGRATION_WORKSPACE               = LIVE_TERMINAL_EXECUTION_PENDING
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

นำ Shared Organic aggregation repair ที่ merge แล้วไป materialize จริงใน Integration Workspace โดย deploy current `main` แบบรักษา execution/runtime flags ปัจจุบันของ Worker exact แล้ว refresh เฉพาะ Facebook Organic Report 1D/3D/7D/30D จาก authoritative D1 facts ไป Lark Report tables โดยไม่ยิง Facebook Provider ใหม่ ไม่เปิด/ปิด Schedule โดยไม่ตั้งใจ และไม่แตะ Production/Customer Base.

## Repository state

Repository implementation ปิดแล้ว:

- PR #662 แก้ Shared Organic aggregation และ merge ที่ `0d8cac334405d755a108f2adea65e9cc6f4cd646`.
- PR #663 เพิ่ม exact-runtime-preserving live operator และ merge ที่ `55435bbabbf5788a2cb76790ed5e0b3d137587fb`.
- Final Branch Verification ของ PR #663: Run `32446529335`, Job `96667104644`, `SUCCESS` ทุก step.
- prior active `CHANGELOG.md` ถูก preserve verbatim ที่ `docs/archive/CHANGELOG-before-facebook-observed-aggregation-live-rollout-2026-08-21.md` ก่อนเริ่ม concise active changelog ปัจจุบัน.

## Live operator

```text
scripts/facebook-organic-live-rematerialization-rollout.mjs
```

Contract ที่ merge แล้ว:

1. Plan-only เป็น default; live ต้องมี exact confirmation token.
2. Execute/recovery ต้องรันจาก clean `main == origin/main` และ main ต้องมี aggregation repair SHA เป็น ancestor.
3. อ่าน active Worker version และทุก remote `MKT_*_ENABLED` flag ก่อน mutation.
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

## Verification evidence

Final PR #663 Branch Verification:

```text
Head  = c2c73ebe1117018c73375f9903e152c6430c8848
Run   = 32446529335
Job   = 96667104644
State = SUCCESS
```

Passed:

- syntax architecture and hygiene
- focused Report source readiness
- focused Meta history finalizer
- focused Woo completed-state race recovery
- focused Chatwoot final UAT
- focused staged TikTok
- full Unit + Workers runtime
- Report reliability regression
- dependency audit
- Wrangler deploy dry-run
- diff whitespace check

## Remaining action

เหลือ **Live Integration execution หนึ่งครั้ง** จากเครื่องที่มี `.dev.vars`, Lark credential และ Cloudflare/Wrangler authorization จริงเท่านั้น. Repository CI ไม่มี credential path สำหรับ mutation นี้และไม่มี Cloudflare/Lark connector ใน ChatGPT session จึงห้ามจำลองผลหรืออ้างว่า Live สำเร็จก่อนรัน operator จริง.

Live success ต้องคืน:

- exact pre/deploy/overlay(if any)/restore/final Worker Version IDs
- 4 Facebook Report IDs + payload checksums สำหรับ 1D/3D/7D/30D
- D1↔Lark metric mismatch = 0 ทุก window
- Latest Likes/Comments/Shares/Engagement เป็น numeric observed totals
- new/open Report DLQ = 0
- active Report locks/work = 0
- open Report critical alerts = 0
- exact pre/post runtime flag fingerprint เท่ากัน
- Provider request = 0
- Production mutation = 0

หลัง Live output ผ่านครบจึงเปลี่ยน `TASK_STATUS` เป็น `COMPLETE` ได้.
