# WooCommerce Recovery Ephemeral Diagnostics Hotfix v1

## Incident

The merged invalid-JSON recovery chain stopped before the first Provider request with:

```text
WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID
MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256 is required
providerRequestAttemptCount = 0
providerRequestCount = 0
```

No lifecycle recovery, D1 mutation, Queue message, Lark action, Worker deployment or Meta execution occurred.

## Root cause

The chain invoked the internal low-level operator directly:

```text
scripts/woocommerce-worker-provider-diagnostics.mjs
```

That operator intentionally requires pre-materialized ephemeral authorization inputs. The supported operator entrypoint established by the prior Codex hotfix is:

```text
scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs
```

The supported entrypoint creates a fresh 256-bit token in process memory, computes SHA-256 locally, exposes only the digest to the isolated active Preview config and forwards the raw token only to the one authenticated diagnostic process.

## Correction

The recovery chain now invokes the supported ephemeral entrypoint before any lifecycle mutation:

```text
exact incident read-only preflight
→ ephemeral Worker Provider diagnostics
→ exact lifecycle-only recovery
→ terminal post-verification
→ canonical WooCommerce 2026 completion
```

## Security and safety

```text
Raw ephemeral token committed             no
Raw token written to .dev.vars            no
Raw token printed or persisted            no
Worker Secret mutation                    0
Provider requests before this fix         0
Business/Coverage/Lark mutation            0
Queue messages                            0
Production deployment                     0
Schedule                                  disabled
Meta                                      not started
```

The existing exact operation, zero incident-attributed writes across 17 WooCommerce D1 tables, Queue attempt, Coverage, phase, generation and lock guards remain unchanged.

## Regression

Tests require:

- the recovery chain to call `woocommerce-worker-provider-diagnostics-ephemeral.mjs`;
- direct invocation of the low-level diagnostics script from the chain to be absent;
- the ephemeral launcher to use `randomBytes(32)` and local SHA-256;
- no console or file persistence path in the ephemeral launcher;
- diagnostics to remain ordered before lifecycle recovery and canonical completion.

## Required validation

```text
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification CI on exact PR head
```

Repository implementation and CI perform no Remote action.
