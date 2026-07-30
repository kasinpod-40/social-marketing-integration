# Final Delivery Readiness Manifest v1

## Incident

Terminal launchers v1-v5 attempted to discover prerequisites while performing the live WooCommerce
recovery/completion chain. Each attempt failed closed, but a different missing or incompatible
prerequisite was revealed only after the operator started:

```text
private Wrangler config path
macOS /var and /private/var identity
Wrangler Queue list JSON support
completed cleanup with archived Work row
current Queue consumer field names
intermittent Provider invalid JSON
supported ephemeral diagnostics entrypoint
account workers.dev subdomain
```

The latest v5 attempt stopped before the first Provider request because the recovery chain invoked
the ephemeral diagnostics operator without the Preview URL window that owns account-subdomain
lookup and Safe Preview enable/restore.

Verified latest attempt:

```text
Provider request          0
Worker Version upload     0
Worker deployment         0
Queue message             0
D1/Lark mutation          0
Meta execution            0
Production                blocked
```

## Decision

Stop issuing another all-in-one shell launcher. Replace it with two explicit phases.

### Phase A — aggregated read-only readiness audit

The audit collects all independent blockers in one run and writes an expiring mode-`0600` manifest
only when every gate passes:

- exact clean `main == origin/main`;
- private regular `.dev.vars` and Wrangler config with immutable SHA-256 fingerprints;
- pinned Node dependencies and required repository operators;
- Cloudflare account/auth resolution through existing shared helpers;
- GET-only account workers.dev subdomain lookup;
- GET-only Worker subdomain baseline (`enabled=false`, `previews_enabled=false`);
- exactly one active Worker Version with every `MKT_*_ENABLED` flag false;
- exact required Worker Secret names;
- exact main Queue identity through bounded GET-only REST discovery;
- exact Woo invalid-JSON incident state, one Queue attempt, zero lock/Coverage and zero incident-
  attributed rows across all 17 Woo D1 write tables;
- completed pre-2026 cleanup with zero old/aggregate rows;
- Lark token/table/field reads proving no schema mutation is required;
- exact Meta clone Head, session, overlay, finalizer markers and Instagram operation identity.

The audit may perform authenticated read requests and a Lark tenant-token request. It cannot upload
or deploy Worker Versions, open Preview URLs, call the WooCommerce Provider, send Queue messages,
write D1/Lark Business data, change schedules/secrets or execute Meta.

Output:

```text
status          READY_TO_EXECUTE
contract        mkt_final_delivery_readiness_v1
file mode       0600
expiry          30 minutes
secret values   absent
```

When any gate fails, all reachable gate failures are returned together and no manifest is created.

### Phase B — manifest-gated checkpointed executor

The executor accepts only an unexpired readiness manifest for the exact current Repository Head and
unchanged local input hashes. It injects the audited non-secret Cloudflare account, Queue and
workers.dev values, then delegates guarded work in this order:

```text
Woo Preview URL window
→ ephemeral Provider diagnostics
→ exact lifecycle-only invalid-JSON recovery
→ canonical WooCommerce 2026 completion
→ verify cleanup/parity/replay/incremental/all-false summary
→ exact pinned Meta finalizer
→ verify session.completed=true
```

A private checkpoint records only Woo and Meta completion state. A rerun skips Woo only when the
exact reviewed Woo completion summary is already present and valid. It never creates a new Meta
operation ID or changes the pinned Meta Head.

## Preview ownership correction

The recovery chain now invokes:

```text
scripts/woocommerce-worker-provider-diagnostics-preview-window.mjs
```

instead of invoking the ephemeral child directly. The Preview window already owns:

- Cloudflare account/auth resolution;
- GET-only workers.dev subdomain discovery;
- deterministic Preview origin;
- temporary Preview URL enablement while workers.dev remains disabled;
- ephemeral 256-bit local authorization;
- one authenticated Provider GET;
- automatic disabled-state restore in `finally`;
- unchanged Production deployment checks.

This reuses the reviewed Codex architecture rather than duplicating its prerequisites in the
recovery chain.

## Files

```text
scripts/lib/final-delivery-readiness.js
scripts/final-delivery-readiness-audit.mjs
scripts/final-delivery-from-readiness.mjs
scripts/woocommerce-invalid-json-recovery-chain.mjs
tests/application/final-delivery-readiness.test.js
tests/application/final-delivery-from-readiness.test.js
tests/application/woocommerce-invalid-json-recovery-chain.test.js
```

## Safety

```text
Audit Provider request          0
Audit Worker upload/deploy      0
Audit Queue message             0
Audit D1 mutation               0
Audit Lark mutation             0
Audit Meta execution            0
Manifest secret values          0
Executor Production             false
Schedule enable                 forbidden
Manual Business row edit        forbidden
New Meta operation ID           forbidden
```

## Required verification

```text
focused readiness/manifest/executor/Preview-window regressions
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification on exact PR Head
```

## Live execution boundary

Repository implementation and CI do not authorize or perform the readiness audit or manifest
execution against live infrastructure. After merge, the first user command must run the audit only.
Execution is not permitted unless its final status is exactly `READY_TO_EXECUTE`.
