# All-channel Operator Terminal Reliability Audit v1

## Status

```text
TASK_STATUS                  = REPOSITORY_IMPLEMENTED_FINAL_CI_PENDING
MODE                         = REPOSITORY_ONLY
BASE_MAIN_SHA                = 00a5c7702e282a49f5091684e1b3e4e8f0dfa685
LATEST_VERIFIED_CODE_HEAD    = ce4c2c9bcdf06fa114c4f175b6aaea164b92baeb
BRANCH_VERIFICATION          = #1951 / 30805467119 / SUCCESS
REMOTE_READ_COUNT            = 0
REMOTE_WRITE_COUNT           = 0
PROVIDER_REQUEST_COUNT       = 0
QUEUE_ACTION_COUNT           = 0
WORKER_DEPLOYMENT_COUNT      = 0
SCHEDULE_ENABLED             = false
PRODUCTION                   = BLOCKED
```

`docs/current-task.md` ไม่ถูกแก้ เพราะ Chatwoot Prior Selection Handoff ยังคงเป็น Current Task authority

## Objective

ขยาย Terminal Reliability จาก YouTube ให้เป็น Architecture gate กลางทุกช่องทาง โดย:

1. ค้นหา Entry point จาก `package.json` และ top-level script จริง
2. ครอบคลุม Meta, WooCommerce, Chatwoot, TikTok, Google Ads, YouTube, Lark Native AI และ Shared Report
3. แยกสถานะ Terminal ตาม blocker ที่ต้องแก้จริง
4. ห้าม unsafe Shell process
5. บังคับ spawned-process tests สำหรับ Entry point ใหม่หรือที่แก้
6. บังคับ aggregate local preflight, completion evidence และ Safe restore/replay ตาม risk
7. บันทึก Technical debt แบบ explicit และห้าม stale allowlist
8. เก็บ successful Codex patterns และ audit-development regressions ไว้ถาวร
9. ทำทั้งหมดโดยไม่มี Remote action

## Main alignment

Latest main PR #451 ถูก merge เข้า Branch แบบ two-parent combined tree โดยรักษา 10 ไฟล์ byte-identical:

```text
main                    00a5c7702e282a49f5091684e1b3e4e8f0dfa685
alignment merge         24da23bc6ee608b5db95761ca1ba35dee64108b6
path overlap            0
```

PR #451 เป็น passing authority สำหรับ Lark Native AI exact one-command terminal และเพิ่ม pattern:
fast-forward-only refresh, local lock, no placeholders/hidden evidence, blocker aggregation,
private evidence, deterministic child env, Remote allowlist และ same-input replay

## Implementation

### Policy

```text
scripts/lib/operator-terminal-channel-policy.js
```

ประกาศ status vocabulary, representative channel authorities, strict-pass paths, companion controls และ
explicit technical debt

### Audit engine

```text
scripts/lib/operator-terminal-channel-audit.js
```

ตรวจ:

- npm-exposed และ top-level Terminal/Operator/Preflight/Closeout
- spawned tests
- unsafe `exec`/`execSync` และ `shell:true`
- plan-only default
- all-blocker preflight
- exact repository identity
- private evidence
- completion/exit contract
- Safe restore / same-input replay
- local lock
- Branch-changed entrypoint policy
- shallow GitHub Actions checkout fallback

### Standalone report

```bash
node scripts/audit-operator-terminal-reliability.mjs
```

คืน JSON inventory/status/counters และ exit 1 เมื่อพบ policy violation

### Architecture enforcement

`npm run check` เรียก Audit ผ่าน `scripts/audit-architecture.mjs` และพิมพ์:

- candidate count
- status counts
- representative status ของทุก channel
- changed entrypoint statuses

### Tests

```text
tests/scripts/operator-terminal-channel-audit.test.js
tests/scripts/multichannel-report-live-closure-terminal.test.js
```

ครอบคลุม unsafe shell, status ordering, strong PASS pattern, required channels และ spawned
Multichannel plan-only process

## Explicit technical debt

```text
scripts/multichannel-report-live-closure-terminal.mjs
```

มี spawned process test แล้ว แต่ยังต้องมี public one-command aggregate local acceptance และ exact exit authority
ก่อนส่ง Live command ให้ผู้ใช้ จึงยังไม่ประกาศ `PASS_EXISTING_PATTERN`

Debt นี้มี allowed status แบบแคบและ owner ชัดเจน เมื่อ Entry point ผ่าน Audit รายการ Debt เดิมจะทำให้ CI fail
จนกว่าจะลบออก

## Development verification history

```text
#1948  heuristic defect: closeout/test reference/local zero-counter discovery
#1949  real gap: Multichannel entrypoint lacked spawned test
#1950  test-fixture ordering mismatch, classifier contract correct
#1951  exact code Head passes all gates
```

ไม่มีการลด Gate เพื่อทำให้ผ่าน ทุก failure ถูกแปลงเป็น detector หรือ spawned regression

## Verification

Branch Verification #1951 on exact code Head
`ce4c2c9bcdf06fa114c4f175b6aaea164b92baeb` passed:

```text
locked dependencies              PASS
syntax / architecture / hygiene  PASS
focused Meta                     PASS
focused WooCommerce              PASS
focused Chatwoot                 PASS
focused staged TikTok            PASS
full Unit and Workers runtime    PASS
Report reliability               PASS
dependency audit                 PASS
Wrangler dry-run                 PASS
diagnostics upload               PASS
```

Final documentation/evidence Head ต้องผ่าน Branch Verification อีกครั้งก่อนปิดรอบ

## Acceptance

```text
ALL_REQUIRED_CHANNELS_DISCOVERED      = true
UNSAFE_SHELL_GLOBALLY_FORBIDDEN       = true
NEW_OR_CHANGED_ENTRYPOINT_ENFORCED    = true
SPAWNED_MULTICHANNEL_PLAN_TESTED      = true
TECHNICAL_DEBT_EXPLICIT               = true
STALE_DEBT_FAILS_CI                   = true
SHALLOW_CI_CHANGED_PATH_FALLBACK      = true
PASSING_CODEX_PATTERNS_RETAINED       = true
REMOTE_ACTION_DURING_IMPLEMENTATION   = 0
```
