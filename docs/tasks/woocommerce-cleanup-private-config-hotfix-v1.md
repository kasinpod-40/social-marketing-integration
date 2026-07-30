# WooCommerce Cleanup Private Config Hotfix v1

## Incident

A Live WooCommerce 2026 completion attempt stopped at the first nested cleanup D1 read:

```text
WOOCOMMERCE_2026_CLEANUP_WRANGLER_FAILED
stage=d1-read
status=1
```

The outer completion path had already passed local verification and the Remote Worker all-false preflight. The nested cleanup process then invoked Wrangler with the historical default path `wrangler.sync.jsonc`.

The Safe Launcher had copied the local runtime config only to:

```text
.mkt-woocommerce-2026-completion-wrangler.jsonc
```

The repository intentionally does not track `wrangler.sync.jsonc`, so the sealed clone did not contain the filename expected by the nested cleanup process.

## Confirmed impact

```text
successful cleanup D1 read     0
cleanup backup                 not started
Lark delete                    0
D1 delete/update               0
Worker deployment              0
Queue admission/message        0
Meta finalizer                 not started
Production                     blocked
```

The previous WooCommerce operation and cleanup state remain the resumable source of truth.

## Correction

The existing Safe Launcher now creates two mode-`0600` snapshots from the same validated local Wrangler config:

```text
.mkt-woocommerce-2026-completion-wrangler.jsonc
wrangler.sync.jsonc
```

- the modern private path remains the explicit environment contract;
- the legacy filename supports reviewed nested operators that still resolve the default path;
- both filenames are added only to clone-local `.git/info/exclude`;
- neither file is committed or copied back to the source checkout;
- the launcher fails closed if the sealed repository already contains the legacy filename;
- the clone is destroyed in `finally`.

## Regression contract

Focused tests require:

- both config constants;
- both clone-local exclude entries;
- modern snapshot from the source config;
- legacy snapshot copied from the immutable modern snapshot;
- collision guard before legacy creation;
- explicit modern config environment for current operators;
- no deploy or Queue path in the launcher.

## Required verification

```text
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification CI on exact PR head
```

## Live continuation

After Squash Merge, rerun the existing Safe Launcher command from current `main`. The command remains fail-closed and resumable. Meta must not start unless WooCommerce prints `WOOCOMMERCE_2026_COMPLETED_SAFE` and the final Remote Work/Lock/Queue/flag checks pass.
