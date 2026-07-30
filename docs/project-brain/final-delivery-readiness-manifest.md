# Final Delivery Readiness Manifest

## Current decision

Final delivery no longer starts from an all-in-one Terminal launcher that discovers prerequisites
while mutating live infrastructure. The authoritative workflow is now:

```text
aggregated read-only readiness audit
→ expiring private readiness manifest
→ manifest-gated checkpointed executor
```

The audit is the only supported first command. Execution is blocked unless the audit returns exact
status `READY_TO_EXECUTE`.

## Why this replaces v1-v5

The previous launchers failed closed but exposed prerequisites one at a time. This increased user
retries and delivery time even though most failures occurred before Remote mutation. Readiness v1
collects all reachable blockers in one pass and captures immutable local/remote identity evidence
before any live write window is allowed.

## Audit contract

The audit verifies exact clean main, private local files and hashes, Cloudflare account/auth,
GET-only workers.dev subdomain, Worker all-false/Preview-disabled state, Secret names, Queue,
Woo exact incident and cleanup state, read-only Lark schema, and the pinned Meta continuation.

The mode-`0600` manifest contains non-secret execution inputs and fingerprints only. Bearer tokens,
Provider credentials, Lark secret values, response bodies and authorization headers are never
persisted or printed. The manifest expires after 30 minutes and is invalid when Repository Head or
local input hashes change.

## Execution contract

The executor validates the manifest before any delivery child starts, uses a private checkpoint,
verifies WooCommerce Safe completion before Meta, and preserves:

```text
Meta Head        e069380a544575ce0fc9bca53f1fb56944d26c09
Instagram op     meta-instagram-d1-20260729t065939687z-1ad3c9
Production       false
Schedule         disabled
```

## Woo diagnostics ownership

Woo invalid-JSON recovery must invoke the Preview URL window wrapper, not the ephemeral or low-level
diagnostic child directly. The Preview wrapper owns account-subdomain lookup, deterministic Preview
origin, temporary Preview enablement, ephemeral authorization and automatic disabled-state restore.

## Detailed task

`docs/tasks/final-delivery-readiness-manifest-v1.md`
