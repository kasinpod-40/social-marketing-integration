# Meta Lark Table Environment Fallback Hotfix v1

## Incident

The controlled Facebook Lark continuation for `meta-facebook-daily-20260808-r2` stopped safely in `lark-preflight` before any mutation with:

```text
LARK_TABLE_CONFIG_INVALID
Missing required env LARK_TABLE_RAW_META_ORGANIC_ACCOUNTS
```

The accepted D1-only operation had already completed and restored the Worker to all-false. The failed Lark preflight performed no Lark write, Queue send, Worker deployment or Schedule change.

## Root cause

`meta-lark-parity-rollout-launcher.mjs` applied the Meta customer runtime environment before reading the safe Wrangler config. `materializeMetaHistoryLarkRuntimeConfig()` then required every Meta/Lark table ID to already be duplicated in process env or `.dev.vars` even though the same non-secret table mappings may already exist in the reviewed safe `wrangler.sync.jsonc`.

This made the launcher reject an otherwise valid current mapping authority before it could materialize the runtime config.

## Fix

- Extend the existing Meta history runtime authority instead of adding a new mapping layer.
- Hydrate required Meta/Lark table IDs from the reviewed safe Wrangler config only when the corresponding runtime env value is missing.
- If both runtime env and safe config provide a value, require exact equality and fail closed on drift.
- Reuse `readLarkTableIdsFromEnv()` for required-key and duplicate-table-ID validation.
- Pass the hydrated environment to both runtime-config materialization and the Lark operator child process.

## Safety

Repository-only implementation. No Worker deployment, Queue send, D1/Lark mutation, Schedule activation, Secret mutation or Production action. Table IDs are not logged or persisted as evidence by this hotfix.

The retained Facebook D1 summary remains the required authority for the next Lark continuation attempt. The prior blocked Lark preflight did not send the operation and is safe to supersede after this hotfix is merged and a fresh Lark preflight is run on the reviewed head.
