# Verification Report — YouTube resumable-sync reliability hardening

Date: 2026-07-19

Candidate: `v0.11.0 source patch`

Base commit: `c1ea139`

Production: disabled

## Findings closed in Source

1. Stale Retry ถูกกันด้วย durable generation fence และ guarded checkpoint CAS
2. Analytics row นอก requested video/channel/date scope ถูก reject ก่อน staging/write/checkpoint
3. Reconciliation warning ถูก persist ใน deterministic outbox และ replay จาก durable completion
4. Permanent/DLQ staging ถูก mark terminal พร้อม reason/audit/expiry และ guarded cleanup

## Verification

| Gate | Result |
|---|---:|
| `npm ci` | Passed |
| `npm run check` | Passed |
| Unit / Integration | 407 / 407 passed |
| Workers runtime | 8 / 8 passed |
| Report reliability | 60 / 60 passed |
| Focused review regressions | 46 / 46 passed |
| Architecture | 111 source files / 233 dependencies / 0 cycles |
| Repository hygiene | Passed |
| `npm audit --offline` | 0 vulnerabilities |
| Wrangler dry-run | Passed |
| Bundle / Gzip | 512.33 KiB / 102.41 KiB |
| Clean archive | 261 files; blocked/missing/sensitive/duplicate = 0 |
| Fresh extraction gates | Passed |

Focused suite includes:

- A(view=100) failure → B(view=200) success → A retry superseded
- Guarded checkpoint fence
- 837 videos: Full pagination, incremental Content 100, Analytics 837, retry resume, no duplicate
- Analytics video/channel/date scope mismatch
- Warning alert fails once, completion replay delivers one deterministic business alert
- Permanent handled/unhandled, retry exhaustion/DLQ, terminal mark, TTL cleanup, active/locked exclusion and redrive
- Release path blocklist for nested ZIP, `.mkt-locks`, SQLite sidecars and macOS metadata

## Migration replay

- Empty schema: `0001_initial.sql` through `0005_resumable_sync_reliability.sql` passed
- Existing schema: `0001`–`0004`, inserted legacy work/cursor rows, then `0005` passed
- Legacy work retained with backfilled generation/requested-at and active lifecycle
- Legacy cursor retained; new generation fields default safely until a guarded YouTube checkpoint writes them

## Release hygiene

Blocked from clean archives:

- `.dev.vars`, local `.env`, `wrangler.sync.jsonc`, Secrets and Live IDs
- `.git`, `.wrangler`, `node_modules`, outputs, coverage and local release directories
- `__MACOSX`, `.DS_Store`, AppleDouble, logs and `.mkt-locks`
- nested `.zip`, SQLite DB/WAL/SHM runtime files

## Not executed

- No YouTube/Lark Live API mutation
- No Remote D1 migration
- No Queue message
- No Cloudflare deployment
- No DEV schedule or Secret change
- No Production change

## Remaining release gates

Apply additive migration 0005 in DEV, deploy guarded patch, run controlled generation/outbox/terminal smoke, then run Customer-owned 837-video Live UAT. DEV 2-video smoke and deterministic fixtures do not replace Customer UAT.

## Rollback

Disable YouTube Schedule/Analytics and redeploy the prior known-good Worker. Migration 0005 is additive and may remain applied; do not delete Business checkpoints or Lark records.
