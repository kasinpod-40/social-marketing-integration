# WooCommerce Diagnostics Ephemeral Authorization — 2026-07-29

## Verified live fact

The first execution of the merged Worker-side Provider diagnostic stopped locally with:

```text
WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_INPUT_REQUIRED
MKT_CONNECTION_OPERATOR_TOKEN is required
```

No Remote preflight, Worker deployment or Provider request occurred. Automatic Safe restore was not needed because activation never began. All Queue, D1, Business, Coverage, Lark and Schedule counters remained zero.

## Corrected decision

Do not copy, rotate or attempt to retrieve the existing long-lived connection operator token for this diagnostic. The isolated diagnostic must create a one-time 256-bit token locally, deploy only its SHA-256 digest in the temporary active Worker config, authenticate one exact-version GET, then remove the digest through the all-flags-false Safe deployment.

## Repository implementation

Branch:

```text
hotfix/woocommerce-diagnostics-ephemeral-auth
```

Changes:

- add an ephemeral launcher around the existing reviewed operator;
- reuse the existing deployment, version pinning, route stability and Safe-restore flow;
- require only the existing WooCommerce Consumer Key/Secret names remotely;
- compare bearer-token digests timing-safely in the Worker;
- ensure the Safe config omits the temporary digest;
- retain bounded invalid-JSON evidence and all zero-mutation counters;
- add focused config, auth, redaction and no-Secret-mutation regressions.

## Safety state

Implementation itself performs no Remote action:

```text
Provider request          0
Worker deployment         0
Queue / DLQ               0
Remote D1 mutation        0
Business / Coverage write 0
Lark request              0
Schedule mutation         0
Secret mutation           0
Production                0
```

The existing all-flags-false Worker remains authoritative. Operation `woo-final-full-6f43ac8ee857` remains untouched. Final rollout resend and stale-work recovery remain separately blocked until the diagnostic result is reviewed.
