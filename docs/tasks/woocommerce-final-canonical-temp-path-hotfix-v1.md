# WooCommerce Final Canonical Temp Path Hotfix v1

## Incident

A resumable WooCommerce 2026 completion attempt successfully completed the pre-2026 D1/Lark cleanup and exact old-operation closure, then stopped before Final reconciliation with:

```text
WOOCOMMERCE_FINAL_PATH_INVALID
Wrangler config path must remain inside Repository
```

## Root cause

The private Wrangler config was inside the sealed repository. On macOS the same temporary directory was represented by two textual aliases:

```text
/var/...
/private/var/...
```

The Final wrapper and Final rollout operator intentionally use fail-closed Repository containment guards. Those guards compared unresolved strings, so one filesystem identity under two path aliases was rejected.

## Correction

Add a canonical launcher:

```text
scripts/woocommerce-2026-completion-canonical-launcher.mjs
```

Before importing the reviewed Safe Launcher it resolves the active temporary directory with `realpath` and sets:

```text
TMPDIR
TMP
TEMP
```

to the same canonical directory. Every sealed clone and private config path is therefore created under one stable textual and filesystem identity. Existing Final containment guards remain unchanged and fail closed for actual outside-Repository paths.

## Resume state

The prior attempt already reported:

```text
d1Verified=true
larkVerified=true
pre-2026 D1 rows=0
pre-2026 Lark rows=0
old Work/Sync closure completed
Worker execution flags all false
Schedule false
Production false
```

The next run must verify and skip completed cleanup. It must not blindly repeat deletion. Final reconciliation, parity, replay, incremental UAT, Safe closeout and Meta continuation remain pending.

## Regression contract

- symlinked temporary-root aliases canonicalize to one filesystem path;
- `TMPDIR`, `TMP` and `TEMP` receive the same canonical value;
- sealed config paths remain regular non-symlink files under the canonical sealed root;
- canonicalization occurs before importing the Safe Launcher;
- non-directory temporary targets fail closed;
- the canonical launcher contains no Worker deploy, Queue-send, D1-write or Lark-write implementation of its own.

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

## Safety

Repository implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue message, Provider request, Schedule change, Secret change, Meta execution or Production action.
