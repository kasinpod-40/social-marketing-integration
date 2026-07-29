# WooCommerce Provider Diagnostics Source Contract — 2026-07-29

## Verified failure

The first post-PR-#228 local diagnostic made zero Provider requests and returned
`WOOCOMMERCE_BASE_URL is required`. All mutation counters remained zero.

## Correct diagnosis

This was not a WooCommerce, WAF, JSON, Cloudflare Worker or credential failure. The local diagnostic
assembled runtime config differently from the Final rollout:

```text
Final rollout
  canonical Wrangler config
  → exact non-secret source materialization
  → temporary source-safe Wrangler config

Provider diagnostic before hotfix
  .dev.vars + process.env
  → runtime config directly
  → missing non-secret source contract
```

The source contract already exists centrally and pins:

```text
origin       https://chemistryk.online
API          wc/v3
timeout      45000 ms
currency     THB
```

## Repository response

Branch `hotfix/woocommerce-provider-diagnostics-source-contract` reuses the central contract for all
four non-secret fields and fails closed on explicit conflicts before a GET can occur. Credentials are
not copied, transformed, printed or persisted by this adapter.

## Safety state

```text
Provider request during failed command     0
Worker deployment                          0
Queue/DLQ                                  0
Remote D1 / Business / Coverage mutation   0
Lark request or mutation                   0
Schedule mutation                          0
Production                                 blocked
```

The existing all-flags-false Worker remains the authoritative Remote safe state. No Final rollout
resend is authorized by this hotfix.
