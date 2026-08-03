# Project Brain — Operator Terminal Reliability Ledger

## Purpose

ไฟล์นี้เป็น Retained engineering memory สำหรับคำสั่ง Terminal, Wrapper และ Live/Remote Operator
ของ Social MKT Data Hub ทุกช่องทาง บันทึกทั้งสิ่งที่เคยพัง สิ่งที่แก้แล้ว และรูปแบบการเขียนที่
ผ่าน Process จริง ห้ามลบ Incident ที่แก้แล้ว ให้เพิ่มสถานะ Regression และ Source authority แทน

คำว่า `PASS` ใน Ledger นี้หมายถึงมี Test/Terminal/Remote evidence ตาม Scope ไม่ใช่คำกล่าวของ
Agent, process exit เพียงอย่างเดียว หรือ focused test ที่ถูกนำไปแทน full verification

## Mandatory authoring contract

Operator หรือคำสั่งที่มีโอกาสส่งให้ผู้ใช้รันต้องใช้ข้อกำหนดต่อไปนี้:

1. เรียก Process ด้วย executable + argument array และ `shell:false`; ห้ามประกอบ command string,
   heredoc หรือบรรทัด comment `#` ให้ Shell ตีความ
2. Default ต้องเป็น plan-only และไม่มี Remote action
3. ก่อน execution ต้องตรวจ clean exact `main`, exact reviewed Head และ exact operation/evidence identity
4. ตรวจ local prerequisites ทั้งหมดในรอบเดียวและรายงาน blocker ครบ ไม่หยุดทีละค่า
5. Optional local files ต้องมี explicit fallback; missing file ห้ามล้ม `ENOENT` หาก process environment
   มีข้อมูลครบ
6. Private input/evidence ต้องเป็น regular file, mode `0600`, valid JSON และ recursive sanitized
7. Retained evidence ต้องผูก exact Head และ digest; caller Boolean หรือชื่อ directory ใช้แทน evidence ไม่ได้
8. แปลงข้อมูลเฉพาะ boundary ที่เคยพิสูจน์ว่ารูปแบบต่างกัน; invalid value ต้องส่งต่อให้ authority เดิม fail closed
9. Remote request ต้องมี allowlist, bounded counters และ forbidden-action assertions
10. Active window ต้องมี verified Safe restore ใน `finally`; process exit ไม่ใช่ restore evidence
11. Exit code contract: `0` success พร้อม retained evidence, `2` precheck/readiness blocked โดยไม่มี mutation,
    `1` execution failure พร้อม failure/safe-state evidence
12. ต้องมี spawned-process regression ที่รัน entrypoint จริง ไม่ใช่ทดสอบ function ภายในอย่างเดียว
13. Evidence ห้ามพิมพ์ Token, Secret, raw customer payload หรือ infrastructure identity
14. ก่อนส่งคำสั่ง ต้องมี exact command spec, required env names, expected JSON, blocked JSON และ tests ที่ผ่าน
15. หากจำเป็นต้องใช้ Shell strict mode ให้เปิดภายใน subshell เท่านั้น ห้ามเปลี่ยน `set -u/-e`, trap, cwd
    หรือ session state ของ Terminal หลักที่ผู้ใช้กำลังใช้งาน

## Failure and resolution ledger

| Incident / symptom | Proven cause | Passing implementation pattern | Permanent regression / authority |
|---|---|---|---|
| Shell รายงาน `command not found: #` หรือ quote/heredoc แตก | ส่ง multi-line shell fragment ที่มี literal comment/quoting | ใช้ `spawnSync`/`execFile` พร้อม argument array, environment object และ `shell:false` | `scripts/lib/operator-terminal-reliability.js`; `tests/scripts/youtube-report-terminal-acceptance.test.js` |
| หลัง command จบมี `parameter not set` จาก host session saver | `set -u` จากคำสั่งรั่วออกไปเปลี่ยน shell session หลัก | จำกัด strict mode และ temporary variables ใน subshell; wrapper แบบ Node/argv เป็นค่าเริ่มต้น | Meta v3 latest-main drift admission; mandatory rule 15 |
| Runtime expected version ไม่ตรง observed version | Probe ทำหลัง deployment identity เปลี่ยนหรือใช้ static expected ID | อ่าน exact active identity ก่อน probe และ bind evidence กับ exact Head/runtime identity | exact repository/runtime gates ในทุก reviewed terminal |
| `.dev.vars` ถูกปฏิเสธเพราะ permission กว้าง | Secret file ไม่ใช่ private mode | ตรวจ regular file + mode `0600`; ไม่พิมพ์ค่า | Lark Live Pilot pattern; YouTube acceptance `local-secret-source` |
| `.dev.vars` ไม่มีแล้ว child ล้ม `ENOENT` แม้ environment ครบ | Child อ่าน optional file แบบ mandatory | สร้าง empty private file สำหรับ child หรือใช้ optional-file fallback แล้ว merge process env | `resolveChildDevVarsPath()` ใน reviewed YouTube terminal |
| Retained `summary.json` หรือ evidence path ไม่มี | Wrapper อ้าง path จากชื่อ run โดยไม่ได้ stat/read/parse ก่อน | ตรวจทุก path, mode และ JSON ก่อน Remote; aggregate blocker ใน one-command acceptance | `youtube-report-terminal-acceptance.mjs`; `inspectPrivateJsonFile()` |
| Epoch-millisecond requested-at ถูกส่งเป็น digit string แล้ว `Date.parse()` ล้ม | รูปแบบ persisted timestamp ต่างจาก operator string contract | Preload แปลงเฉพาะ digit-string ที่เป็น safe epoch เป็น ISO; ISO/invalid คงเดิมให้ validator ตัดสิน | `meta-d1-only-generated-config-clock-preload.mjs`; spawned preload tests |
| Meta recovery mode สองแบบเปิดพร้อมกัน | Inherited partial flag ไม่ถูกปิดก่อนเปิด exact terminal mode | Rebuild target/runtime config ที่ boundary: partial=false ก่อน terminal=true; actual-route regression | Meta source-complete Preview v3 contract and tests |
| Lark mapping ขาดทีละค่าและต้องรันซ้ำหลายรอบ | Preflight ตรวจ mapping แบบ first-failure | Validate required table set ทั้งชุดจาก reviewed config และรายงาน blocker พร้อมกัน | `wrangler-config-local-contract`; shared config-window builder |
| Evidence มี SHA รูปแบบถูกแต่ payload ถูกเปลี่ยนภายหลัง | ตรวจเฉพาะ regex ของ digest ไม่ได้ recompute | Canonical stable JSON + SHA-256 recomputation + exact reviewed Head match | `youtube-report-remote-lock-release.js` tamper regression |
| Process exit 0 ถูกตีความว่า completion | ไม่มี retained readback/parity/restore evidence | Success ต้องมี contract, exact identity, parity/idempotency และ safe-close marker | Shared operator/finalizer evidence contracts |
| Woo snapshot มีข้อมูลจริงแต่ถูก normalize ซ้ำเป็น semantic-empty | Normalizer รอบสองอ่านเฉพาะ snake_case ทั้งที่ input เป็น camelCase แล้ว | Normalizer ต้อง idempotent ต่อ raw และ normalized shape; retry เฉพาะ raw empty จริง | Woo snapshot idempotent normalization regressions |
| D1 read ล้มเมื่อ bind รวม 101 parameters | D1 limit 100 bound parameters รวม account bind | Chunk value binds ที่ 99 แล้วเพิ่ม account bindเป็น 100 | Woo exact-resume bounded-read regression |
| Wrangler Preview upload คืน Alias + Versioned URL แล้วถูกมองว่า ambiguity | Parser สมมติ output shape เดียว | Classify exact Worker/account pair; deterministic alias เป็น target, versioned URL เป็น cross-check | Woo Preview alias/version pair regressions |
| Preview upload ถูกปฏิเสธ `Queue handler is missing` | Preview entrypoint ไม่มี Queue consumer method ขณะที่ Worker มี Queue binding | เพิ่ม fail-closed queue sentinel ที่ retry ทั้ง batch โดยไม่อ่าน/ack Business messages | Woo diagnostics Queue sentinel regressions |
| Provider HTTP 200 แต่ body ไม่ใช่ JSON | Status code อย่างเดียวไม่พิสูจน์ response contract | ตรวจ Content-Type/redirect/origin/path แบบ sanitized ก่อน parse Business payload | Woo Provider diagnostics contract |
| Durable Queue work เดินต่อแต่ local controller token หมด | Controller ถือ cached OAuth bearer นานกว่างาน durable | Poll exact existing work, refresh bearer just-in-time, ห้ามส่ง admission ใหม่ | Chatwoot exact-session recovery pattern |
| Google Ads child account ยัง selectable ไม่ได้ | Manager account ไม่มี selectable advertiser ในขณะนั้น | Graceful `account_not_selectable`, zero dataset counts, isolated `safeQuery_`, ไม่ crash/fake success | Google Ads Manager Script contract dry-run |

## Passing Codex implementation patterns retained

### Process boundary is part of the test

Meta timestamp correction ใช้ Node `--import` แล้ว spawn process จริงเพื่อพิสูจน์ว่า Environment ที่ child เห็น
ถูก canonicalize และ `Date.now()` monotonic ไม่ได้ทดสอบ helper แบบแยกส่วนเท่านั้น

### Thin reviewed wrapper, existing authority underneath

Wrapper ที่ผ่านไม่สร้าง Business writer, Queue path หรือ Provider implementation ใหม่ แต่ตรวจ exact authority,
เตรียม bounded environment แล้ว delegate ไป existing operator/use-case พร้อม readback

### Private evidence before authority

Lark Controlled Preview ตรวจ input file, mode `0600`, exact four-window plan, exact Head approval และ Remote
allowlist/counters ก่อนเปิด write window จากนั้นเขียนทั้ง success/failure evidence แบบ sanitized

### Boundary-only compatibility correction

การแก้ timestamp, normalized snapshot และ recovery flags ทำตรงจุดแปลง contract เพียงจุดเดียว ไม่ทำ global
coercion ที่อาจซ่อน invalid input หรือเปลี่ยน Business facts

### Strict shell state is isolated

Meta latest-main guard พิสูจน์ว่าคำสั่งอาจจบถูกต้องแต่ `set -u` ยังทำให้ host session saver ล้มภายหลังได้
รูปแบบที่ผ่านคือ strict shell ใน subshell และไม่ให้ operator เปลี่ยน state ของ Terminal หลัก

### Safe state is verified, not assumed

ทุก Active/Preview flow ต้องคืน all-false/URLs-disabled/Schedule-disabled/Production-blocked และอ่านกลับยืนยัน
ใน `finally`; failure ระหว่าง restore ต้องถูกรายงานแยกจาก primary failure

## Current YouTube Report enforcement

```text
acceptance command       node scripts/youtube-report-terminal-acceptance.mjs
mode                     LOCAL_ACCEPTANCE_ONLY
all blockers one run     true
shell                    false
private evidence         0600
lock digest              recomputed
lock Head                equals exact reviewed Head
missing .dev.vars         environment fallback
Remote read/write         0 / 0 during acceptance
Queue/Deploy/Schedule     0 / 0 / false
Production               BLOCKED
```

Reviewed Remote command ห้ามส่งให้ผู้ใช้จน acceptance คืน:

```text
ok       = true
decision = READY_TO_RUN_REVIEWED_REMOTE_READ
exit     = 0
```

ค่า `exit=2` หมายถึงรายงาน blocker ครบแล้วและยังไม่มี Remote mutation ส่วน `exit=1` คือ defect หรือ
execution failure ที่ต้องแก้และเพิ่ม Regression ก่อนส่งคำสั่งรอบใหม่
