# Git Handoff — Social Marketing Integration v0.11.0-rc.1

## Release status

- Official foundation: `v0.10.2-multi-channel-foundation-approved`
- Working candidate: `v0.11.0-rc.1`
- YouTube Organic: `uat_pending`
- Manual DEV UAT source: ready
- YouTube schedule: disabled
- Production: not started

## Primary source artifact

`social-marketing-integration-v0.11.0-rc.1.zip`

SHA-256 ใช้ค่าจาก `social-marketing-integration-v0.11.0-rc.1.zip.sha256` ที่สร้างพร้อม ZIP; ไม่ฝังค่าเก่าไว้ใน Source

Verify on macOS:

```bash
shasum -a 256 -c social-marketing-integration-v0.11.0-rc.1.zip.sha256
```

Verify on Linux:

```bash
sha256sum -c social-marketing-integration-v0.11.0-rc.1.zip.sha256
```

## Required checks before commit

Run from the repository root after replacing/updating the source files:

```bash
npm ci
npm run check
npm test
npm run test:worker
npm run test:report-reliability
npm audit
npx wrangler deploy --dry-run --config wrangler.sync.example.jsonc
```

Expected release evidence:

- Unit / Integration: `376/376`
- Workers runtime: `6/6`
- Report reliability: `53/53`
- YouTube/Reliability/Redaction focused: `37/37`
- Architecture: `109 files / 230 dependencies / 0 cycles`
- npm audit: `0 vulnerabilities`
- Wrangler dry-run: passed
- Bundle / Gzip: `443.78 KiB / 90.89 KiB`

## Git commands

```bash
git status
git add .
git commit -m "fix: harden YouTube reconciliation and reliability"
git tag v0.11.0-rc.1
git push origin main
git push origin v0.11.0-rc.1
```

Commit message:

```text
fix: harden YouTube reconciliation and reliability
```

Release tag:

```text
v0.11.0-rc.1
```

## Files that must stay outside Git

Do not commit or package these local/runtime files:

```text
.dev.vars
wrangler.sync.jsonc
YouTube API keys
OAuth client secrets
OAuth refresh/access tokens
Lark app secrets and tenant tokens
DEV runtime logs
.DS_Store
._*
__MACOSX/
node_modules/
coverage/
```

Use only placeholders in:

```text
.dev.vars.example
wrangler.sync.example.jsonc
```

## What this release includes

- Approved YouTube Organic Blueprint v0.10.2
- Guarded YouTube schema preview/apply commands
- Public Data API and Owner Analytics preflight
- RAW Channel, Video and Analytics writes
- Mapping to `MKT_Accounts`, `MKT_Content` and cumulative `MKT_Content_Daily`
- Manual Queue route with `trigger=manual_uat`
- Incremental checkpoint and reconciliation
- Existing Sync Log, Lock, Retry, DLQ and System Alert integration
- No YouTube scheduler producer
- No Production activation

## Next operational gate

After the commit/tag handoff, the next work is Live DEV execution only:

1. Add authorized DEV secrets outside Source control.
2. Run YouTube DEV access preflight.
3. Preview and guarded-apply the three RAW tables to Lark DEV.
4. Save the resulting DEV Table IDs in local `wrangler.sync.jsonc`.
5. Run Manual Queue UAT.
6. Verify first sync, idempotent rerun, incremental update, identity mismatch, reconciliation, quota/rate limit, lock/retry/DLQ and Lark records.
7. Keep YouTube schedule disabled until Live DEV UAT passes.
