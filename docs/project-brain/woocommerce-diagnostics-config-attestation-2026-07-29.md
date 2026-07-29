# WooCommerce diagnostics config attestation — 2026-07-29

## Verified second incident

The second authorized Worker-side WooCommerce diagnostic attempt failed before Provider access:

```text
code                     WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RUNTIME_VERSION_MISMATCH
expectedVersionId        0d87c498-b53b-4d85-bc50-6ee9381d06ee
observedVersionId        null
Provider request         0
Business mutation        0
Queue / Lark / Schedule  0
```

The Active and automatic Safe deployments both passed the existing control-plane sequence before the HTTP proof:

```text
wrangler deploy
→ exact deployed version is sole 100% active
→ inspect exact version
→ exact expected true flag set
→ public route probe
```

The Safe restore therefore reached zero true execution flags even though response-level route attribution remained unproven.

## Corrected design decision

Do not use `Cloudflare-Workers-Version-Overrides` plus `CF_VERSION_METADATA.id` as a mandatory safety gate for this operator.

The operator already moves the reviewed generated version to 100% traffic and verifies exact version identity and flags through Wrangler. Cloudflare version overrides are an optional routing mechanism for selecting versions in a current deployment and may not be applied. They are not required when the just-deployed version is already the sole 100% active version.

Public HTTP attribution now uses a generated config attestation:

```text
Active config → random attestation A
Safe config   → random attestation B
A != B
```

The route returns the configured value only in the bounded header:

```text
x-mkt-woocommerce-diagnostics-attestation
```

The header is present on matched route responses before Provider access, including Active 401 and Safe 404. It is not an authorization credential and never appears in JSON evidence.

## Safety contract

Before the single authenticated Provider GET:

```text
exact active version at 100%
+ exact diagnostics-only flags
+ stable HTTP 401
+ exact Active attestation
```

After the Provider result:

```text
exact Safe version at 100%
+ zero true execution flags
+ stable HTTP 404
+ exact Safe attestation
```

The Safe config removes the ephemeral token digest. It retains only a non-secret generated attestation until the next reviewed config deployment.

Failure evidence now distinguishes control-plane safety from HTTP closure proof. A future failure must report the actual Worker deployment count and Provider request count instead of only mutation counters.

## Repository scope

```text
branch       hotfix/woocommerce-diagnostics-config-attestation
base main    75548338d78933a4489b210a1f15f616848cad2e
Provider     not called during implementation
Worker       not deployed during implementation
Queue/D1     none
Lark         none
Schedule     none
Secret       none
Production   blocked
```

The failed Final rollout operation `woo-final-full-6f43ac8ee857` remains blocked from resend or recovery until a successful diagnostic result is reviewed.
