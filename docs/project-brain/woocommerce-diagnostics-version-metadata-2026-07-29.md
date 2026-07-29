# WooCommerce diagnostics version metadata — 2026-07-29

## Verified incident

The first authorized ephemeral-auth WooCommerce Worker diagnostic attempt failed before Provider access:

```text
code                   WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RUNTIME_VERSION_MISMATCH
expectedVersionId      0147ce69-2acd-463e-bb80-086d181badb8
observedVersionId      null
safeCloseRequired      true
Provider request       0
Business mutation      0
Queue / Lark / Schedule 0
```

Automatic Safe restore reached the same response-attestation failure. Because the shared deploy flow checks the exact 100% active version and exact true flag set before probing the route, the Safe restore had already verified zero true execution flags. Route-level `404` attestation remained unproven because the Worker response lacked runtime version metadata.

## Root cause

The diagnostics HTTP handler emits `x-mkt-worker-version-id` only when `CF_VERSION_METADATA.id` exists. Generated diagnostic configs did not force the required Wrangler `version_metadata` binding, while tests always supplied it and therefore missed the real local config shape.

A second reliability issue existed: the first unattested response failed immediately even though Cloudflare version overrides may require a short propagation interval after deployment.

## Repository correction

Branch:

```text
hotfix/woocommerce-diagnostics-version-metadata
```

Corrections:

- force `version_metadata.binding=CF_VERSION_METADATA` in generated Active and Safe configs;
- reject conflicting source bindings;
- test omitted, exact and conflicting metadata cases;
- retry only exact-version GET probes with bounded delays;
- return the final unmatched response to the existing fail-closed validator;
- leave all non-versioned and non-GET requests untouched.

No Provider, Worker, Queue, D1, Lark, Schedule, Secret or Production action was performed while implementing the correction.

## Next live sequence after merge

```text
clean reviewed main
→ existing ephemeral launcher
→ read-only Remote preflight
→ diagnostic-only deployment
→ exact-version 401 stability proof with bounded propagation retry
→ one authenticated WooCommerce system_status GET
→ all-flags-false Safe restore
→ exact-version 404 closure proof
```

The failed operation `woo-final-full-6f43ac8ee857` must not be resent or recovered until the diagnostic result is reviewed.
