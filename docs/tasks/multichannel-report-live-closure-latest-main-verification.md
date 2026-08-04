# Multichannel Report Live Closure — Latest Main Verification

## Purpose

Trigger and retain an exact Pull Request verification against the latest `main` before merge. This file adds no runtime authority and performs no Remote action.

## Reviewed boundary

```text
PR                              = 466
PR_HEAD_BEFORE_REVALIDATION      = 5e397f8547042d26786f52acace97283db43bc0c
LATEST_MAIN_AT_REVALIDATION      = 25890c27a2e73735c7f296d6b87ba2e6825e5757
READY_CHANNELS                  = facebook,instagram,youtube,woocommerce,chatwoot
WINDOWS                         = 1,3,7,30
REMOTE_READ_COUNT               = 0
REMOTE_WRITE_COUNT              = 0
QUEUE_ACTION_COUNT              = 0
WORKER_DEPLOYMENT_COUNT         = 0
SCHEDULE_ENABLED                = false
PRODUCTION                      = BLOCKED
CI_STATUS                       = PENDING_EXACT_HEAD
```

## Verification rule

The Pull Request `synchronize` event must run Branch Verification on the new exact Head while GitHub evaluates the merge result against the current `main`. Merge readiness may be claimed only when every configured gate succeeds and the PR remains mergeable.

This verification does not authorize Report materialization. SELECT-only readiness and Live 1D/3D/7D/30D execution remain blocked until the framework is merged and the exact Meta Remote lock-release evidence exists.
