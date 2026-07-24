# TikTok Organic Recovery — Cloudflare Auth Isolation

Date: 2026-07-24
Environment: Integration Workspace only
Production: blocked
Schedules: disabled
Lark business writes: none

## Live evidence

The guarded resume operator failed before its D1 guard because the process-level `CLOUDFLARE_API_TOKEN` overrode Wrangler OAuth authentication. The token was valid and active for token verification, but it did not have access to the Integration Workspace D1 account. Remote D1 returned Cloudflare error `7403`.

A read-only control command succeeded when only `CLOUDFLARE_API_TOKEN` was removed from the Wrangler subprocess environment:

```text
SELECT 1 AS oauth_d1_ok
success = true
changes = 0
rows_written = 0
```

No Queue message, D1 write, Work mutation, Lark write, schedule change or Production change occurred during the failed resume attempts.

## Correction

- Keep `CLOUDFLARE_API_TOKEN` in the parent operator process for the exact Queue API push.
- Remove only `CLOUDFLARE_API_TOKEN` from the Wrangler D1 subprocess environment.
- Preserve `CLOUDFLARE_ACCOUNT_ID`, Wrangler config and all unrelated environment values.
- Continue to execute the exact Remote D1 fail-closed guard before any Queue API request.
- Add a regression proving the source environment is not mutated and only the token override is removed.

## Resume boundary

The exact resume remains blocked until this correction is merged and full Branch Verification passes. After merge, the existing hotfix deployment does not need to be repeated because this change affects the local operator only, not Worker runtime code. The next authorized action will be one exact guarded resume from clean `main`.
