# WooCommerce Preview URL Window Hotfix

## Status

```text
TASK_STATUS                = READY_FOR_CI
BASE_MAIN                  = 6fc20bf430bac7ec0a55c628020ea8b96bc84346
BRANCH                     = hotfix/woocommerce-preview-url-window
LATEST_LIVE_RESULT         = PREVIEW_URLS_DISABLED
PROVIDER_REQUEST           = 0
PREVIEW_VERSION_UPLOAD     = 0
PRODUCTION_DEPLOYMENT      = UNCHANGED
PRODUCTION_FLAGS           = VERIFIED_ALL_FALSE
PRODUCTION                 = BLOCKED
```

## Verified root cause

The Cloudflare Worker subdomain read returned:

```text
workers.dev enabled    false
Preview URLs enabled   false
```

Both authorized `wrangler versions upload --preview-alias` attempts failed before a Worker Version was created. The locked Wrangler version was corrected to `4.110.0`, but the result remained the same. Therefore the confirmed blocker is the remote Worker Preview URL setting, not Wrangler version drift, Provider behavior, or production Worker deployment.

## Correction

A new confirmation-gated wrapper performs one bounded Preview URL window:

```text
require clean main
→ read exact baseline false / false
→ POST enabled=false, previews_enabled=true
→ read back exact false / true
→ run the reviewed WooCommerce Preview diagnostics operator
→ finally POST enabled=false, previews_enabled=false
→ read back exact false / false
```

The wrapper never enables the base workers.dev route. It changes no production deployment, route, custom domain, Queue, D1, Lark, Schedule, Worker Secret or Business state.

## Public exposure boundary

Cloudflare Preview URLs are public while enabled. The wrapper therefore:

- requires a separate exact confirmation;
- opens the setting only immediately before the diagnostic child process;
- restores it in `finally` after success or failure;
- reports mutation attempts and confirmed mutations;
- fails the overall operation if exact disabled restoration cannot be verified.

## Bounded remote actions after separate authorization

```text
Preview URL setting mutations     2
Worker deployments                0
Preview Version uploads           2
Production traffic changes        0
WooCommerce Provider GET          at most 1
Provider mutations                0
Business mutations                0
Queue / D1 / Lark / Schedule      0
Worker Secret mutations           0
```

A diagnostic failure after Active Preview upload may cause one additional Safe Preview upload inside the existing operator. The wrapper still closes Preview URLs afterward.

## Acceptance criteria

- exact baseline requires `enabled=false` and `previews_enabled=false`;
- activation sends only `enabled=false` and `previews_enabled=true`;
- exact active readback passes before diagnostics begin;
- the reviewed diagnostics child runs unchanged;
- restoration executes from `finally`;
- exact disabled readback is mandatory;
- no token, account ID, credential or Preview URL is printed by the wrapper;
- no production deploy, Queue, D1, Lark, Schedule or Secret mutation command exists;
- focused tests and full Repository CI pass on the exact PR head;
- implementation performs no Remote action.

## Live boundary

Implementation and CI are Repository-only. Squash Merge requires explicit authorization. Opening the temporary public Preview URL window and running the diagnostic require a second, separate explicit authorization after merge.
