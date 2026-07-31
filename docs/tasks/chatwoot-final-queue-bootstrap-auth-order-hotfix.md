# Chatwoot Final Queue Bootstrap Authentication Ordering Hotfix

## Incident

The guarded Chatwoot Final UAT reached the shared Queue bootstrap and stopped before Remote mutation:

```text
WOOCOMMERCE_FINAL_QUEUE_BOOTSTRAP_WRANGLER_FAILED
command = whoami --json
safeRestore = NOT_REQUIRED
production = BLOCKED
```

The bootstrap invoked `wrangler whoami --json` unconditionally before checking whether the exact Cloudflare Account ID and API token were already available from the reviewed private Environment or Wrangler config.

An account-scoped API token may be valid for the exact Queue REST inventory while lacking unrelated user-membership access required by `whoami`. The previous ordering therefore introduced an unnecessary authentication dependency before the authoritative Queue request.

## Correction

- Resolve an exact Account ID from `CLOUDFLARE_ACCOUNT_ID` first.
- Otherwise resolve the exact `account_id` from the private generated Wrangler config.
- With an explicit API token, perform no Wrangler authentication command.
- Without an explicit token, retrieve the current bearer through the official pinned `wrangler auth token --json` command.
- Invoke `whoami --json` only when neither Environment nor config contains an Account ID.
- When account discovery is required, bind `whoami` to the bearer returned by `auth token`.
- Keep exact-name Queue REST discovery as the sole Queue identity and permission gate.
- Preserve bounded GET-only behavior, pagination rejection, secret redaction and fail-closed response checks.

## Safety boundary

```text
Remote Provider request during repository work  0
Remote D1/Lark action                           0
Queue/DLQ message                               0
Worker deployment                               0
Schedule/Webhook                                disabled
Production                                      blocked
```

The failed UAT attempt stopped before D1 backup, temporary Active Worker deployment, Queue send, Chatwoot Provider access or D1/Lark Business writes. Safe restore was not required.

## Required verification

```text
npm ci
npm run check
focused Queue bootstrap authentication-order tests
focused Chatwoot Final/Lark/Queue/runtime/recovery tests
focused Woo completed-state tests
focused TikTok staged regression
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
exact-head Branch Verification
```

`docs/current-task.md` remains owned by the concurrent Meta workstream and is intentionally unchanged.
