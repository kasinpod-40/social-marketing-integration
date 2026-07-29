# WooCommerce Wrangler stderr Evidence Hotfix v1

## Status

```text
REPOSITORY_IMPLEMENTATION = IN_PROGRESS
REMOTE_ACTIONS            = 0
LIVE_RERUN                 = NOT_AUTHORIZED_BY_THIS_CHANGE
```

## Incident

The bounded WooCommerce Preview diagnostics window restored Cloudflare settings successfully, but both isolated Worker Version uploads failed at the Cloudflare `/versions` API with outer code `11001`. The structured Wrangler `command-failed` record exposed only the outer API path and did not include the nested validation detail needed to identify the rejected upload metadata.

Verified safe state after the failed run:

```text
previewUrlsRestored        true
workersDevRestoredDisabled true
productionDeployment       unchanged
workerVersionUploadCount   0
providerRequestCount       0
remoteBusinessMutations    0
```

## Objective

Expose a bounded, strictly redacted subset of Wrangler stderr on command failure so the next separately authorized diagnostics run can reveal the nested Cloudflare validation reason without printing credentials or persisting raw output.

## Implementation

- A Node preload intercepts only failed `npx wrangler versions upload` `spawnSync` results.
- The existing diagnostics operator remains unchanged.
- A separately confirmation-gated launcher injects the preload through inherited `NODE_OPTIONS` and delegates to the already reviewed command-failed evidence launcher.
- Raw stderr remains only in the original child-process result and is never written by this evidence layer.

## Redaction contract

The extractor removes ANSI and redacts:

- bearer tokens and authorization header values;
- WooCommerce `ck_` and `cs_` values;
- URL query strings and full URLs;
- Cloudflare account IDs and UUIDs;
- email addresses and local absolute paths;
- assignment-style secret/token/password/cookie/key values;
- anomalously long opaque strings.

Only diagnostic-looking lines are returned. The result is bounded to 12 lines, 500 characters per line and 4,000 total characters. SHA-256 of raw stderr is retained for correlation; raw stderr is not returned or persisted.

## Remote boundary

This hotfix is Repository-only. It performs no Cloudflare setting mutation, Worker upload/deployment, Provider call, Queue/D1/Lark action, Schedule change, Secret mutation or Production action. A new Live diagnostics run requires separate explicit authorization after merge.
