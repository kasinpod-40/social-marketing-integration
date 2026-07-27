# WooCommerce Wrangler Auth Auto-discovery Hotfix

## Status

```text
TASK_STATUS                 = IMPLEMENTATION_IN_PROGRESS
SCOPE                       = REPOSITORY_HOTFIX_ONLY
REMOTE_ACTIONS              = NONE
PRODUCTION                  = BLOCKED
```

## Incident

The merged WooCommerce one-command rollout stopped before any Remote action because the wrapper required
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` even when Wrangler was already authenticated and the
ignored Wrangler config intentionally omitted `account_id`.

## Objective

Allow the wrapper to discover the selected Cloudflare account from `wrangler whoami --json` and retrieve
the active API/OAuth bearer token from `wrangler auth token --json` when the equivalent environment values
are absent. Explicit non-empty environment values remain authoritative.

## Safety

- No credential value may be logged, persisted in evidence, or committed.
- Multiple accessible accounts must fail closed unless one exact account can be resolved.
- API key/email authentication remains unsupported for direct Queue REST submission.
- No Remote D1, Worker, Queue, Lark, Provider, Schedule, or Production action occurs during implementation.

## Acceptance

- Existing explicit Account ID and API token behavior remains compatible.
- Account ID resolves from one exact Wrangler account membership.
- API/OAuth token resolves from Wrangler auth JSON without being exposed.
- Empty environment variables do not override successful auto-discovery.
- Ambiguous accounts and unsupported auth types fail with specific errors.
- Focused tests and full Repository verification pass.
