# Facebook Daily Scoped Staging Reader Recovery v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
OPERATION_ID                        = facebook-dashboard-repair-20260809-v1
WORK_KEY                            = facebook:facebook-dashboard-repair-20260809-v1
SYNC_RUN_ID                         = meta:facebook:facebook:facebook-dashboard-repair-20260809-v1
SOURCE_SCOPE                        = facebook_daily_dashboard_lookback_v1
SOURCE_SCOPE_START_SEQUENCE         = 82
SOURCE_EXPECTED_UNITS               = 173
SOURCE_PHYSICAL_ROWS                = 116
SOURCE_SCOPED_EXPECTED_ROWS         = 91
SOURCE_SCOPED_PHYSICAL_ROWS         = 91
SOURCE_SCOPED_MISSING_SEQUENCES     = 0
PROVIDER_REPLAY                     = PROHIBITED
BUSINESS_WRITES_BEFORE_RECOVERY     = 0
PRODUCTION                          = BLOCKED
```

## Confirmed root cause

PR #609 correctly introduced a durable Facebook daily scope marker and excludes pre-marker Content, Account Insight and Content Insight units when assembling the active source snapshot. The terminal failure remained because `readAllStagedUnits()` still required the physical staged row count to equal the logical historical `state.unitCount` across sequence `0..172`.

The read-only physical audit proves the active scoped range is complete: all 91 required rows for sequence `82..172` exist with no scoped sequence gap. The 57 missing sequences are exclusively legacy pre-scope gaps. The staged-unit table has unique identities on `(work_key, phase, unit_key)` and `(work_key, phase, sequence)`; bounded same-operation staging reused prior unit identities, so existing pre-scope rows could be upserted to the new scoped sequence while preserving one physical row per unit identity. This makes historical prefix sequence continuity invalid evidence for this migrated operation even though the active scoped staging is complete.

## Fix contract

- Keep the existing staged-unit reader and pagination path; do not add a second staging engine.
- For normal Meta operations, preserve exact physical completeness from sequence `0` through `expectedUnits - 1`.
- Only when the durable Facebook daily scope marker is present, require contiguous physical coverage from `contentInventoryStartSequence` through `expectedUnits - 1`.
- Retain any physically available pre-marker units so `facebook.account.latest` remains available to snapshot assembly.
- Do not synthesize missing units, delete staged evidence, rewrite Provider payloads or weaken scoped completeness.
- A missing sequence inside the active scoped range must still fail closed with `META_END_TO_END_SOURCE_STAGING_INCOMPLETE`.

## Recovery sequencing after merge

1. Deploy the reviewed merged Worker version with all unrelated gates unchanged.
2. Recover only the exact terminal operation identity without Provider replay.
3. The source state is already `stage=complete`; the recovered invocation must therefore read retained staging and proceed directly to D1/Lark generation.
4. Verify D1 completion, Lark completion, operation completion and non-zero target-day observations.
5. Refresh Facebook `1D/3D/7D/30D` current slots once, perform exact Lark readback and validate the existing Dashboard configuration.
6. Keep Production, Notification changes, DLQ bulk redrive and unrelated source replay blocked.

## Required regression

- migrated Facebook daily staging passes when only legacy pre-scope sequences are missing and the active scoped range is contiguous;
- migrated Facebook daily staging fails when any scoped sequence is missing;
- existing strict completeness behavior remains unchanged for operations without the Facebook daily scope marker;
- focused tests, `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit`, `npm run deploy:dry-run`, and `git diff --check` pass before merge.
