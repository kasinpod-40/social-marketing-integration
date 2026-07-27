# TikTok Post-Lark Exact-Version Audit Runbook

## Purpose

This runbook replaces status-only Audit probing after the verified incident in which `401 × 3` was followed by an authenticated `404`. It must be used only after this Hotfix is reviewed and merged, and only after separate Remote authorization.

## Safety boundary

The operator remains plan-only by default. This runbook authorizes no Queue send, DLQ action, watermark Admission, D1/Lark Business write, schedule activation, retention/delete or Production action.

## Required ignored Wrangler configs

Both the Safe and Audit-only local configs must contain the same Worker Version Metadata binding:

```json
"version_metadata": {
  "binding": "CF_VERSION_METADATA"
}
```

The Safe config must keep `MKT_TIKTOK_AUDIT_HTTP_ENABLED=false`. The Audit-only config may change exactly that flag to `true`. Every other TikTok Business, D1 write, Report, Queue redrive, retention, schedule and Google Ads execution flag remains `false`.

The rollout validator rejects either config when the binding is absent or renamed.

## Exact-version contract

For every unauthenticated route probe and the one authenticated Audit request, the operator sends:

```text
Cloudflare-Workers-Version-Overrides:
  social-mkt-sync-worker="<exact Wrangler deploy.version_id>"
```

The guarded Worker response must return:

```text
x-mkt-worker-version-id: <CF_VERSION_METADATA.id>
```

The response version must exactly equal the Wrangler deployment UUID. Missing, malformed or mismatched runtime identity fails closed and requires safe-close. HTTP status alone is not accepted as deployment proof.

## Repository and local preparation

Run only from a clean `main` after the Hotfix merge and exact-head Branch Verification:

```bash
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD
```

Expose the existing Integration Workspace target variables and ignored Safe/Audit config paths. Expose `MKT_CONNECTION_OPERATOR_TOKEN` only for the Audit phase from the authorized secret source; never paste it into files, logs, issues or Lark.

## Required sequence

```text
all-flags-false deploy
→ exact-version 404 / 404 / 404
→ Audit-only deploy
→ exact-version 401 / 401 / 401
→ exact-version authenticated GET once / 200
→ all-flags-false deploy
→ exact-version 404 / 404 / 404
```

Each request uses a unique cache-busting query, `Cache-Control: no-cache, no-store`, `Pragma: no-cache`, manual redirect mode and a bounded timeout. The authenticated JSON response is size-bounded before parsing.

## Evidence requirements

Passed deployment evidence must include only:

- exact Wrangler deployment version ID;
- exact attested runtime version ID;
- `versionOverridePinned=true`;
- sanitized target fingerprint;
- deployment/probe timestamps and status sequence;
- reviewed config summary.

It must not store the raw origin, URL, query nonce, request/response headers, response body or operator token.

The authenticated Audit refuses legacy enable evidence that lacks exact-version proof, even when the legacy evidence contains three `401` statuses.

## Stop conditions

Stop and safe-close immediately on:

- missing/invalid Version Metadata binding;
- missing or malformed Wrangler deployment identity;
- version override rejection or runtime-version mismatch;
- any probe sequence other than the expected three statuses;
- stale, incomplete or superseded enable evidence;
- non-`200` authenticated Audit;
- identity mismatch or unsafe config;
- inability to restore exact-version `404 × 3`.

A later Remote retry requires a fresh explicit approval after merge and a newly verified safe baseline.
