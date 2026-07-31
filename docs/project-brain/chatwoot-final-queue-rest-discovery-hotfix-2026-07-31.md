# Project Brain — Chatwoot Final Queue REST Discovery Hotfix

## Decision

The Chatwoot Final UAT public command remains unchanged. Queue identity is now resolved through the
existing reviewed Cloudflare REST Queue discovery before the inner Final operator starts.

## Incident boundary

The rerun reached the local Wrangler dry-run and stopped at unsupported:

```text
wrangler queues list --json
```

`safeRestore=NOT_REQUIRED` proves no temporary Active Worker version was deployed. No Queue message,
D1/Lark Business write or Chatwoot Provider request occurred.

## Queue authority

```text
normalized private Wrangler config
→ exact Cloudflare account
→ Wrangler API-token/OAuth bearer identity
→ GET /accounts/{account_id}/queues
→ exact social-mkt-sync-jobs match
→ private MKT_CHATWOOT_FINAL_UAT_QUEUE_ID child binding
```

The implementation reuses the merged WooCommerce Queue REST bootstrap and discovery modules. The
Chatwoot Launcher removes both its own untrusted Queue override and the shared helper's Woo-specific
explicit override before discovery, so exact-name REST resolution cannot be bypassed.

## Privacy and evidence

The Queue ID is operational metadata, not a Secret, but it remains private to the child process. Public
output records only the discovery source and exact-name verification boolean. Bearer tokens, raw Queue
inventory and Queue IDs are never printed or persisted in public evidence.

## Fail-closed behavior

Redirects, request/body timeout, non-success HTTP, invalid JSON, `success=false`, unsupported pagination,
missing Queue identity and duplicate exact names all block execution before lock admission, deployment or
Queue send.

## Final sequence

```text
plan/confirmation guard
→ read-only Lark table discovery
→ private config normalization
→ read-only Queue REST discovery
→ exact Shared lock preflight
→ existing 30-day Initial / replay / 3-day Daily / replay sequence
→ automatic all-flags-false restore
→ exact Shared lock closeout
```

## Final user action after merge

```bash
CONFIRM_CHATWOOT_FINAL_UAT=EXECUTE_CHATWOOT_30D_DAILY_UAT \
node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute
```

No manual Queue ID is part of the operating procedure.

## Safety state during implementation

```text
Remote Provider request       0
Remote D1 query/write         0
Remote Lark request/mutation  0
Queue/DLQ message             0
Worker deployment             0
Schedule/Webhook              disabled
Production                    blocked
```
