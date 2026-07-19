# Git Handoff — YouTube resumable-sync reliability hardening

## Release status

- Branch: `main`
- Base: `c1ea139` (`docs: record YouTube large-account DEV rollout`)
- Target commit: `fix: harden YouTube resumable sync`
- Source gates: passed
- Remote D1 migration 0005 / DEV deployment: not executed
- Production: disabled

## Included

- Durable generation/requested-at fence and checkpoint CAS
- Pre-plan, pre-staging, per-write-chunk and pre-checkpoint stale guards
- Analytics video/channel/date row-scope validation
- Durable deterministic warning outbox and completion replay
- Completed/terminal/superseded staging lifecycle, audit metadata and guarded TTL cleanup
- Permanent/reliability-handled/DLQ terminal marking and new-generation redrive contract
- Additive migration `migrations/0005_resumable_sync_reliability.sql`
- Release archive policy for nested ZIP/local runtime/macOS/dependency/secret exclusions

## Required verification

```bash
npm ci
npm run check
npm test
npm run test:worker
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
```

Expected:

- Unit/Integration: `407/407`
- Workers runtime: `8/8`
- Report reliability: `60/60`
- Focused review regressions: `46/46`
- Architecture: `111 files / 233 dependencies / 0 cycles`
- Audit: `0 vulnerabilities`
- Dry-run: `512.33 KiB / 102.41 KiB gzip`
- Clean archive: `261 files`, blocked/missing/sensitive/duplicate = `0`; fresh-extraction gates passed

## Git commands

```bash
git status --short
git diff --check
git add .gitignore START_HERE.md GIT_HANDOFF.md RELEASE_TEST_REPORT.md README.md CHANGELOG.md PROJECT_BRAIN.md docs apps packages migrations scripts tests
git commit -m "fix: harden YouTube resumable sync"
git push origin main
```

ห้าม Tag หรือสร้าง Release จนกว่า Source commit ถูก review และ Customer/DEV rollout plan ชัดเจน

## หลัง Push

1. Preview/apply migration 0005 ใน DEV ตาม guarded Cloudflare workflow
2. Verify `sync_generation_fences`, `sync_warning_outbox`, lifecycle columns และ indexes
3. Deploy DEV source patch โดยไม่เปลี่ยน Secret/Schedule อื่น
4. ทำ stale-generation, warning replay, terminal/DLQ cleanup และ healthy sync smoke
5. จึงทำ Customer-owned 837-video Full/Incremental/Analytics UAT

## Rollback

ปิด YouTube Schedule/Analytics แล้ว redeploy prior known-good Worker. Migration 0005 เป็น additive และเก็บไว้ได้; prior code ไม่อ่านตาราง/คอลัมน์ใหม่ ห้ามลบ Business checkpoint หรือ Lark rows.
