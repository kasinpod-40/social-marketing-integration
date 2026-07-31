# Chatwoot Final UAT Changelog

## Unreleased — Guarded 30-Day Initial + Daily Incremental Closeout

### Runtime closeout

- Added one plan-only-by-default Terminal operator for the merged Chatwoot durable runtime.
- Added a public launcher as the only approved execution entrypoint.
- Locked Initial UAT to an exact rolling 30-day window and Daily Incremental to an exact rolling three-day overlap, both anchored to Stable Queue `originalRequestedAt`.
- Added exact stable Initial/Daily operation generation, bounded completion polling, same-operation replay and final cursor verification.

### Integrity

- Added fresh Remote D1 backup before Worker activation.
- Added D1/Lark parity across all 15 Chatwoot destinations.
- Added completion gates for durable multi-unit execution, zero failed Coverage rows, zero operation DLQ records and zero open Chatwoot alerts.
- Added exact Shared Reliability lock-prefix verification before UAT and after Safe closeout.
- Added immutable private evidence and attempt-before-action records bound to Repository Head/session identity.

### Local configuration

- The launcher creates a private temporary config from the existing ignored `wrangler.sync.jsonc`.
- Missing locked 30-day/three-day Runtime values are injected automatically; conflicting values fail closed.
- The retired 48-hour overlap variable is removed from the temporary config without editing the user's ignored local file.
- Relative entrypoint and migration paths are safely rebased, and the temporary config is removed after execution.

### Safety

- The temporary Active window permits exactly four Chatwoot flags and leaves every unrelated execution flag false.
- Schedule, Webhook, workers.dev, routes and Production remain disabled.
- Success and failure paths automatically restore and verify an all-flags-false Worker when the active version remains operator-owned.
- Repository implementation performs no Provider request, Remote D1/Lark action, Queue send, Worker deployment, Secret change, Schedule change or Production action.
