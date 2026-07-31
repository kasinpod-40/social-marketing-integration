# Project Brain — Chatwoot Final Queue Bootstrap Authentication Ordering Hotfix

## Decision

Shared Queue bootstrap must not require `wrangler whoami` when the exact Cloudflare Account ID is already available from private Environment or Wrangler config.

Authentication and account resolution are separate concerns:

```text
Explicit API token
→ no Wrangler auth command
→ Environment/config Account ID
→ exact Queue REST inventory

Wrangler OAuth session
→ wrangler auth token --json
→ Environment/config Account ID when present
→ whoami --json only when Account ID is absent
→ exact Queue REST inventory
```

## Incident boundary

The Chatwoot attempt stopped during Queue bootstrap at `whoami --json` with `safeRestore=NOT_REQUIRED`. It did not reach D1 backup, Active Worker deployment, Queue submission, Chatwoot Provider requests or D1/Lark Business writes.

## Authority

- The repository-pinned Wrangler version is the only CLI binary used.
- `wrangler auth token --json` is the reviewed structured bearer retrieval command.
- Environment/config Account IDs are validated through the existing exact 32-character contract.
- Queue REST `GET /accounts/{account_id}/queues` remains the authoritative account/token/Queue access gate.
- Exact Queue name must resolve once; pagination, redirect, duplicate/missing identity, non-success response and invalid JSON remain blocked.
- Tokens, Account IDs and Queue IDs are not printed in public evidence.

## Compatibility

The change is shared by Chatwoot and WooCommerce operators using `bootstrapWooCommerceFinalQueueId()`. It does not alter Queue configuration, topology, Runtime flags, Stable keys, retry behavior, DLQ behavior or Business facts.

## Safety

```text
Repository hotfix Remote action  0
Schedule/Webhook                  disabled
Production                        blocked
```
