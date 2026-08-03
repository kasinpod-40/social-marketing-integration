# Project Brain — All-channel Operator Terminal Audit

## Purpose

เอกสารนี้เป็น Current engineering authority สำหรับการตรวจ Terminal, Operator, Preflight และ Closeout
ที่อาจถูกส่งให้ผู้ใช้รันเองบนเครื่องจริง ครอบคลุม Meta, WooCommerce, Chatwoot, TikTok, Google Ads,
YouTube, Lark Native AI และ Shared Report

เป้าหมายไม่ใช่ประกาศว่า Script เก่าทุกตัวสมบูรณ์ แต่ทำให้สถานะและ Technical debt มองเห็นได้,
ห้าม Regression กลับไปใช้รูปแบบที่เคยพัง และบังคับให้ Entry point ใหม่หรือที่ถูกแก้ต้องมีหลักฐาน
มากกว่าการผ่าน Unit test ภายใน

## Audit authority

```text
scripts/audit-operator-terminal-reliability.mjs
scripts/lib/operator-terminal-channel-audit.js
scripts/lib/operator-terminal-channel-policy.js
```

Architecture gate เรียก Audit นี้ผ่าน:

```text
scripts/audit-architecture.mjs
npm run check
```

Audit เป็น Repository-only และไม่มี Wrangler, D1, Lark, Provider, Queue, Worker deployment,
Schedule หรือ Production action

## Discovery

Audit ไม่อาศัยรายชื่อที่เขียนมือเพียงอย่างเดียว แต่รวม:

1. Entry point ที่ถูกเปิดผ่าน `package.json` scripts
2. Top-level `scripts/*.mjs` ที่ชื่อมี `terminal`, `operator`, `preflight` หรือ `closeout`
3. Spawned-process test references จาก `tests/**/*.js|mjs`
4. Representative authority อย่างน้อยหนึ่งตัวของทุก Business channel

Representative channels:

```text
Meta            scripts/meta-history-2026-reviewed-release-terminal.mjs
WooCommerce     scripts/woocommerce-report-runtime-closeout.mjs
Chatwoot        scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs
TikTok          scripts/tiktok-durable-recovery-operator.mjs
Google Ads      scripts/google-ads-live-operator.mjs
YouTube         scripts/youtube-report-remote-readiness-reviewed-terminal.mjs
Lark Native AI  scripts/lark-native-ai-controlled-preview-exact-terminal.mjs
```

## Status vocabulary

```text
PASS_EXISTING_PATTERN
NEEDS_SPAWNED_TEST
NEEDS_ALL_BLOCKER_PREFLIGHT
NEEDS_EXIT_CODE_CONTRACT
NEEDS_SAFE_RESTORE_EVIDENCE
UNSAFE_SHELL_COMMAND
```

Status ถูกจัดลำดับเพื่อบอก blocker แรกที่ต้องแก้:

1. Unsafe Shell ห้ามผ่านทุกกรณี
2. ต้องมี spawned-process test ของ Entry point จริง
3. ต้องรายงาน local blockers ครบในรอบเดียว
4. ต้องมี completion/exit evidence contract
5. Remote mutation ต้องมี Safe restore หรือ same-input replay evidence
6. จึงถือเป็น `PASS_EXISTING_PATTERN`

## Enforcement

- `exec`/`execSync` หรือ `shell:true` เป็น Global violation
- Strict PASS authorities ห้ามถอยสถานะ
- Entry point ใหม่หรือที่แก้ใน Branch ต้อง `PASS_EXISTING_PATTERN`
- กรณียังแก้ไม่ครบต้องมี explicit technical-debt record พร้อม allowed status, reason และ owner
- เมื่อ Debt path ผ่านแล้ว รายการ Debt เดิมกลายเป็น stale violation และต้องลบ
- Required channel หายจาก Inventory เป็น Architecture violation
- GitHub Actions shallow merge checkout มี fallback discovery เพื่อไม่ให้ changed-file gate ถูกข้ามเงียบ ๆ

Current acknowledged debt:

```text
scripts/multichannel-report-live-closure-terminal.mjs
owner = multichannel-report-live-closure
```

Entry point นี้มี spawned plan test แล้ว แต่ public aggregate local-acceptance/exit authority ยังต้องทำก่อนส่ง
Live command ให้ผู้ใช้ จึงถูกบันทึกเป็น Technical debt แทนการประกาศ PASS ปลอม

## Passing Codex authority — Lark Native AI Exact Terminal

PR #451 / `main@00a5c7702e282a49f5091684e1b3e4e8f0dfa685` เป็นรูปแบบที่ผ่านจริงและถูกใช้เป็น
Success authority เพิ่มเติม:

- one-command Node entrypoint ไม่มี heredoc/manual SHA/hidden prerequisite
- self-refresh `origin/main` แบบ fast-forward only
- exact clean main identity
- local exclusive lock mode `0600`
- blocker aggregation ก่อน Remote action
- `.dev.vars` เป็น optional source และ process environment เป็น authority ได้
- private input/evidence
- deterministic child environment
- bounded Remote allowlist/counters
- same-input replay เป็นส่วนของ success contract
- ambiguity ไม่ลบ local lock อัตโนมัติ
- output มี sanitized operator command โดยไม่เปิดเผย Secret

บทเรียนเพิ่มเติมที่ล็อก:

1. คำสั่งต้องดูแล repository freshness เองก่อนเรียก child
2. Placeholder และ hidden evidence file ห้ามเป็น prerequisite ที่ผู้ใช้ต้องประกอบเอง
3. Local lock ต้องป้องกันการรันซ้อน และต้องเก็บไว้เมื่อสถานะหลัง failure ยังไม่แน่นอน
4. Success ต้องรวม replay/no-op proof ไม่ใช่แค่ initial write สำเร็จ
5. Child environment ต้องถูกสร้างแบบ deterministic ไม่รับ inherited flags แบบไม่จำกัด

## Audit-development regressions retained

ระหว่างสร้าง Audit มีสาม heuristic defect และหนึ่ง real gap ที่ถูกบันทึกเป็น Regression:

- ชื่อ `closeout` ไม่ถูกค้นหาในรอบแรก — เพิ่มใน discovery pattern
- Test reference แบบ `../../scripts/...` ไม่ถูก index — เปลี่ยนเป็น basename reference scanner
- Zero-only counters ของ Local Acceptance ถูกตีความว่า Remote mutation — เพิ่ม local-acceptance classification
- Multichannel closure มี unit tests แต่ไม่มี spawned entrypoint test — เพิ่ม spawned plan testจริง

การแก้ทำโดยปรับ detector/test ตาม Source contract ไม่ลดมาตรฐานหรือเพิ่ม blanket allowlist

## Zero-Remote boundary

```text
REMOTE_READ_COUNT=0
REMOTE_WRITE_COUNT=0
PROVIDER_REQUEST_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```
