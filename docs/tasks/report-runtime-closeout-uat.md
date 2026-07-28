# Report Runtime Closeout UAT

Status: `repository_implementation_complete_validated`

Branch: `codex/report-runtime-closeout-uat`

Draft PR: `#214`

Aligned main: `f726d86e4391892c3bb959ee7c0006eaa8ac3968`

Validated implementation head before this documentation commit: `a249c836f5750362d0d9223fb8d86a68ff1efbdd`

## Objective

ปิด Workstream Report ให้จบด้วย Live Integration Workspace proof หนึ่งเส้นทาง โดยพิสูจน์ว่า
Historical D1 facts ของ Source ที่ Active จริงสามารถ Materialize ผ่าน Shared Reliability/Queue ไปยัง
D1 `report_materializations` และ Lark Report tables ได้แบบ Stable-key idempotent ก่อนคืน Worker เป็น
all-false Safe state

```text
TikTok Organic D1 historical facts
→ report.materialization.generate
→ Shared Reliability lock/run
→ report_materializations
→ MKT_Report_Snapshots / Metric Values / Top Content
→ exact same-job replay
→ zero row-count/checksum drift
→ all-false Worker restore
```

## One final command

หลัง PR นี้ Merge เข้า `main` ให้รันบนเครื่องที่มี `.dev.vars`, Wrangler authentication และ
Integration Workspace Lark credentials:

```bash
CONFIRM_REPORT_RUNTIME_CLOSEOUT=EXECUTE_REPORT_RUNTIME_CLOSEOUT \
node scripts/report-runtime-closeout.mjs --execute
```

Wrapper จะรัน Report Schema/Settings finalizer แบบ idempotent บน HEAD ล่าสุดก่อน แล้วจึงรัน
Closeout UAT ดังนั้นผู้ใช้ไม่ต้องเตรียม evidence ด้วยคำสั่งแยก

## Reviewed active window

มีเพียงสอง flag ที่เป็น `true` ชั่วคราว:

```text
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
```

ทุก `MKT_*_ENABLED` อื่นถูกตั้ง `false` ใน generated config รวมถึง:

```text
all Connector flags
MKT_REPORT_AI_SUMMARY_ENABLED
MKT_SCHEDULE_DAILY_REPORT_ENABLED
MKT_SCHEDULE_WEEKLY_REPORT_ENABLED
```

ไม่มี Provider/Connector call เพราะ Materialization อ่านจาก D1 เท่านั้น

## Guarded flow

1. Require clean current `main == origin/main` และ exact closeout confirmation
2. Rerun Report finalizer; require Schema zero drift, 51 active Canonical settings และ all-false runtime
3. Validate Lark Report table/key-field inventory
4. Require latest completed TikTok `organic_content_cumulative` Coverage with non-empty watermark
5. Require positive TikTok D1 state/observation counts, no active Report lock และ no open Report DLQ
6. Select the first fresh rolling preset identity from `3/7/9/15/30/90D`
7. Require no existing D1/Lark rows for that exact Report ID
8. Require zero pending migrations; build Safe/Active Worker bundles with Wrangler dry-run
9. Verify current Remote Worker has all execution flags false
10. Export Remote D1 backup
11. Deploy exact Report-only active window and verify 100% active Version/bindings
12. Send one `report.materialization.generate` Queue message
13. Require D1 success, one materialization, non-unavailable data status, zero lock/DLQ and Lark rows
14. Send the exact same job again
15. Require same Report ID, same payload checksum, one D1 row and unchanged Lark row counts
16. Restore generated all-false Worker config in `finally` and verify 100% active Safe Version
17. Write sanitized evidence to:

```text
outputs/report-runtime-closeout/report-runtime-closeout-summary.json
```

## Acceptance

Closeout passes only when summary contains:

```text
ok                         = true
decision                   = REPORT_WORKSTREAM_CLOSED
D1 materialization count   = 1
first sync                 = success
replay successful runs     >= 2
same Report ID             = true
same payload checksum      = true
Lark row counts unchanged  = true
restored all false         = true
AI                         = false
Daily/Weekly Schedule      = false
Production                 = false
```

## Scope boundary

- Active-source Live proof uses TikTok Organic because Report catalog marks TikTok `active`
- YouTube remains an additional Active adapter but is not required for the minimal Report-core closeout
- Facebook, Instagram, Meta Ads and Google Ads remain `uat_pending` and cannot be promoted by Report
- TikTok Ads remains `planned`
- Their calculations/contracts remain covered by repository tests; Live source promotion belongs to each Connector workstream
- AI summary and schedules are optional consumers, not requirements for closing Report core

## Safety

The operator does not:

- enable any Connector
- call TikTok, Google, Meta, YouTube or other Provider API
- apply a D1 migration
- delete or rewrite Historical Business facts
- delete Lark records
- enable AI
- enable Daily/Weekly Report schedules
- enable Production
- print or persist credential values

Deployment and Queue attempt evidence is written before each mutation. If an error occurs after activation,
the operator restores all flags false in `finally`; a restore failure is surfaced separately and never reported
as a successful closeout.

## Repository validation

Initial combined-tree Branch Verification run `30381340231` passed on the Draft PR merge tree.

After merging current `main` into the feature branch through integration PR `#215`, exact aligned-head
Branch Verification run `30381619424` passed on `a249c836f5750362d0d9223fb8d86a68ff1efbdd`:

- install locked dependencies — PASS
- syntax, architecture and Repository hygiene — PASS
- focused staged TikTok regression — PASS
- Unit and Workers-runtime tests — PASS
- Report reliability regression — PASS
- dependency audit — PASS
- Wrangler dry-run — PASS; no deployment
- diagnostics upload — PASS

Focused closeout tests cover exact confirmation, two-flag activation/all-false restore, deterministic fresh
preset selection, finalizer evidence, D1 readiness, completed materialization, replay checksum/identity and
secret-shaped evidence redaction.

No Worker deployment, Remote D1 mutation, Lark write, Queue message, Schedule activation, AI activation,
Secret change, Production action or Live UAT was performed during implementation or CI.
