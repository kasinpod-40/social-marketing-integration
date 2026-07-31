# Chatwoot Final UAT Changelog

## Unreleased — Queue REST Discovery Hotfix

### Incident correction

- Fixed the final Launcher stopping after local gates at unsupported `wrangler queues list --json`.
- The repository-pinned Wrangler does not expose JSON output for the top-level Queue list command.
- The failed execution stopped before Worker activation, Queue submission, D1/Lark Business writes or Chatwoot Provider access; Safe restore was not required.

### Shared Queue discovery

- Reused the existing reviewed WooCommerce Cloudflare Queue REST bootstrap instead of adding another Queue parser.
- The Launcher now resolves exactly one `social-mkt-sync-jobs` Queue through bounded GET-only `GET /accounts/{account_id}/queues` discovery.
- User-supplied Chatwoot and WooCommerce final Queue-ID overrides are removed before discovery; exact Queue-name identity remains authoritative.
- The resolved Queue ID is injected only into the child process environment and is never printed or placed in public evidence.
- Missing, duplicated, paginated, redirected, invalid or unsuccessful Queue inventory responses remain fail-closed.

## Lark Table Auto-Mapping Hotfix

### Incident correction

- Fixed the final Launcher stopping before Remote execution when the ignored local config did not contain `LARK_TABLE_RAW_CHATWOOT_ACCOUNTS` and the other 14 Chatwoot Table IDs.
- The failure occurred before Provider, D1, Queue, Worker deployment or Lark record mutation; Safe restore was not required.

### Automatic mapping

- The Launcher now performs one read-only Lark table inventory and reuses the existing Chatwoot metadata discovery contract.
- All 15 Table IDs are resolved from the exact reviewed Blueprint names/aliases.
- Missing, ambiguous or identity-mismatched tables fail closed using logical table keys only; raw Table IDs are never printed or stored in public evidence.
- Resolved IDs are written only to the ignored private generated Wrangler config, which is permission-restricted and deleted after execution.
- Stale local mapping values are repaired only in the temporary config; `.dev.vars` and `wrangler.sync.jsonc` remain unchanged.

## Guarded 30-Day Initial + Daily Incremental Closeout

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
