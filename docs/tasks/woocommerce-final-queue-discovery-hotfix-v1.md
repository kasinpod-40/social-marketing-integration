# WooCommerce Final Queue Discovery Hotfix v1

## Incident

A resumable WooCommerce 2026 completion run finished and verified the pre-2026 cleanup, then stopped before Final rollout Queue admission with:

```text
WOOCOMMERCE_FINAL_WRANGLER_COMMAND_FAILED
npx wrangler queues list --json failed
```

The repository pins Wrangler `4.110.0`. The reviewed wrapper still requested the removed/unsupported `--json` flag from top-level `queues list`.

## Confirmed impact

```text
pre-2026 cleanup                 completed and verified
Final Queue ID discovery         failed
Final Queue admission            0
new WooCommerce operation        0
Worker deployment                0 in this failed attempt
Meta finalizer                   not started
Production                       blocked
```

## Correction

Use the Cloudflare Queue REST read contract instead of CLI display output:

```text
GET /client/v4/accounts/{account_id}/queues
Authorization: Bearer <resolved Wrangler API-token or OAuth token>
```

The helper:

- performs GET only;
- requires an exact 32-character account identity;
- uses the already resolved bearer token without logging it;
- applies a bounded timeout;
- validates HTTP status, Cloudflare `success`, JSON shape and exact Queue name;
- rejects ambiguous or missing Queue identities;
- records only status/count/error fingerprints;
- does not fall back to human-readable Wrangler table parsing;
- does not send Queue messages.

## Regression

- exact endpoint and GET method;
- bearer header is supplied to injected fetch but never exposed in errors;
- valid Cloudflare response resolves one exact Queue ID;
- non-2xx, invalid JSON, `success=false`, pagination ambiguity and duplicate name fail closed;
- wrapper source contains no `queues list --json` or human-table parsing path;
- existing explicit `MKT_WOOCOMMERCE_FINAL_QUEUE_ID` override remains supported.

## Safety

Repository implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue message, Provider request, Schedule change, Meta execution, Secret change or Production action.

After exact-head CI and Squash Merge, rerun the canonical completion command. Completed cleanup must be verified and skipped, then Final rollout may proceed from the same accepted durable state.
