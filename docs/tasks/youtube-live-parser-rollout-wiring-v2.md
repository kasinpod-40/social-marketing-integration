# YouTube Live Parser Rollout Wiring v2

## Historical baseline

YouTube has already completed the DEV Lark path. This task does not build or re-prove first-time Lark writes.

```text
LARK_SCHEMA_APPLY             = PASS
FULL_SYNC                     = PASS
IDEMPOTENT_RERUN              = PASS
INCREMENTAL_SYNC              = PASS
LOCK_RETRY_DLQ_ALERT          = PASS
IDENTITY_FAIL_CLOSED          = PASS
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

## Objective

Complete every Repository-side prerequisite so the only remaining operational step is one guarded
Terminal execution of the YouTube Remote read-only preflight.

## Implemented scope

- The executable YouTube rollout verifier now uses `validateLiveRemoteYouTubeDeploymentContract`.
- Main Queue and DLQ retain separate exact Wrangler command contexts.
- Remote D1 identity is bound to the reviewed immutable UUID.
- Missing D1 display name is accepted only after UUID verification.
- Safe-baseline, active-deployment and restore verification share the same compatibility path.
- A one-command plan-only-by-default Terminal operator performs:
  - exact `main` and clean-tree guard;
  - Wrangler authentication;
  - active Worker version read before and after inspection;
  - raw version, Queue, Cron, routes and workers.dev metadata reads;
  - D1 pending migration read;
  - strict local/Remote fingerprint validation;
  - deterministic PASS/BLOCKED decision and private summary output.

## Fail-closed decisions

```text
PASS_READ_ONLY_PREFLIGHT
BLOCKED_MAIN_CHANGED
BLOCKED_ACTIVE_VERSION_CHANGED
BLOCKED_REMOTE_CONTRACT
BLOCKED_MIGRATION_0017_REMOTE_TRUTH
BLOCKED_PENDING_MIGRATION_0018
BLOCKED_PENDING_MIGRATIONS
```

Migration `0017_woocommerce_commerce.sql` must not be rerun. Seeing it pending is Remote-truth drift.
Migration `0018_chatwoot_analytics.sql` pending blocks YouTube rollout without applying it.

## Safety

The implementation and Terminal operator contain no Worker deployment, Queue send, D1 execute/write,
migration apply, YouTube request, Lark request, Schedule mutation, Secret mutation or Production action.

## Required verification

- focused live parser and rollout-wiring tests;
- read-only operator stability and migration-decision tests;
- full Node and Workers-runtime suites;
- architecture/hygiene and staged TikTok regression;
- report reliability, dependency audit and Wrangler dry-run;
- exact-final-head review with zero unresolved comments.
