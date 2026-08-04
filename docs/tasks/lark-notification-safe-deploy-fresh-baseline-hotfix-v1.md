# Lark Notification Safe Deploy Fresh Baseline Hotfix v1

Date: 2026-08-04

## Incident

The all-false Safe Worker deploy stopped before the actual `wrangler deploy` command with:

```text
LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED
invalid: active_work, coverage_runs, coverage_entities
```

The operator compared current live D1 counts against the historical Migration preflight captured before later Meta and Report closeout progress. The notification schema itself remained valid and empty; the stale cross-phase Business-fact comparison created a false blocker.

## Correction

- retain historical preflight/backup/migrate/schema-readback evidence as proof that Migration `0019` was applied safely at that time;
- take a fresh read-only Remote snapshot immediately before Safe Worker deploy;
- require one notification table, three notification indexes, zero delivery rows and zero non-expired locks;
- deploy once with all notification flags false;
- verify the exact Worker version serves 100 percent of traffic;
- take a second read-only Remote snapshot immediately after deployment;
- require notification schema and active-lock invariants again;
- record unrelated Work/coverage/report count movement as concurrent external progress rather than attributing it to Worker deployment.

## Boundaries

The hotfix does not add Queue send, Lark read/write, notification send, Automation activation, Schedule activation, Secret mutation or Production cutover.

The failed attempt stopped before `wrangler deploy`, so it created no Worker version and performed no Remote mutation.
