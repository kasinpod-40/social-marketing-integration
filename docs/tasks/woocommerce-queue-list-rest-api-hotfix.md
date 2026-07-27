# WooCommerce Queue List REST API Hotfix

## Incident

The WooCommerce final command stopped before D1, Lark, Worker deployment, Queue send, or Schedule action because current Wrangler accepts `queues list` but does not accept `queues list --json`.

## Correction

A plan-only-by-default wrapper now:

1. validates the exact Integration Workspace / Chemistry K target;
2. reuses the existing Wrangler account and bearer auto-discovery;
3. calls Cloudflare `GET /accounts/{account_id}/queues` with bearer authentication;
4. resolves the exact `social-mkt-sync-jobs` Queue ID from the JSON API response;
5. delegates to the existing guarded WooCommerce final one-command with `MKT_WOOCOMMERCE_FINAL_QUEUE_ID` set.

No Queue ID, Account ID, token, Consumer Key, Consumer Secret, provider record, or PII is logged or committed.

## Safety boundary

```text
REMOTE_ACTIONS_DURING_IMPLEMENTATION = NONE
D1_MUTATION                          = NONE
LARK_MUTATION                        = NONE
WORKER_DEPLOYMENT                    = NONE
QUEUE_SEND                           = NONE
SCHEDULE                             = UNCHANGED
PRODUCTION                           = BLOCKED
```

## Final command after merge

```bash
CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT=EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT \
node scripts/woocommerce-final-one-command-rest-queue.mjs --execute
```
