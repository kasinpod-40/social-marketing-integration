# Architecture Audit — v0.2.0 Core Sync Engine

Date: 2026-07-10
Scope reviewed: application use cases, Lark transport/repository, sync worker, local scripts, tests, Project Brain, and current Lark Base contract.

## Critical finding fixed

The previous Lark upsert path mixed storage I/O with synchronization policy and updated every existing record. Earlier versions also searched once per incoming row. This created avoidable API volume and directly caused Lark `1254290 TooManyRequest` during a 20-row TikTok sync.

## Architecture changes

- Added storage-neutral `TableSyncEngine` under `packages/sync-engine`.
- Reduced `LarkRecordRepository` to a thin list/create/update adapter.
- Kept authentication, pagination, batching, retry, and request pacing inside `LarkBitableClient`.
- Removed the unused per-row `searchRecordsByField` API path.
- Added changed-field detection so identical reruns are skipped instead of rewritten.
- Added duplicate-key detection in destination tables and fail-fast behavior.
- Added duplicate-input accounting with deterministic last-row-wins semantics.
- Made queue jobs execute sequentially against one Lark runtime to prevent cross-job bursts.
- Migrated TikTok sync and metric seeding to the universal sync engine.

## Performance model

For each destination table, the sync path is now:

1. One paginated table read.
2. O(n) in-memory key indexing.
3. O(m) incoming-row comparison.
4. Zero or more batch-create calls.
5. Zero or more batch-update calls.

Unchanged rows produce no write request payload. There is no per-row search request.

## Reliability controls

- Shared in-flight and cached tenant token.
- Serialized request pacing with a default minimum interval.
- Bounded exponential backoff with jitter.
- Retry support for Lark `1254290`, HTTP 429, HTTP 5xx, and transient network failures.
- Sequential writes and sequential queue-job processing.
- Fail-fast duplicate destination identity checks.

## Code health review

- No remaining `searchRecordsByField` or connector-specific `upsertByKey` path.
- No empty JavaScript source files.
- No duplicate TikTok identity-key builder.
- Small validation helpers remain local to module boundaries; they were not centralized because doing so would increase coupling without meaningful reuse value.
- No feature work for Facebook, Instagram, YouTube, Chatwoot, or WooCommerce was started during this refactor.

## Validation

- Automated tests: 36/36 passed.
- JavaScript syntax check: passed.
- Live TikTok validation must be rerun on the developer machine before live sync.
- Live write sync and second-run idempotency verification remain pending.
