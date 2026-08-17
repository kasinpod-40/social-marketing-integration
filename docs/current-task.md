# Current Task — Repository Final Closeout & Weekly Scheduled Evidence v1

## Status

```text
TASK_STATUS                         = REPOSITORY_CLOSEOUT_COMPLETE_WEEKLY_TIME_GATE_REMAINS
CURRENT_PROGRAM                     = WAIT_AUTOMATIC_WEEKLY_V6_SCHEDULED_EVIDENCE_20260824
REPOSITORY_CLOSEOUT_MERGE            = c1203cd3d96be7ae9616adad08d8c6b64d8b3cfe
BRANCH_VERIFICATION_RUN              = 31990567121
BRANCH_VERIFICATION_JOB              = 95273236886
BRANCH_VERIFICATION                  = PASS
INTEGRATION_WORKSPACE               = ACTIVE_VERIFIED
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
NEXT_AUTOMATIC_SCHEDULED_EVIDENCE   = 2026-08-24T08:30:00+07:00
TIKTOK_ADS                          = DEFERRED_NOT_CURRENT_BLOCKER
OPEN_PULL_REQUESTS                  = PR_220_ONLY
DLQ_REDRIVE                         = BLOCKED_OFF
```

## Objective

Repository debt ที่ทำได้โดยไม่แตะ Live runtime ปิดแล้ว. งานปัจจุบันเหลือเพียงอ่านหลักฐาน Automatic Weekly v6 ตามเวลาจริงหลัง `2026-08-24 08:30 Asia/Bangkok`. Production/customer-owned provisioning และ TikTok Ads เป็น workstream แยกและไม่ใช่ blocker ของ Integration repository closeout นี้.

## Completed repository closeout

- PR #658 merge เข้า `main` ที่ `c1203cd3d96be7ae9616adad08d8c6b64d8b3cfe`.
- Port Lark Number formatter precision fix จาก stale PR #249 แบบ minimal บน current main.
- Official grouped formatter `1,000` / `1,000.00` และ spreadsheet alias ใช้ Shared normalizer; unsupported precision ไม่ถูกเดา.
- Shared Dimensions Backfill operator identity เป็น `lark-dashboard-shared-dimensions-backfill-v1.3`; ไม่มี Apply.
- Authority files รุ่นเก่าถูก archive byte-for-byte ก่อนแทน active files ด้วย current authority.
- Branch Verification run `31990567121`, job `95273236886` ผ่านทุก step: install, architecture/hygiene, focused suites, staged TikTok, Unit/Workers runtime, Report Reliability, dependency audit, Wrangler dry-run, diff check และ diagnostics upload.
- Obsolete Draft PR #11, #17, #66, #249 และ #595 ถูกปิดพร้อมบันทึกเหตุผลว่า superseded.
- PR #220 TikTok Ads ยังคงเปิดตามคำสั่งผู้ใช้และถูกจัดเป็น deferred.

## Locked runtime evidence

Weekly v6 controlled recovery ผ่าน Quality Gate และ exactly-once delivery แล้ว: AI/Admission อย่างละ 1, D1 delivery `sent/mirrored` claim 1, Lark Notification Log `sent` 1 และ exact new alert/DLQ/active lock = 0. หลักฐานนี้พิสูจน์ repair path แต่ไม่แทน scheduled automatic proof.

Automatic Weekly รอบจริงก่อนหน้า fail-closed และ retained identity ต้องคงเป็น forensic evidence ห้าม reset/replay/redrive. หลักฐาน schedule รอบถัดไปต้องอ่านแบบ read-only หลัง `2026-08-24 08:30 Asia/Bangkok` เท่านั้น.

## Out of scope / deferred

- TikTok Ads implementation, OAuth, deploy หรือ customer onboarding
- Production provisioning/UAT
- Worker deployment
- Queue send/replay/DLQ redrive
- Remote D1 mutation/migration
- Lark mutation หรือ Backfill Apply
- Schedule/Secret/Binding change
- Manual run ที่ใช้แทน Automatic Weekly evidence

## Acceptance criteria

Repository closeout criteria ผ่านแล้ว. Final Integration time gate จะถือว่าปิดเมื่อ Automatic Weekly v6 รอบถัดไปมี scheduled exactly-once evidence ที่ถูกต้องโดยไม่มีการใช้ manual/control run แทน.

Historical current-task ก่อน Repository closeout ถูกเก็บ byte-for-byte ที่
`docs/archive/current-task-before-repository-final-closeout-2026-08-17.md`.

Detailed closeout record: `docs/project-brain/repository-final-closeout-2026-08-17.md`.
