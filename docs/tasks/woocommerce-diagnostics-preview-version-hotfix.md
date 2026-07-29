# WooCommerce Provider Diagnostics — Preview Version Hotfix

## Status

```text
TASK_STATUS              = READY_FOR_CI
BASE_MAIN                = 511b07716c047be83a9f84d90f1de603d4f330bb
BRANCH                   = hotfix/woocommerce-diagnostics-preview-version
LATEST_INCIDENT          = ATTESTATION_MISMATCH
PROVIDER_REQUEST         = 0
PRODUCTION_FLAGS         = VERIFIED_ALL_FALSE
PRODUCTION               = BLOCKED
```

## Verified incident

The latest authorized diagnostic verified its exact Active Worker version and diagnostic-only flag through the Cloudflare control plane, but the configured public URL returned an unattested JSON 404. The automatic Safe restore then verified its exact Safe version and zero true execution flags before the same unattested 404.

The production Worker therefore ended in the all-flags-false state. The unresolved issue was public route attribution, not Provider behavior or Safe restoration.

## Correction

Diagnostics no longer deploy to production traffic or depend on the configured public origin.

```text
Production all-false preflight
→ upload isolated Active Preview Version without deployment
→ verify exact uploaded-version flags
→ Preview alias 3 × attested 401
→ exactly one authenticated WooCommerce system_status GET
→ upload isolated Safe Preview Version to the same alias
→ verify exact uploaded-version zero flags
→ Preview alias 3 × attested 404
→ verify production deployment remains unchanged
```

## Preview isolation

Both Preview configs use the dedicated entrypoint:

```text
apps/sync-worker/src/woocommerce-provider-diagnostics-entry.js
```

It exposes only the guarded WooCommerce diagnostic GET route. It contains no Queue, Scheduled, D1, Lark, OAuth, report or Business handler.

Generated Preview configs copy no production route, custom domain, Cron trigger, Queue, database, stateful object, storage, service, workflow or asset binding. They require only the two existing WooCommerce credential names.

Active Preview has exactly one true diagnostic flag and a one-time authorization digest. Safe Preview has zero true execution flags and no digest. Active and Safe use different random attestations.

## Structured output

The operator reads Wrangler ND-JSON through `WRANGLER_OUTPUT_FILE_PATH` and accepts exactly one `version-upload` record. It validates one Worker Version ID and one unambiguous HTTPS workers.dev URL matching the random Preview alias. The temporary output file is removed after parsing, and Preview URLs are excluded from persisted evidence.

## Bounded live actions

```text
Worker deployments          0
Worker version uploads      2
Production traffic changes  0
Provider GET attempts       1
Provider mutations          0
Business mutations          0
Queue / D1 / Lark           0
Schedule mutations          0
Configuration secret writes 0
```

A failure after Active Preview upload may perform one additional Safe Preview upload to close the alias. The actual upload count is always reported.

## Acceptance criteria

- Production active version and zero flags are pinned before operation.
- Active and Safe use the Preview-only entrypoint.
- No production trigger or resource binding is copied.
- Active Preview has exactly the diagnostic flag.
- Safe Preview has zero true flags and no one-time digest.
- Structured output is parsed fail-closed.
- Three attested Active 401 responses pass before Provider access.
- Exactly one Provider GET is attempted.
- Three attested Safe 404 responses pass after closure.
- Production active version and zero flags remain unchanged.
- No production deploy, Queue, D1, Lark, Schedule or credential mutation command exists.
- Exact-head Repository CI passes.

## Live boundary

Implementation and CI perform no Remote action. A fresh execution after merge requires separate explicit authorization. Resend or recovery of `woo-final-full-6f43ac8ee857` remains blocked until the Provider diagnostic result is reviewed.
