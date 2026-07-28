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

A new one-time trigger, `youtube_lark_full_sync_uat`, receives a stable Queue operation identity independent of the Cloudflare delivery message ID.

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

- Lark metadata and scoped record-count preflight.
- Current all-false Remote contract verification.
- Fresh operation identity and zero pending migration gate.
- D1 export before activation.
- Exact active deployment and readback.
- One full public-data sync.
- Positive scoped counts in required RAW/Canonical targets.
- Same-operation rerun with unchanged business counts.
- All-false restore and readback.
- Sanitized chained evidence.

## Safety status

Repository implementation only. No Worker deployment, Queue message, D1 business write, Lark write, Provider call, Schedule/Secret mutation or Production action occurred while implementing this operator.
