# Chatwoot Remote Read-only Preflight and Migration 0018 Readiness

## Status

```text
IMPLEMENTATION_IN_PROGRESS / DRAFT / REPOSITORY_ONLY
```

## Purpose

สร้าง Integration operator แบบ plan-only-by-default สำหรับตรวจ Remote D1 readiness และเตรียม
Migration `0018_chatwoot_analytics.sql` โดยแยก confirmation/evidence ทุก phase และไม่มี Provider,
Lark, Queue, Worker deploy, Schedule/Webhook หรือ Production path

## Authority

- `AGENTS.md`
- `docs/current-task.md`
- `docs/project-brain/chatwoot-runtime-wiring-merge-closeout-2026-07-27.md`
- `docs/tasks/chatwoot-end-to-end.md`
- `docs/tasks/chatwoot-integration-wiring.md`

## Phases

```text
plan
preflight
backup
migrate
schema-readback
```

Phase order เป็น evidence chain แต่แต่ละ executable phase ยังต้องมี exact confirmation แยกของตนเอง

## Non-negotiable safety

- Run executable phases from clean `main` only
- Reviewed baseline ต้องเป็น ancestor ของ HEAD
- Target ต้องเป็น Integration Workspace และ `social-mkt-state-dev`
- Migration `0017` applied แล้วและห้าม rerun
- Before apply ต้อง pending เฉพาะ `0018`
- All Connector/Business/Report/Schedule/Webhook/Retention/DLQ-redrive gates false
- Backup non-empty + SHA-256 required before migrate
- Schema read-back requires 14 tables, 15 indexes, zero Chatwoot rows and Shared parity
- Evidence must not include Secret values, raw config, Provider payload or PII
- No Queue, Lark, Provider, deploy, Schedule/Webhook or Production action exists in this operator

## Files

```text
scripts/chatwoot-remote-readiness-operator.mjs
scripts/lib/chatwoot-remote-readiness-operator.js
tests/application/chatwoot-remote-readiness-operator.test.js
docs/runbooks/chatwoot-remote-readiness.md
```

## Verification

```text
npm ci
npm run check
node --test tests/application/chatwoot-remote-readiness-operator.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Remote execution

Not authorized by this Repository Implementation task. No executable phase may be run until the
implementation PR passes Integration Review and a later explicit phase approval is recorded.
