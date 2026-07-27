# YouTube D1 Migration-list Transient Read Hotfix

## Incident

The authorized YouTube Remote read-only preflight authenticated successfully and completed its guarded
Worker/Queue metadata reads, then Cloudflare returned an internal D1 error while Wrangler executed only:

```text
wrangler d1 migrations list MKT_STATE_DB --remote
```

Observed result:

```text
decision          = 1
Cloudflare code   = 7500 / internal error
remoteMutation    = NONE
queueMessage      = NOT_SENT
d1Write           = NONE
larkRequest       = NOT_RUN
workerDeployment  = NOT_RUN
```

The numeric decision came from the child-process exit code and was not a valid public preflight decision.

## Scope

- Retry only a D1 migration-list failure containing both `internal error` and Cloudflare code `7500`.
- Use three attempts total with bounded linear delays.
- Do not retry authentication, target, config, parser, migration-drift or ordinary command failures.
- Return attempt and retry counts in sanitized success evidence.
- Return a semantic fail-closed decision after retry exhaustion.
- Never expose raw stdout/stderr, Wrangler log paths, credentials or API tokens in the normalized error.
- Never permit a numeric child-process exit code to become the public `decision` value.

## Decision contract

```text
Transient 7500 then success
  → continue read-only preflight
  → migrationReadAttempts=1..3
  → migrationReadTransientRetries=0..2

Transient 7500 exhausted
  → YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_TRANSIENT_EXHAUSTED

Other migration-list command failure
  → YOUTUBE_REMOTE_PREFLIGHT_D1_MIGRATION_READ_FAILED

Numeric/invalid top-level error code
  → BLOCKED_REMOTE_CONTRACT
```

## Safety

This is Repository-only compatibility work. It performs and authorizes no Worker deployment, Queue/DLQ
message or mutation, D1 execute/write/migration apply, YouTube/Lark request, Schedule/route/workers.dev/Secret
change or Production action. The only executable Remote operation after merge remains the existing read-only
preflight.
