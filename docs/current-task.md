# Current Task — Repository Final Closeout & Weekly Scheduled Evidence v1

## Status

```text
TASK_STATUS                         = REPOSITORY_CLOSEOUT_WEEKLY_TIME_GATE_REMAINS
CURRENT_PROGRAM                     = REPOSITORY_FINAL_CLOSEOUT_20260817
EXACT_BASE                          = 5fcc0777ea19abf7aee2e42f566f62e44149232c
INTEGRATION_WORKSPACE               = ACTIVE_VERIFIED
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
NEXT_AUTOMATIC_SCHEDULED_EVIDENCE   = 2026-08-24T08:30:00+07:00
TIKTOK_ADS                          = DEFERRED_NOT_CURRENT_BLOCKER
DLQ_REDRIVE                         = BLOCKED_OFF
```

## Objective

ปิดหนี้ Repository ที่ทำได้ทันทีโดยไม่แตะ Live runtime และเหลือเพียงหลักฐาน Automatic Weekly ตามเวลาจริงกับ Production/customer-owned work:

1. Port Lark Number formatter precision fix จาก Draft PR #249 ขึ้น latest `main` แบบ minimal.
2. รักษา official Lark formatter enum `1,000` / `1,000.00` และ spreadsheet alias ผ่าน Shared normalizer โดยไม่เดา unsupported precision.
3. Bump guarded Shared Dimensions Backfill operator identity เป็น v1.3 โดยไม่รัน Apply.
4. Archive authority files รุ่นเก่าแบบ byte-for-byte แล้วทำ `docs/current-task.md`, `docs/project-brain/00-current-state.md` และ `docs/project-brain/10-next-actions.md` ให้ตรง current state.
5. ปิด Draft PR ที่ถูก current `main` supersede แล้ว; เก็บ TikTok Ads PR #220 ไว้ตามคำสั่งผู้ใช้.

## In scope

- `packages/connectors/src/lark/lark-field-serializer.js`
- focused formatter regression tests
- Shared Dimensions Backfill operator identity + focused test
- Repository authority/handoff documentation cleanup
- GitHub PR hygiene สำหรับ obsolete Draft PRs

## Out of scope

- TikTok Ads implementation, OAuth, deploy หรือ customer onboarding
- Worker deployment
- Queue send / replay / DLQ redrive
- Remote D1 migration/write
- Lark mutation หรือ Backfill Apply
- Schedule/Secret/Binding change
- Production provisioning/UAT
- Manual run ที่ใช้แทน Automatic Weekly evidence

## Locked runtime evidence

Weekly v6 controlled recovery ผ่าน Quality Gate และ exactly-once delivery แล้ว: AI/Admission อย่างละ 1, D1 delivery `sent/mirrored` claim 1, Lark Notification Log `sent` 1 และ exact new alert/DLQ/active lock = 0. หลักฐานนี้พิสูจน์ repair path แต่ไม่แทน scheduled automatic proof.

Automatic Weekly รอบจริงก่อนหน้า fail-closed และ retained identity ต้องคงเป็น forensic evidence ห้าม reset/replay/redrive. หลักฐาน schedule รอบถัดไปต้องอ่านแบบ read-only หลัง `2026-08-24 08:30 Asia/Bangkok` เท่านั้น.

## Acceptance criteria

- formatter official grouped enums และ aliases มี deterministic precision regression
- unsupported formatter precision คง exact behavior และไม่ถูกเดา
- Shared Dimensions Backfill operator reports v1.3; ไม่มี Apply ในงานนี้
- `npm run check` ผ่าน
- `npm test` ผ่าน
- `npm run test:report-reliability` ผ่าน
- `npm audit` ผ่านตาม repository gate
- `npm run deploy:dry-run` ผ่านโดยไม่มี deployment
- obsolete Draft PRs ถูกปิดโดยไม่แตะ PR #220
- `main` ไม่มี current-actionable repository debt จาก PR #249 หรือ stale authority files
- Production และ TikTok Ads ไม่ถูกนับเป็น blocker ของ Integration repository closeout นี้

## Required tests

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Focused regressions ต้องครอบคลุมอย่างน้อย:

- `1,000` -> precision 0
- `1,000.00` -> precision 2
- `#,##0.00` -> normalize แล้ว precision 2
- unsupported `0.00000` และ `1,000.000` -> no guessed precision
- Backfill operator version = `lark-dashboard-shared-dimensions-backfill-v1.3`

## Implementation result

```text
PORT_SOURCE                         = DRAFT_PR_249_MINIMAL_CURRENT_MAIN_PORT
REMOTE_RUNTIME_MUTATIONS            = ZERO_REQUIRED
OBSOLETE_PR_CLOSEOUT                = AFTER_REVIEWED_MERGE
TIKTOK_ADS_PR_220                   = KEEP_OPEN_DEFERRED
AUTOMATIC_WEEKLY_EVIDENCE           = TIME_GATED_20260824_0830
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
```

Historical current-task detail before this closeout is preserved byte-for-byte at
`docs/archive/current-task-before-repository-final-closeout-2026-08-17.md`.

Detailed repository closeout record: `docs/project-brain/repository-final-closeout-2026-08-17.md`.
