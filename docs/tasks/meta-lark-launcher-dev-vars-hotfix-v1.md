# Meta Lark Launcher `.dev.vars` Hotfix v1

## Incident

The controlled Facebook R2 Lark continuation stopped safely in `lark-preflight` before any remote mutation.

After the safe-config mapping fallback was merged, the launcher still returned `META_HISTORY_LARK_TABLE_MAPPING_MISSING` for `LARK_TABLE_RAW_META_ORGANIC_ACCOUNTS`.

## Root cause

`meta-lark-parity-rollout-operator.mjs` already loads `.dev.vars` through the shared `readDevVars()` helper before validating Lark table mappings. The compatibility launcher introduced an earlier mapping validation step but built that environment only from `process.env` and the reviewed Wrangler config. As a result, a valid private mapping stored only in `.dev.vars` could never reach the operator because the launcher failed first.

## Correction

The Meta Lark launcher now:

1. loads `.dev.vars` using the existing `readDevVars()` helper;
2. applies the same precedence as the operator: file environment first, process environment second;
3. applies the fixed Integration Workspace runtime authority;
4. resolves required Lark table mappings against that combined environment and the reviewed safe Wrangler config;
5. preserves the existing mismatch, duplicate-ID and missing-mapping fail-closed gates.

No Table IDs or secrets are added to source control.

## Regression

A focused launcher integration test uses a temporary `.dev.vars`, a safe Wrangler fixture with no Lark table mappings, and a fake child operator. It proves that all required mappings are hydrated before the launcher materializes the runtime config and that the child receives the same mapping set.

## Safety

Repository-only hotfix. No Provider request, Queue message, D1 write, Lark write, Worker deployment, Schedule activation, secret mutation, or Production action is performed by this change.

The completed Facebook R2 D1 evidence remains authoritative and must not be regenerated.
