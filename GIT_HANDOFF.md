# Git Handoff — Close YouTube resumable reliability gaps

## Release status

- Baseline GitHub commit: `2ef561861e293cb6e4817922131602d7c2d081c9`
- Recommended branch: `agent/fix-youtube-outbox-redrive-migration`
- Recommended commit: `fix: close YouTube reliability review gaps`
- Local Source gates: passed
- Remote D1 migration 0005 / DEV deployment: not executed
- Production: disabled

## Included

- Cross-generation deterministic warning outbox drain and completed-work replay
- Superseded run → `skipped/SYNC_WORK_SUPERSEDED`
- Dry-run warning contract without Business alerts
- Operational/replay Secret matcher covers token/secret/password/auth plus private/signing keys and credential variants
- Secret-filtered `replay_payload_json` remains separated from operational identity-redacted payload
- Permanent handled/unhandled and DLQ durable Dead-letter persistence
- Disabled-by-default `system.dead-letter.redrive` with read-only validation before durable Generation/reference reservation and D1 pre-update recursion guard
- Migration 0005 quiesce guard, Business-checkpoint fence bootstrap and redrive columns
- `docs/youtube-resumable-migration-runbook.md`
- Required `.gitignore` and `.dev.vars.example` restored from the GitHub baseline; no Live values

## Verified gates

- Unit/Integration: `426/426`
- Workers runtime: `8/8`
- Report reliability: `64/64`
- Focused corrective regressions: `74/74`
- Architecture: `113 source files / 238 dependencies / 0 cycles`
- Repository hygiene: passed
- Offline audit: `0 vulnerabilities`
- Wrangler dry-run: `534.26 KiB / 106.71 KiB gzip`
- SQLite migration replay: empty 0001→0005 passed; existing checkpoint bootstrap passed; active-work guard failed closed
- Source handoff: 264 files; no generated manifest/macOS metadata. Build official Release archive only after Commit from a clean tree

## Git commands

```bash
find . -name '.DS_Store' -delete
find . -type f -name '._*' -delete
rm -f RELEASE_MANIFEST.txt
git status --short
git diff --check
git add .gitignore .dev.vars.example START_HERE.md GIT_HANDOFF.md RELEASE_TEST_REPORT.md README.md CHANGELOG.md PROJECT_BRAIN.md docs apps packages migrations scripts tests package.json wrangler.sync.example.jsonc
git commit -m "fix: close YouTube reliability review gaps"
git push -u origin agent/fix-youtube-outbox-redrive-migration
```

เปิด Draft PR เข้า `main` และห้าม Merge/Deploy จน Review Diff กับ Migration 0005 ผ่าน

## Guarded DEV rollout

ทำตาม `docs/youtube-resumable-migration-runbook.md` เท่านั้น:

1. ปิด YouTube Schedule/Analytics และยืนยัน Redrive=false
2. Drain Queue; work/active lock ต้องเป็น 0
3. Apply migration 0005 และ verify bootstrap/indexes
4. Deploy Source โดย Schedule ยังปิด
5. Smoke generation/outbox/permanent/DLQ/redrive/healthy sync
6. เปิด Schedule/Analytics คืน; Redrive ต้องปิด
7. จึงทำ Customer-owned 837-video UAT

## Rollback

ปิด YouTube Schedule/Analytics และ redeploy prior known-good Worker. Migration 0005 เป็น additive และเก็บไว้ได้; ห้ามลบ Business checkpoint หรือ Lark rows
