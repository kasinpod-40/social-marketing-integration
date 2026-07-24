# TikTok Organic Durable Recovery — Backup Gate Evidence

Date: 2026-07-24
Environment: Integration Workspace only
Database: `social-mkt-state-dev`
Production: blocked
Schedules: disabled

## Read-only preflight

The guarded operator passed exact preflight with the original incident identity and durable facts:

- `organic_content_state = 1309`
- `organic_content_observations = 1000`
- `data_coverage_entities = 1000`
- Work lifecycle `active`
- write checkpoint `nextSequence = 2`, `unitsCompleted = 2`
- durable checkpoint counters `1000`
- exact DLQ retained as `open / QUEUE_RETRY_EXHAUSTED`
- lock expired
- Coverage status `partial`, expected `2021`, summary observed counters `0 / 0`, failed `0`, completion timestamp null

The partial Coverage summary counters are intentionally zero until `completeCoverage()` writes final reconciliation. Durable progress is independently proven by the Work checkpoint and `data_coverage_entities = 1000`.

## Remote backup

The operator reported a successful non-empty Remote D1 export and recorded SHA-256 evidence:

- Backup file: `social-mkt-state-dev-before-0010-20260724T031853642Z.sql`
- SHA-256: `6e6b7d8bb57e63da78b3888f39b95db4f50f4d5e0eb891699d598beb98b4e58b`
- Local evidence file: `outputs/tiktok-durable-recovery/exact-2026-07-23/backup.json`

The evidence directory is ignored and remains on the authenticated operator machine. Migration 0010 must revalidate this checksum and the exact pending migration set before applying any Remote schema change.

## Remote mutation status after backup

- Migration 0010: not yet applied
- Worker deployment: not run
- Queue message: not sent
- Live recovery: not executed
- Lark business writes: none
- Production changes: none
