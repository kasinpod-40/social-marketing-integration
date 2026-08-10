# Fresh Weekly 7D Executive Decision Preview — 2026-08-10

## Status

```text
WORKSTREAM                         = FRESH_WEEKLY_EXECUTIVE_DECISION_PREVIEW_V1
REPOSITORY_BASE                    = 92ec33894ad7474fecdaf9e4f6a76097e8fcd7d5
VERIFIED_CODE_HEAD                 = fda9686afe31687925d9443fddd07369ead67bf4
BRANCH_VERIFICATION_RUN            = 31352813831
BRANCH_VERIFICATION_JOB            = 93346646257
CODE_CI                            = PASS
LIVE_FRESH_PREVIEW                 = NOT_EXECUTED
QUEUE_ADMISSION                    = 0
LARK_GROUP_SEND                    = 0
WORKER_DEPLOYMENT                  = 0
SCHEDULE_ACTIVATION                = 0
PRODUCTION                         = BLOCKED
```

## Objective

เพิ่ม Safe operator สำหรับพิสูจน์ Executive Decision Quality บน Weekly 7D period ใหม่หลัง historical delivery ที่ปิดเป็น terminal แล้ว โดยใช้ Shared Report collector, Lark Native AI Materialization Automation, Executive Decision Quality Gate และ business-first Notification renderer เดิมทั้งหมด ไม่สร้าง Report/AI/Notification engine ใหม่

Historical Weekly identity ช่วง `2026-07-25..2026-07-31` ยังคง immutable และห้าม rerun, recover, resend, replace หรือ mutate

Fresh-period guard รองรับเฉพาะ exact 7 completed Bangkok days หลัง historical closeout และห้ามรวม current incomplete Bangkok day ตัวอย่าง period ที่ regression พิสูจน์คือ `2026-08-03..2026-08-09`

## Implemented contract

- ใช้ `collectLarkNativeAiWeekly7dControlledUatSource()` เพื่อเลือก newest aligned Shared Report authority
- สร้าง deterministic Preview identity รูปแบบ `weekly-7d-executive-decision-ai:<sha256>` โดยไม่ reuse historical identity
- persisted AI row คง `preview_mode=true`, `notification_eligible=false`, `sent_to_group=false`
- execution trigger เขียนเพียง `failure_code=CONTROLLED_WEEKLY_EXECUTIVE_DECISION_PREVIEW_V1` ให้ existing `AI Materialization → MKT_AI_Report_Runs` Automation
- หลัง trigger ใช้ poll-only observation; ถ้ามี retained trigger แล้ว blind retrigger ถูกบล็อก
- Native AI output ต้องผ่าน Executive Decision Quality Gate เดิมก่อนถือว่าสำเร็จ
- Notification ถูก render ใน memory เพื่อ review เท่านั้น ไม่มี Queue admission หรือ Group send
- Base Notification Automation ต้องคง inactive และ automatic Notification producer ต้องคง absent

## CI defects found and corrected

Branch CI ใช้เป็นหลักฐานจริง ไม่ลด Quality Gate:

1. Result evidence ใช้ชื่อ field ผิดเป็น `paidCandidateNames` ทั้งที่ contract จริงคือ `adCandidateNames`; แก้ runner และเพิ่ม source regression ห้ามชื่อเก่า
2. Positive-path test fixture เดิมไม่มี actual numeric business fact ใน `insight_summary`; Executive Writer contract ต้องมีค่าจริงอย่างน้อยหนึ่งค่าเมื่อมี business evidence จึงแก้ fixture ให้มี observed values
3. Fixture ใช้ `Impressions` / `Clicks` แต่ evidence layer normalize display metric สำหรับผู้บริหารเป็น `การแสดงผล` / `การคลิก`; strength, weakness และ funnel-divergence fixture จึงถูกแก้ให้ใช้ exact normalized evidence labels โดยไม่แก้ validator

## Exact verification

Exact code head `fda9686afe31687925d9443fddd07369ead67bf4` หลัง sync `main@92ec33894ad7474fecdaf9e4f6a76097e8fcd7d5` ผ่าน Branch Verification run `31352813831`, job `93346646257` ครบทุก gate:

- Syntax / architecture / repository hygiene: PASS
- Focused Report source readiness: PASS
- Focused Meta history finalizer: PASS
- Focused Woo recovery: PASS
- Focused Chatwoot Final UAT: PASS
- Focused staged TikTok: PASS
- Unit and Workers runtime: PASS
- Report reliability regression: PASS
- Dependency audit: PASS
- Wrangler dry-run: PASS
- Diff whitespace check: PASS

## Parallel-workstream boundary

`docs/current-task.md` บน current main ถูก Multichannel Runtime & Schedule LIVE Activation workstream ถืออยู่ จึงไม่ถูกแก้จาก PR นี้เพื่อป้องกัน parallel-workstream overwrite เอกสารนี้เป็น Modular Project Brain authority สำหรับ Fresh Weekly Preview workstream

## Remaining gate after merge

Repository implementation ไม่เท่ากับ Live Preview ผ่าน การรัน Fresh Preview จริงต้องเกิดจาก clean exact current `main` บนเครื่องที่มี reviewed Integration Workspace Lark credentials และต้องเป็น explicit controlled execution เท่านั้น

การผ่าน Fresh Preview ยังไม่อนุญาต Automatic Weekly Notification, Base Notification Automation, Source/Report Schedule หรือ Production; Automatic Weekly Notification admission เป็น gate แยกถัดไป
