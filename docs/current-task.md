# Current Task — All Meta End-to-End Completion v1

## Status

```text
TASK_STATUS                          = READ_ONLY_BASELINE_AUDIT_IN_PROGRESS
CURRENT_PROGRAM                      = ALL_META_END_TO_END_COMPLETION_V1
BRANCH                               = integration/all-meta-end-to-end-completion-v1
BASE_MAIN_SHA                        = 0d33be48f9b8ccaf6d8cea9a4c4ee31b1175b650
BASE_MAIN_PR                         = #420_MERGED
CHATWOOT_STATUS                      = CLOSED_ACCEPTED_PARTIAL_UAT
CHATWOOT_META_BLOCKER                = NO
META_RETAINED_OPERATION              = meta-facebook-history-20260701-20260731-1d12a5ec4fef
META_RETAINED_D1_PHASE               = COMPLETE_RETAINED_EVIDENCE
META_RETAINED_LARK_PHASE             = PENDING_RETAINED_EVIDENCE
META_PROVIDER_REPLAY                 = FORBIDDEN_FOR_RETAINED_FACEBOOK_OPERATION
META_D1_QUEUE_RESEND                 = FORBIDDEN_FOR_RETAINED_FACEBOOK_OPERATION
SCHEDULE_WEBHOOK                     = DISABLED_REQUIRED
PRODUCTION                           = BLOCKED
REMOTE_MUTATION_COUNT_THIS_TASK      = 0
META_LATEST_STOP                     = META_LARK_TABLE_MAPPING_DRIFT
NEXT_STEP                            = ROOT_CAUSE_META_LARK_MAPPING_DRIFT
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
