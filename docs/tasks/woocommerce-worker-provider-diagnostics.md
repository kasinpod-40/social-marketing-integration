# WooCommerce Worker-side Provider Diagnostics

## Status

```text
IMPLEMENTATION_STATUS     = REPOSITORY_IMPLEMENTED_PENDING_CI
REMOTE_ACTION             = NONE
PROVIDER_REQUEST          = NONE
WORKER_DEPLOYMENT         = NONE
QUEUE_MESSAGE             = NONE
D1_WRITE                  = NONE
LARK_REQUEST              = NONE
SCHEDULE_MUTATION         = NONE
SECRET_MUTATION           = NONE
PRODUCTION                = BLOCKED
```

## Incident chain

The guarded Final rollout admitted operation `woo-final-full-6f43ac8ee857` and the Worker failed on the
first `system_status` response with `WOOCOMMERCE_INVALID_JSON`. Automatic all-false restore succeeded,
and all Commerce/Coverage counts remained zero.

A local diagnostic was then attempted twice:

1. it first stopped at missing non-secret `WOOCOMMERCE_BASE_URL`;
2. after the non-secret source contract was materialized, it stopped at missing
   `WOOCOMMERCE_CONSUMER_KEY`.

Both local attempts made zero Provider requests and zero mutations.

## Root cause of the local diagnostic failure

WooCommerce credentials are deployed Worker Secrets. Cloudflare exposes Secret names but not their
values after deployment. The values therefore cannot be read back into a local Node.js process. The
local `.dev.vars` file intentionally does not duplicate these production-like Worker-only credentials.

The old local diagnostic path is now retired and fails closed with
`WOOCOMMERCE_LOCAL_PROVIDER_DIAGNOSTICS_UNSUPPORTED`.

## Supported diagnostic flow

```text
clean reviewed main
→ local + Remote read-only preflight
→ verify required Worker Secret names
→ verify current Worker is all-flags-false
→ build Safe and diagnostic-only configs from the existing Final source contract
→ dry-run both bundles
→ deploy diagnostic-only Worker window
→ verify exact active version and exact true flag set
→ probe unauthenticated route three times: 401 / 401 / 401
→ exact-version authenticated GET
→ Worker uses its own WooCommerce Secrets for one system_status request
→ return success or bounded failure diagnostics
→ deploy all-flags-false Safe config
→ verify exact active version and exact true flag set
→ probe route three times: 404 / 404 / 404
```

## Active window contract

Exactly one `MKT_*_ENABLED` flag may be true:

```text
MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_HTTP_ENABLED
```

The following remain false, along with every unrelated execution flag:

```text
MKT_CONNECTOR_WOOCOMMERCE_ENABLED
MKT_WOOCOMMERCE_D1_WRITE_ENABLED
MKT_WOOCOMMERCE_LARK_WRITE_ENABLED
MKT_WOOCOMMERCE_REPORT_READ_ENABLED
MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED
MKT_SCHEDULE_WOOCOMMERCE_ENABLED
```

The route internally enables source parsing only for constructing the read-only REST client. It does
not enable the Queue connector route or any business-write gate.

## HTTP contract

```text
GET /operator/woocommerce/provider-response-diagnostics
Authorization: Bearer <MKT_CONNECTION_OPERATOR_TOKEN>
```

- disabled route: `404`;
- enabled without valid auth: `401`;
- valid WooCommerce JSON: `200` with bounded Store identity;
- invalid successful JSON: `422` with exact code `WOOCOMMERCE_INVALID_JSON`;
- other bounded Provider failure: `400`;
- every response is `no-store`, carries the Worker runtime-version header and contains no credential
  value, response body, body prefix, cookie or unrestricted header.

## Allowed invalid-JSON evidence

```text
resource
HTTP status
bounded Content-Type
bounded Content-Encoding
numeric Content-Length
body byte length
body SHA-256
body structural shape
leading BOM removed: true/false
bounded network-cause fields
```

## Explicitly impossible paths

The route and operator contain no:

- Queue or DLQ send;
- D1 query/write/migration;
- Business/Coverage write;
- Lark request;
- Schedule activation;
- Secret put/delete/rotation;
- Production action;
- Final rollout resend;
- recovery of `woo-final-full-6f43ac8ee857`.

## Live execution boundary

Repository implementation and CI do not authorize live execution. After Squash Merge, the temporary
Worker diagnostic window requires separate explicit authorization because it performs exactly two
Worker deployments: diagnostic-only activation and all-false restore.

The future exact command is:

```bash
CONFIRM_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS=RUN_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS \
node scripts/woocommerce-worker-provider-diagnostics.mjs --execute
```

Do not run the retired local command and do not rerun WooCommerce Final rollout or send another Queue
operation until this diagnostic has completed and the result has been reviewed.
