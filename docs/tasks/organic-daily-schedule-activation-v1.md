# Organic Daily Schedule Activation v1

## Objective

ทำให้ Organic source observations เดินต่อทุกวันเพื่อให้ Shared Report 1D/3D/7D/30D สะสม baseline จริง แทนการรอข้อมูลที่หยุดนิ่ง โดย reuse Scheduler, Queue, Reliability, D1/Lark writers และ Meta end-to-end runtime เดิมทั้งหมด.

## Incident evidence

Read-only Remote D1 audit วันที่ 2026-08-09 พบ:

- Instagram `period_end=2026-07-31` และทุก window ยัง `baseline_incomplete`.
- TikTok `period_end=2026-07-28` และทุก window ยัง `baseline_incomplete`.
- YouTube `period_end=2026-07-28` และทุก window ยัง `baseline_incomplete`.
- Facebook ไม่มี Content observations แต่ Report contract รองรับ `facebook.account.daily` แบบ `ACCOUNT_OR_CONTENT`; ห้าม fabricate `facebook:period_views` จาก Content history ที่ไม่มีจริง.
- Repository Scheduler มี TikTok/YouTube producer อยู่แล้วแต่ Schedule activation ถูกปิดไว้หลัง Live closeout.
- Repository Scheduler ไม่มี Facebook/Instagram producer และทั้ง Connector/Job catalog ยังล็อกสอง Organic jobs ไว้ที่ `uat_pending/manualOnly` แม้ Meta Organic end-to-end Live UAT/closeout ถูกยืนยันแล้วใน workstream ก่อนหน้า.

## Scope

Repository-only activation contract:

1. Promote เฉพาะ Facebook Organic และ Instagram Organic Connector/Job เป็น Development-runnable หลัง reviewed Live UAT.
2. Meta Ads ยังคง `uat_pending` และ `manualOnly`.
3. เพิ่ม Daily Meta Organic producers เข้า Primary Cron เดิม โดยไม่สร้าง Cron framework ใหม่.
4. Facebook default `07:30` Asia/Bangkok; Instagram default `07:35`; override ได้เฉพาะเวลา 5-minute boundary.
5. Scheduled job ล็อก `periodStart=periodEnd=previous completed Bangkok day`.
6. ใช้ Shared `createStableQueueOperationBody`; operation identity แยก platform/day.
7. Continuation ต้องรักษา originating trigger; ห้ามเปลี่ยน Scheduled work กลับเป็น `manual_uat`.
8. Schedule flags ทุกตัว default false; Implementation นี้ไม่ Deploy, ไม่ Queue send, ไม่เขียน Remote D1/Lark และไม่เปิด Schedule.

## Flags

```text
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_META_SOURCE_READ_ENABLED=false
MKT_META_D1_WRITE_ENABLED=false
MKT_META_LARK_WRITE_ENABLED=false
MKT_SCHEDULE_FACEBOOK_ENABLED=false
MKT_SCHEDULE_INSTAGRAM_ENABLED=false
MKT_FACEBOOK_SYNC_TIME=07:30
MKT_INSTAGRAM_SYNC_TIME=07:35
```

## Rollout gate after merge

ห้ามเปิด Schedule ทันทีหลัง Merge. ลำดับ Live ที่อนุญาตคือ:

```text
read-only remote preflight
→ one manual Facebook Organic daily operation
→ verify D1/Coverage/Lark + idempotent continuation/replay
→ one manual Instagram Organic daily operation
→ verify D1/Coverage/Lark + idempotent continuation/replay
→ controlled TikTok/YouTube incremental freshness verification
→ enable only proven Organic schedules
→ observe next completed-day writes
→ rerun read-only 1D/3D/7D/30D baseline readiness audit
→ refresh Report windows only when source baseline is actually ready
```

Any failure restores/keeps schedules false. Production remains blocked.

## Acceptance

- Facebook/Instagram scheduled jobs are emitted only at their configured local time.
- Both jobs carry stable operation/work/generation identity and exact previous completed date.
- Meta Organic Scheduled mode cannot elevate/reduce into dry-run or D1-only payload.
- Meta Ads remains manual-only.
- TikTok, YouTube, WooCommerce and Report scheduling regressions remain unchanged.
- Default environment examples keep both new schedules false.
- Full repository gates pass before Merge.
