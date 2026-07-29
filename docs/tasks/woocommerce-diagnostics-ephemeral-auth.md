# WooCommerce Worker Provider Diagnostics — Ephemeral Authorization Hotfix

## Incident

The first merged Worker-side diagnostic operator stopped before any Remote preflight or deployment:

```text
code                     WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_INPUT_REQUIRED
message                  MKT_CONNECTION_OPERATOR_TOKEN is required
automaticSafeRestore     null
Provider request         0
Worker deployment        0
Queue / D1 / Lark        0
```

The WooCommerce Consumer Key and Consumer Secret correctly remain Worker-only Secrets. The long-lived customer-connection operator token also was not present in the local `.dev.vars`, so the local launcher could not authenticate the temporary GET-only route.

## Root cause

The Worker-side design correctly kept Provider credentials inside Cloudflare, but reused a long-lived bearer token whose value cannot be read back from Worker Secrets. Requiring the user to recover or duplicate that token locally would weaken the Integration Workspace secret boundary.

## Approved architecture

The diagnostic session now creates its own one-time authorization material:

```text
local launcher
→ random 256-bit token in process memory
→ SHA-256 digest
→ raw token kept only in the local process
→ digest included only in the temporary diagnostic Worker config
→ authenticated exact-version GET sends the raw token
→ Worker hashes the supplied token and compares digests timing-safely
→ all-false Safe deployment removes the digest binding
```

The raw token is never:

- committed;
- written to `.dev.vars`;
- uploaded as a Worker Secret;
- included in a generated Wrangler config;
- printed or persisted in evidence;
- returned by the Worker.

## Remote Secret contract

Only these existing Secret names are required for the diagnostic Provider call:

```text
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
```

`MKT_CONNECTION_OPERATOR_TOKEN` remains untouched and is no longer a prerequisite for this isolated diagnostic flow.

## Safety contract

The active Worker window permits exactly one true execution flag:

```text
MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_HTTP_ENABLED
```

The active config contains only the one-time digest variable:

```text
MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256
```

The Safe config omits that digest and sets every execution flag false.

The operator continues to perform:

```text
Worker deployments       2 maximum
Provider GET              1 maximum
Provider mutation         0
Queue / DLQ               0
Remote D1 write           0
Business / Coverage write 0
Lark request              0
Schedule mutation         0
Worker Secret mutation    0
Production action         0
```

Automatic Safe restore remains mandatory after any ambiguous failure once activation begins.

## Supported command after merge

```bash
CONFIRM_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS=RUN_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS \
node scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs --execute
```

The prior low-level script remains an internal operator implementation. The ephemeral launcher is the supported entrypoint for operators who do not possess the long-lived connection token locally.

## Acceptance criteria

- no local long-lived operator token is required;
- a cryptographically random token is generated for each execution;
- only its SHA-256 digest reaches the active config;
- missing or wrong bearer tokens fail before Provider access;
- the diagnostic performs exactly one `system_status` GET;
- response evidence remains bounded and body-free;
- Safe restore removes the digest and closes the route to HTTP 404;
- full Branch Verification passes before merge;
- this hotfix does not authorize Final rollout resend or stale-operation recovery.
