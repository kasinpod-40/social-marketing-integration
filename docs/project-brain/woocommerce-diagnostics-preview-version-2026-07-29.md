# WooCommerce diagnostics Preview Version — 2026-07-29

## Latest verified fact

The authorized diagnostic on `main@511b07716c047be83a9f84d90f1de603d4f330bb` stopped before Provider access:

```text
code                         WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_MISMATCH
Active response              HTTP 404 / no attestation
Active control plane         exact version and exact flag passed
Provider request             0
Safe response                HTTP 404 / no attestation
Safe control plane           exact version and zero flags passed
Worker deployments           2
Queue / D1 / Lark / Schedule 0
```

The production Worker was restored and verified all-flags-false. The result proves the configured public URL could not attest that it reached the reviewed Worker version.

## Current correction

Branch:

```text
hotfix/woocommerce-diagnostics-preview-version
```

The diagnostic now uploads isolated Cloudflare Preview Versions without deploying them to production traffic. A dedicated Preview-only entrypoint exposes only the guarded WooCommerce diagnostic GET route.

The Preview configuration contains no production routes, Cron, Queue, D1, storage, service, workflow or asset binding. Production deployment identity and zero execution flags are checked before, during and after the Preview operation.

Active and Safe Preview versions share a random alias. Active requires the one-time local authorization and returns an Active attestation. Safe replaces the alias target, has zero true flags and returns a distinct Safe attestation.

Wrangler upload results are accepted only from one structured `version-upload` ND-JSON record. Preview URLs are not persisted.

## Next sequence

```text
exact-head CI
→ Squash Merge after explicit authorization
→ separate authorization for two Preview Version uploads and one Provider GET
→ review Provider result
→ keep Final rollout and stale-work recovery blocked until review
```

No Remote action was performed while implementing this correction.
