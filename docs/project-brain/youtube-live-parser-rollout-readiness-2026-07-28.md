# Project Brain — YouTube Live Parser Rollout Readiness

Date: 2026-07-28

## Durable business truth

YouTube already completed the DEV Lark path. Future work must not describe YouTube Lark writes as
unimplemented or unproven.

```text
Lark schema apply             PASS
Full sync                     PASS
Idempotent rerun              PASS
Incremental sync              PASS
Lock/retry/DLQ/alert          PASS
Identity mismatch fail-closed PASS
```

Established destinations:

```text
RAW_YouTube_Channels
RAW_YouTube_Videos
RAW_YouTube_Analytics_Daily
MKT_Accounts
MKT_Content
MKT_Content_Daily
```

Existing Business records, stable keys and incremental/idempotency semantics are protected facts.

## Repository readiness added

- The executable YouTube rollout verifier now uses the merged live Wrangler compatibility adapter.
- Main Queue and DLQ consumer responses remain raw until bound to their separate exact command contexts.
- D1 Remote identity requires the reviewed immutable UUID; display-name omission is tolerated only
  after exact UUID verification.
- The existing strict validator remains authoritative for flags, bindings, Secret names, Queue settings,
  Cron, routes, workers.dev, traffic and Remote fingerprint.
- Safe-baseline, active-deployment and restore verification share the same adapter path.
- A single plan-only-by-default Terminal operator now performs the complete Remote read-only inspection.

## Final Terminal gate

```bash
CONFIRM_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT=RUN_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT \
  npm run preflight:youtube-remote-read-only:run
```

The operator requires clean current `main`, authenticated Wrangler, one active Worker version at 100%
traffic before and after inspection, matching Queue/D1/trigger/Secret/flag/fingerprint contracts and no
pending migration.

Decision values:

```text
PASS_READ_ONLY_PREFLIGHT
BLOCKED_MAIN_CHANGED
BLOCKED_ACTIVE_VERSION_CHANGED
BLOCKED_REMOTE_CONTRACT
BLOCKED_MIGRATION_0017_REMOTE_TRUTH
BLOCKED_PENDING_MIGRATION_0018
BLOCKED_PENDING_MIGRATIONS
```

`0017_woocommerce_commerce.sql` must not be rerun. `0018_chatwoot_analytics.sql` is not owned by the
YouTube workstream and must not be applied from this gate.

## Safety state

No Worker deployment, Queue/DLQ mutation, D1 execute/write/migration apply, YouTube/Lark request,
Schedule/route/workers.dev/Secret mutation or Production action occurred during Repository work.
