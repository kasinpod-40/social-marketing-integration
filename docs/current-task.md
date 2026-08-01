# Current Task — All Meta End-to-End Completion v1

## Status

```text
TASK_STATUS                          = INSTAGRAM_TERMINAL_RECOVERY_FIX_IN_REVIEW
CURRENT_PROGRAM                      = ALL_META_END_TO_END_COMPLETION_V1
BRANCH                               = integration/all-meta-end-to-end-completion-v1
BASE_MAIN_SHA                        = 0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650
BASE_MAIN_PR                         = #420_MERGED
CHATWOOT_STATUS                      = CLOSED_ACCEPTED_PARTIAL_UAT
CHATWOOT_META_BLOCKER                = NO
META_RETAINED_OPERATION              = meta-facebook-history-20260701-20260731-1d12a5ec4fef
META_RETAINED_D1_PHASE               = COMPLETE_RETAINED_EVIDENCE
META_RETAINED_LARK_PHASE             = COMPLETE_ACCEPTED_PARITY
META_PROVIDER_REPLAY                 = FORBIDDEN_FOR_RETAINED_FACEBOOK_OPERATION
META_D1_QUEUE_RESEND                 = FORBIDDEN_FOR_RETAINED_FACEBOOK_OPERATION
SCHEDULE_WEBHOOK                     = DISABLED_REQUIRED
PRODUCTION                           = BLOCKED
META_LATEST_STOP                     = INSTAGRAM_ACCOUNT_INSIGHTS_PERIOD_REQUIRED
NEXT_STEP                            = EXACT_INSTAGRAM_SAME_OPERATION_RECOVERY_AFTER_CI
```

## Objective

ปิดงาน Meta ใน Integration Workspace แบบ End-to-End ตั้งแต่ retained Facebook continuation,
Instagram Organic, Meta Ads สองบัญชี, Shared D1/Lark parity, Report materializations และ Lark Native
Dashboard readback แล้วส่งผ่าน Draft PR, exact-head CI, review และ Squash Merge เข้า `main` โดยรักษา
ทุก existing Reliability/Queue/Work/Lock/Coverage/Stable-key guard.

รายละเอียด Scope และ execution contract อยู่ที่:

```text
docs/tasks/all-meta-end-to-end-completion-v1.md
```

## In scope

- ตรวจ latest `origin/main`, open/merged PR, retained local evidence และ Meta Remote state แบบ read-only;
- ทำต่อ retained Facebook July operation จาก D1-complete ไป Lark โดยไม่ Provider replay หรือ D1 resend;
- ทำ Instagram July และ Meta Ads required/conditional history ผ่าน existing Meta finalizer;
- ตรวจ Coverage, D1/Lark parity, same-operation replay และ all-false restore;
- ใช้ generic Report architecture สำหรับ Facebook Organic, Instagram Organic และ Meta Ads ที่ windows
  `1/3/7/30` เท่าที่ current writer รองรับ;
- ตรวจ Lark Base และ Native Dashboard แบบ Live readback ผ่าน supported compatibility paths;
- อัปเดตเอกสาร, tests, CI, review, Squash Merge และ post-merge read-only verification.

## Out of scope / permanent blocks

- Direct push เข้า `main`;
- Production, Schedule, Cron หรือ Webhook activation;
- direct SQL lifecycle repair หรือ direct-write Business tables;
- replay/replace retained Facebook operation;
- duplicate Connector, Queue, Reliability, D1, Lark หรือ Report engine;
- deletion/rename ของ Business facts หรือ unsupported/speculative Dashboard mutation;
- การนำ WooCommerce Report PR `#415` มาปน เว้นแต่ Shared contract บังคับและมีหลักฐานไม่ชนกัน.
- Chatwoot inspector, recovery, resume, redrive, closeout หรือการเปลี่ยน DLQ 9 / Alert 15.

## Chatwoot accepted closeout boundary

ผู้ใช้ยืนยันและยอมรับ Chatwoot เป็น `CLOSED_ACCEPTED_PARTIAL_UAT` แล้วและไม่ใช่ Meta prerequisite
หรือ blocker:

```text
Worker                              Safe baseline all-false / traffic 100%
Schedule / Webhook                  false / false
Production                          blocked
Active lock                         0
Additional Queue / D1 / Lark writes 0 / 0 / 0
Retained facts                      65 Conversations / 2,071 Messages
Work                                terminal / QUEUE_RETRY_EXHAUSTED
DLQ / Alert                         9 / 15 retained as forensic truth
Success fabrication                 forbidden
```

ห้ามเรียก Chatwoot-specific script เพิ่ม. Meta ใช้เฉพาะ Meta operator preflight เพื่อตรวจ current
Worker all-false; ถ้าพบ drift ให้หยุด Meta และรายงาน drift เท่านั้นโดยไม่เปิด Chatwoot recovery.

## Contract

1. Runtime ต้องคง `MKT_ENV=development` และ `MKT_CUSTOMER_PROFILE=integration_workspace`.
2. Remote mutation เริ่มได้หลัง Meta exact clean/evidence gate, Meta operator Worker all-false,
   Reliability idle, exact mapping และ no-blind-resend checks ผ่าน.
3. Retained Facebook operation ใช้ identity/generation เดิม; Provider replay, D1 Queue resend,
   replacement operation และ lifecycle SQL mutation เป็นศูนย์.
4. ทุก Active window เปิดเฉพาะ required flags และต้อง restore/read back all-false ใน success/failure.
5. D1 เป็น historical authority; Lark write ใช้ existing `TableSyncEngine`; Dashboard อ่าน validated
   materializations และ supported Lark contracts เท่านั้น.
6. Missing/unavailable metric เป็น `null`/N/A; observed zero เท่านั้นที่เป็น `0`.
7. Merge ได้เมื่อ Live closeout, exact-head gates/CI, branch alignment และ unresolved review = 0.
8. Retained Facebook continuation คงใช้ authority
   `scripts/meta-history-2026-exact-plan-continuation-terminal.mjs` ผ่าน reviewed-release wrapper เท่านั้น;
   ห้ามเรียก ordinary terminal เพื่อสร้าง operation ใหม่.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/meta-history-2026-terminal.test.js
node --test tests/application/meta-history-2026-finalizer.test.js
node --test tests/application/meta-history-exact-plan-continuation.test.js
node --test tests/application/meta-history-reviewed-release-terminal.test.js
node --test tests/application/meta-end-to-end-routing-and-report.test.js
node --test tests/application/multichannel-report-runtime.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Meta End-to-End Verification และ Branch Verification ต้องผ่านบน exact final PR Head พร้อม focused
WooCommerce, Chatwoot และ TikTok regressions ที่ workflow กำหนด.

## Parallel workstream boundary

Open WooCommerce Report PR `#415` owns its ten Commerce-specific files. งานนี้จะไม่แก้ไฟล์เหล่านั้น
จาก PR ดังกล่าวและจะไม่ cherry-pick/merge งานนั้นเข้ามา. Open legacy PR อื่นต้องถูกตรวจซ้ำก่อนแก้
shared documentation หรือ Lark serializer paths.

## Implementation result

เริ่ม branch จาก clean `origin/main@0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650` หลัง PR `#420`
Squash Merged แล้ว. ผู้ใช้ปิด Chatwoot เป็น accepted Partial UAT และห้ามรื้อฟื้น. PR `#415` ยังเปิด
แบบ Draft และ retained Meta evidence อยู่ใน local detached checkout แยกต่างหาก. Public reviewed
Meta wrapper ผ่าน local gate แต่หยุดแบบ fail-closed ที่ read-only Lark preflight ด้วย
`META_LARK_TABLE_MAPPING_DRIFT` สำหรับ `rawMetaOrganicAccounts`; `emergencyRestoreRequired=false`.
รอบนี้ไม่มี Facebook Provider replay, D1 Queue resend, Meta Business write, Worker Active deployment,
Schedule/Webhook หรือ Production mutation.

Root cause ที่ยืนยันจาก Source คือ Lark launcher โหลด current private table mappings แล้ว แต่ runtime
materializer เดิมเขียนเฉพาะ customer identity และ required all-false flags ลง sibling config ทำให้ retained
table mappings ยังเก่าอยู่. Implementation ใน PR #421 จึง materialize Lark mappings ทั้ง 15 ค่าเฉพาะไฟล์
runtime ชั่วคราว พร้อม fail-closed validation; ไม่แก้ retained safe config และไม่เปลี่ยน D1 path.
Reviewed wrapper ยังคง clone immutable release `29de2303fa311c4a13fac4725699416cfdc04386` และ operator
checkout `5ff8e2cfb1f890ac2a8f2867a904b477c6456d91` แต่ pin exact PR branch Head เพื่อใช้เฉพาะ reviewed
Terminal/Lark launcher จาก Head ที่ผ่าน CI; private retained assets ถูกอ่านจาก explicit absolute asset root.

Live exact continuation ผ่าน Lark inventory และส่ง Lark continuation เดิมหนึ่งครั้งโดยไม่มี Provider replay
หรือ D1 resend. Remote Work จบสำเร็จหลัง bounded verifier timeout เล็กน้อยและ cleared phase rows ตาม
`completeWork()` contract; verifier รุ่นเดิมจึงพลาด durable `completion_json`. Automatic all-false restore
ผ่านแล้ว. Hotfix ปัจจุบันเพิ่ม exact cleared-phase completion proof และ late read-only closeout ที่ต้องเห็น
same-operation attempts อย่างน้อยสองครั้ง, exact operation/connector, final reconciliation และ verified
safe restore โดยไม่ resend.
Late proof รอบแรกผ่าน Business parity แต่ summary ปฏิเสธ target fingerprint เพราะ active-version identity
เปลี่ยนหลัง safe restore. Recovery จึง reuse original `expectedActiveVersion` จาก chain เดิมและเก็บ attempt
ที่ target drift เป็น forensic local evidence; ไม่มี Remote mutation หรือ Queue send ในขั้นนี้.

Late proof ล่าสุดผ่านครบและปิด retained Facebook July เป็น accepted D1/Lark parity โดย Provider replay = 0,
Facebook D1 Queue resend = 0 และ Worker restore all-false. Instagram July preflight พบ Worker Secret ที่ขาด
ก่อน mutation; ผูก `META_INSTAGRAM_ACCESS_TOKEN` จาก private local store โดยไม่เปิดเผยค่า แล้ว rerun ผ่าน
preflight/safe/active gates และส่ง exact D1-only operation หนึ่งครั้ง. Queue delivery มาถึงช้าหลัง verifier
timeout และจบเป็น `META_PERMANENT_API_ERROR` ที่ `instagram.account.insights`; Worker restore/readback
all-false ผ่าน, active lock = 0, operation มี D1 Business/Coverage/Lark write = 0 และ retained Meta DLQ/Alert
อย่างละหนึ่งรายการ.

Minimal Live GET reproduction ยืนยัน request เดิมตอบ Graph code 100 เพราะขาด `period`; request เดิมเมื่อเพิ่ม
`period=day` และ `metric_type=total_value` ตอบ 200 พร้อม metrics ทั้งห้ารายการ. Implementation เพิ่ม query
contract นี้ใน Instagram adapter และเพิ่ม terminal-recovery guard ที่ยอม same-operation recovery เฉพาะ exact
failed pre-D1 boundary, ต้องไม่มี lock/Business/Coverage/Lark และต้องเห็น main Queue attempt เพิ่มจริง.
