# Social Marketing Integration v0.11.0-rc.1 — Verification Report

Date: 2026-07-15  
Candidate: `v0.11.0-rc.1`  
Foundation baseline: `v0.10.2-multi-channel-foundation-approved`  
YouTube connector status: `uat_pending`  
YouTube schedule: `disabled`

## Scope completed

- Guarded Preview/Apply installer for the three YouTube RAW tables.
- Public YouTube Data API and optional Owner Analytics OAuth DEV access preflight.
- RAW Channel, Video and Analytics mappings.
- Canonical writes to `MKT_Content` and cumulative `MKT_Content_Daily`.
- `MKT_Accounts` destination write as the final write stage.
- Manual Queue route for `youtube.channel.organic.sync` with `trigger=manual_uat` only.
- Separate UAT feature flag; normal connector flag remains disabled.
- D1 incremental checkpoint and periodic full reconciliation.
- Non-destructive missing/private/deleted-video handling.
- Existing Sync Log, distributed lock, bounded retry, DLQ and System Alert reuse.
- Successful-sync reconciliation warnings; D1 primary-alert persistence failure remains retryable and prevents Queue acknowledgement.
- Previously observed Analytics missing-key reconciliation with retain/warn semantics and no fabricated Video×Day gaps.
- Central operational identity redaction for Worker logs, D1 and the Lark reliability mirror.
- Canonical approved Workbook and Workbook/source parity coverage without a byte-identical duplicate.

## Intentionally not executed

No live external mutation was performed because authorized DEV access was not available in this session:

- No Lark Base schema was applied.
- No YouTube API request was made.
- No Cloudflare Worker was deployed.
- No Queue message was sent.
- No YouTube schedule was enabled.
- Connector was not promoted from `uat_pending` to `active`.
- No Meta or Production work was started.

## Final clean-archive verification

All commands below were run from a fresh extraction of the final ZIP, not from the working directory.

| Gate | Result |
|---|---:|
| Unit / Integration | 376 / 376 passed |
| Workers runtime | 6 / 6 passed |
| Focused report reliability | 53 / 53 passed |
| Focused YouTube/Reliability/Redaction | 37 / 37 passed |
| Architecture | 109 source files / 230 local dependencies / 0 cycles |
| Repository hygiene | Passed |
| npm audit --offline | 0 vulnerabilities |
| Wrangler dry-run | Passed |
| Bundle size | 443.78 KiB |
| Gzip size | 90.89 KiB |
| Release files | 256 |
| Blocked paths | 0 |
| Missing required paths | 0 |
| Sensitive findings | 0 |
| Duplicate artifacts | 0 |
| Manifest entries | 256 |

## Archive identity

Packaging writes the exact SHA-256 beside the local ZIP at
`outputs/releases/social-marketing-integration-v0.11.0-rc.1.zip.sha256` and the machine-readable result at the matching `.verification.json` path. These generated values stay outside Source so the archive never embeds a stale or self-referential checksum.

## Verification commands

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
npm run release:verify -- /path/to/social-marketing-integration-v0.11.0-rc.1.zip
```

## Required external inputs for the next phase

Store all values outside Source control:

- Authorized `YOUTUBE_CHANNEL_ID`.
- `YOUTUBE_API_KEY` for Public Data API access.
- Optional Owner Analytics OAuth client ID, client secret and refresh token.
- Lark DEV app credentials and app token.
- Returned YouTube RAW Table IDs after guarded Schema Apply.

## Guarded live execution order

1. Add authorized credentials and Channel allowlist to ignored local secrets.
2. Run `npm run preflight:youtube`.
3. Run `npm run setup:youtube-schema` and review the Preview plan.
4. Apply with `CONFIRM_WRITE=YES npm run setup:youtube-schema:apply`.
5. Save returned Table IDs only in ignored local configuration.
6. Deploy to DEV with the UAT flag only; keep normal YouTube and Schedule flags false.
7. Generate the Manual UAT payload with `npm run job:youtube-uat` and enqueue it deliberately.
8. Verify first sync, idempotent rerun, incremental sync, full Video/Analytics reconciliation, identity redaction, quota/rate-limit, D1 alert failure, lock/retry/DLQ and Lark records.
9. Promote to `active` and design a Schedule only after all Live DEV UAT evidence passes.

## Suggested Git handoff

```bash
git add .
git commit -m "fix: harden YouTube reconciliation and reliability"
git push
```
