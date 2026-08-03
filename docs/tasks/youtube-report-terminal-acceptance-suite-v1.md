# YouTube Report Terminal Acceptance Suite v1

## Status

```text
TASK_STATUS                  = REPOSITORY_IMPLEMENTED_CI_PENDING
MODE                         = REPOSITORY_ONLY
REMOTE_READ_COUNT            = 0
REMOTE_WRITE_COUNT           = 0
PROVIDER_REQUEST_COUNT       = 0
QUEUE_ACTION_COUNT           = 0
WORKER_DEPLOYMENT_COUNT      = 0
SCHEDULE_ENABLED             = false
PRODUCTION                   = BLOCKED
```

`docs/current-task.md` ไม่ถูกแก้ เพราะ Chatwoot Prior Selection Handoff ยังเป็น Current Task authority

## Problem

Terminal commands หลาย Workstream เคยผ่าน Unit/CI แต่หยุดบนเครื่องผู้ใช้จาก local/process boundary ที่ไม่ได้
ทดสอบจริง เช่น missing evidence path, `.dev.vars` permission/absence, shell comment/quoting, epoch-string timestamp,
recovery flags ซ้อน, exact runtime identity drift และ Lark mapping ขาดทีละค่า

การแก้ทีละ failure ทำให้ผู้ใช้ต้องรันคำสั่งซ้ำหลายรอบ และความรู้จาก Codex run ที่ผ่านไม่ถูกเก็บเป็นมาตรฐานร่วม

## Objective

1. รวบรวม failure และ successful Codex patterns เป็น permanent Project Brain ledger
2. สร้าง shared terminal reliability contract
3. สร้าง one-command local acceptance ที่ตรวจ blocker ทั้งหมดในรอบเดียว
4. ทดสอบ entrypoint ผ่าน spawned process จริงโดยไม่ใช้ shell string
5. บังคับ exact private/digest-bound retained lock evidence
6. กำหนด exit code 0/2/1 ตามความหมายจริง
7. ป้องกัน `.dev.vars` ENOENT เมื่อ process environment มี credentials ครบ
8. ทำทั้งหมดโดยไม่มี Remote action

## Passing patterns reused

- Meta clock preload: canonicalize digit-string timestamp ที่ child-process boundary และทดสอบด้วย spawned Node
- Lark Controlled Preview Live Pilot: private input mode `0600`, exact Head, bounded Remote allowlist/counters,
  success/failure evidence และ optional `.dev.vars`
- Chatwoot/Woo reviewed controllers: exact retained identity, no replacement admission, safe restore/readback
- Google Ads Manager Script: graceful no-data/not-selectable result แทน crash หรือ fake success

## Implementation

### Shared reliability module

`operator-terminal-reliability.js` ให้ authority กลางสำหรับ:

- shell-free executable/argv command spec;
- JSON child-process parsing;
- private regular JSON files;
- writable evidence path;
- acceptance gate aggregation;
- recursive sanitized evidence;
- exit classification `0/2/1`.

### Local acceptance runner

```bash
node scripts/youtube-report-terminal-acceptance.mjs
```

ตรวจในรอบเดียว:

- Node >= 22;
- plan-only terminal spawned process;
- exact reviewed Head input;
- clean exact `main`;
- reviewed `wrangler.sync.jsonc` topology และ required mappings;
- private `.dev.vars` หรือ complete process environment credentials;
- exact private/digest-bound Meta lock-release evidence;
- writable evidence path;
- exact confirmation value.

Acceptance ไม่เรียก Wrangler, D1, Lark, Provider, Queue หรือ Worker API

### Reviewed terminal hardening

- exit `2` สำหรับ confirmation/repository/lock precheck failure;
- exit `1` สำหรับ execution failure หลังเริ่ม internal collector;
- every failure reports `remoteReadExecuted`;
- internal child uses `shell:false`;
- missing `.dev.vars` creates temporary empty mode-0600 file so process environment remains authoritative;
- lock evidence Head must equal exact repository Head.

### Retained lock evidence

- input is a regular JSON file mode `0600`;
- recursive sanitized equality;
- canonical SHA-256 recomputation;
- exact audit/repository/reviewed Head equality;
- all-false/Preview-disabled/Schedule-disabled/Production-blocked;
- active Work/Lock/uncertain Queue all zero.

## Failure-to-regression ledger

Permanent record:

```text
docs/project-brain/operator-terminal-reliability-ledger.md
```

แต่ละรายการระบุ symptom, proven cause, passing implementation pattern และ regression/authority path

## Changed files

```text
scripts/lib/operator-terminal-reliability.js
scripts/lib/youtube-report-remote-lock-release.js
scripts/youtube-report-remote-readiness-reviewed-terminal.mjs
scripts/youtube-report-terminal-acceptance.mjs
tests/scripts/youtube-report-remote-lock-release.test.js
tests/scripts/youtube-report-terminal-acceptance.test.js
docs/project-brain/operator-terminal-reliability-ledger.md
docs/tasks/youtube-report-terminal-acceptance-suite-v1.md
```

## Required verification

```bash
node --check scripts/lib/operator-terminal-reliability.js
node --check scripts/lib/youtube-report-remote-lock-release.js
node --check scripts/youtube-report-remote-readiness-reviewed-terminal.mjs
node --check scripts/youtube-report-terminal-acceptance.mjs
node --test tests/scripts/youtube-report-remote-lock-release.test.js
node --test tests/scripts/youtube-report-terminal-acceptance.test.js
node --test tests/scripts/youtube-report-remote-readiness-reviewed-terminal.test.js
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Branch Verification ต้องผ่าน focused Meta, WooCommerce, Chatwoot, TikTok, full Unit/Workers runtime,
Report reliability, audit และ Wrangler dry-run บน exact Head

## Acceptance

```text
LOCAL_ACCEPTANCE_REPORTS_ALL_BLOCKERS = true
SPAWNED_ENTRYPOINT_TESTED             = true
SHELL_STRING_USED                     = false
PRIVATE_EVIDENCE_REQUIRED             = true
DIGEST_RECOMPUTED                     = true
EXACT_HEAD_REQUIRED                   = true
MISSING_DEV_VARS_ENOENT               = prevented
REMOTE_ACTION_DURING_IMPLEMENTATION   = 0
```
