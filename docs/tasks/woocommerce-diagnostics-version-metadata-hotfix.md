# WooCommerce Diagnostics Version Metadata Hotfix

## Status

```text
TASK_STATUS                         = READY_FOR_CI
PROGRAM                             = WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS
INCIDENT_CODE                       = WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RUNTIME_VERSION_MISMATCH
EXPECTED_ACTIVE_VERSION             = 0147ce69-2acd-463e-bb80-086d181badb8
OBSERVED_RESPONSE_VERSION           = null
PROVIDER_REQUEST                    = 0
BUSINESS_MUTATION                   = 0
QUEUE_MESSAGE                       = 0
LARK_REQUEST                        = 0
SCHEDULE_MUTATION                   = 0
PRODUCTION                          = BLOCKED
```

## Incident facts

The authorized ephemeral-auth diagnostic command deployed the diagnostic-only Worker version, then failed on the first unauthenticated route proof because the response did not contain `x-mkt-worker-version-id`.

The automatic Safe restore also reached the same runtime-version response check and reported failure. The operator control flow proves that before either route probe is attempted it has already:

1. deployed the generated config;
2. confirmed the exact deployed version is the sole 100% active version;
3. inspected that exact version;
4. confirmed the exact expected set of true `MKT_*_ENABLED` flags.

Therefore the Safe restore reached an active all-flags-false version. The unresolved proof is the response-level exact-version header and route closure, not the Remote execution flag state.

## Root cause

The diagnostics route reads its version from:

```text
CF_VERSION_METADATA.id
```

and adds it to:

```text
x-mkt-worker-version-id
```

The generated Safe and Active Wrangler configs were derived from the local source config but did not independently require or materialize:

```json
{
  "version_metadata": {
    "binding": "CF_VERSION_METADATA"
  }
}
```

The tests incorrectly supplied that binding in the fixture, so the missing-local-binding case was not covered.

Cloudflare also documents that a newly deployed version can require a short propagation interval before a version override is applied globally. The previous operator rejected the first unattested response immediately.

## Implementation

The config builder now:

- materializes `version_metadata.binding=CF_VERSION_METADATA` when the source config omits it;
- preserves the exact supported binding;
- rejects a conflicting binding before dry-run or deployment;
- includes the binding in both diagnostic-only and all-flags-false Safe configs;
- exposes the materialized binding in local preflight metadata.

The ephemeral launcher now installs a bounded exact-version GET retry wrapper before loading the reviewed operator:

```text
attempt 1
→ 500 ms
→ attempt 2
→ 1,000 ms
→ attempt 3
→ 2,000 ms
→ attempt 4
→ 3,000 ms
→ final attempt
```

A retry occurs only when all of these are true:

- method is GET;
- exactly one valid `Cloudflare-Workers-Version-Overrides` version is present;
- response does not attest the expected `x-mkt-worker-version-id`.

Non-versioned requests, POST requests and ambiguous multi-version headers are not retried.

## Acceptance criteria

- Missing source `version_metadata` is materialized exactly in Safe and Active bundles.
- Exact existing binding remains valid.
- Conflicting binding fails closed before deployment.
- Safe bundle retains zero true execution flags and no ephemeral digest.
- Active bundle retains exactly the diagnostics flag and one ephemeral digest.
- Exact-version GET retries stop immediately on the expected runtime header.
- Retry count and delays are bounded.
- Final unmatched response is returned to the existing fail-closed validator.
- Requests outside the exact-version GET scope are never retried.
- No Queue, D1, Lark, Schedule, Secret mutation or Provider call is performed during implementation.

## Live boundary

This hotfix does not authorize another Worker deployment or Provider request. After exact-head CI and Squash Merge, rerunning the existing ephemeral diagnostic command still requires explicit live authorization.
