# YouTube Live Remote Contract Parser Hotfix — 2026-07-27

## Trigger

The first post-merge YouTube Remote read-only preflight authenticated successfully with Wrangler
`4.110.0`, observed one active Worker version at 100% traffic and exposed no Secret values. It then
stopped fail-closed because the live Queue-consumer JSON omitted a Queue-name field expected by the
reviewed fixture parser.

```text
ACTIVE_VERSION       = 55e7bed8-5abd-4ffa-b7eb-2d3fe1e195fb
REMOTE_MUTATION      = NONE
DECISION             = BLOCKED_REMOTE_CONTRACT
BLOCKER              = remoteQueueName is required
```

The same inspection showed the D1 binding carried the immutable database UUID but omitted the
human-readable database name.

## Decision

Treat the incident as a live response compatibility defect, not as proof of a misconfigured Queue or
D1 database. Preserve fail-closed behavior and add a narrow compatibility adapter before the existing
Remote validator.

## Locked compatibility rules

### Queue

- Every live response must be accompanied by the exact Queue name used to scope the Wrangler command.
- Missing in-item name may be restored from that context.
- Any explicit response or consumer name must match the context.
- Main Queue and DLQ contexts remain separate.
- Queue identity is never inferred from list order, retry count or DLQ settings.

### D1

- `MKT_STATE_DB` must occur exactly once.
- Immutable database UUID is required and must equal the reviewed config UUID.
- Human-readable database name may be absent.
- A missing name is restored only after UUID validation.
- Explicit name drift, missing UUID or UUID drift fails closed.

## Architecture

The adapter calls the merged `validateRemoteYouTubeDeploymentContract` after normalization. It does
not duplicate flag, Secret-name, Queue-setting, trigger, traffic or fingerprint logic. A plan-only CLI
allows sanitized captured responses to be validated through this reviewed path without running
Cloudflare commands or persisting raw Secret values.

## Repository scope

```text
scripts/lib/youtube-live-remote-contract-parser.js
scripts/validate-youtube-live-remote-contract.mjs
tests/application/youtube-live-remote-contract-parser.test.js
```

## Safety state

```text
Worker deployment                   NOT RUN
Remote D1 query/write/migration      NONE
Queue/DLQ                            NONE
YouTube/Lark/OAuth/Analytics         NOT RUN
Cron/routes/workers.dev/Secrets      NOT MUTATED
Production                           BLOCKED
```

A new live read-only preflight may occur only after exact-head Branch Verification, review, merge and
separate authorization against then-current `main` and active Worker version.
