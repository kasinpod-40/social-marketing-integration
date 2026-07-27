# Project Brain — WooCommerce Wrangler Auth Auto-discovery Hotfix

## Incident

The first WooCommerce final command attempts stopped before Remote execution because local
`wrangler.sync.jsonc` intentionally contained no `account_id`, while the wrapper required both
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as explicit environment inputs.

## Durable correction

The one-command wrapper now resolves Cloudflare authentication in this order:

```text
Account ID:
explicit non-empty environment
→ Wrangler config account_id
→ exact account from wrangler whoami --json

Bearer authentication:
explicit non-empty API token
→ API/OAuth token from wrangler auth token --json
```

Multiple accounts fail closed unless an exact ID/name preference is supplied. API key/email auth remains
blocked because the Queue submission path uses bearer authorization. Token and Account ID values are not
logged or committed; evidence retains only authentication type/source and an Account ID fingerprint.

## Remote boundary

```text
REMOTE_D1_ACTION             = NONE
WORKER_DEPLOYMENT            = NONE
QUEUE_OR_DLQ_ACTION          = NONE
LARK_ACTION                  = NONE
WOOCOMMERCE_PROVIDER_REQUEST = NONE
SCHEDULE_ACTION              = NONE
PRODUCTION                   = BLOCKED
```
