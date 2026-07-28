# YouTube Lark Full-Sync UAT Operator — 2026-07-28

## Context

The authenticated current-version YouTube Remote read-only preflight passed with exact fingerprint equality, stable 100% active Worker version, two Queue consumers and zero pending migrations. The user then manually removed the old YouTube DEV/test Lark records they intended to clear.

The read-only pass did not write Lark. Fresh records require a separate guarded execution path.

## Repository decision

Reuse the existing production path rather than adding a direct script writer:

```text
YouTube Data API
→ existing YouTube adapter and normalizer
→ Shared Reliability / lock / durable work
→ D1-first organic history
→ existing TableSyncEngine
→ Lark RAW and Canonical tables
```

A new one-time trigger, `youtube_lark_full_sync_uat`, receives a stable Queue operation identity independent of the Cloudflare delivery message ID:

```text
workKey     youtube:<operationId>
syncRunId   youtube-lark-uat:<operationId>
generation  originalRequestedAt
```

## Write window

Exactly four flags may be true during the one-time UAT:

```text
MKT_CONNECTOR_YOUTUBE_ENABLED
MKT_YOUTUBE_END_TO_END_ENABLED
MKT_TIME_SERIES_D1_WRITE_ENABLED
MKT_YOUTUBE_LARK_WRITE_ENABLED
```

Owner Analytics, YouTube Schedule and every unrelated execution flag remain false.

## Verification model

- Lark metadata and YouTube-scoped record-count preflight.
- Current all-false Remote contract verification.
- Fresh stable operation identity and zero pending migration gate.
- D1 export before activation.
- Exact active deployment and readback.
- One full public-data sync.
- Positive scoped counts in required RAW/Canonical targets.
- Same-operation rerun with unchanged D1/Lark business counts.
- First run Provider request count greater than zero.
- Same-operation rerun Provider request count equal to zero.
- All-false restore and readback.
- Sanitized chained evidence.

The D1 verifier reads the storage writer's exact durable IDs from `sync_work_runs.completion_json`:

```text
$.endToEnd.storage.historySyncRunId
$.endToEnd.storage.contentCoverageRunId
$.endToEnd.storage.accountCoverageRunId
```

It does not incorrectly count history rows by the outer Reliability sync-run ID.

## Local execution UX

`scripts/youtube-lark-full-sync-uat-session.mjs` resolves the Cloudflare account, Wrangler bearer session and exact Main Queue ID without asking the operator to paste credentials or construct a long heredoc. It creates a private non-secret session record that pins the reviewed repository HEAD, operation ID, generation and Remote target. The bearer token is never printed or persisted.

## Emergency restore

`scripts/youtube-lark-full-sync-uat-emergency-restore.mjs` is independently confirmation-gated. It does not depend on `origin/main` remaining unchanged after activation. It can deploy only the reviewed Safe config whose SHA matches Remote-preflight evidence, and only when the active version still equals the reviewed baseline or UAT activation.

It sends no Queue message, performs no D1/Lark write and blocks repeated attempts. Success requires a sole active restored version with zero true `MKT_*_ENABLED` flags.

## Repository verification

Latest verified Runtime head:

```text
HEAD                 faf8e69c5aea470321a7ccb8ac0ef481786e32ee
BRANCH_VERIFICATION  #846 / 30334705825 / PASS
ARTIFACT             8678696845
DIGEST               sha256:262ddee515b1e4e01a4b3e49d17bf47735b9ba3a9ba958b2f3b1b7b8bc0bd01b
```

All Architecture/Hygiene, TikTok regression, Unit/Workers runtime, Report reliability, Dependency audit and Wrangler dry-run gates passed. No Remote action occurred during implementation.

## Safety status

```text
Worker deployment   NOT_RUN
Queue message       NOT_SENT
D1 business write   NONE
Lark write          NONE
Provider call       NOT_RUN
Schedule mutation   NONE
Secret mutation     NONE
Production          BLOCKED
```

Merge and Live UAT remain separately authorized actions.
