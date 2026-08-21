# Changelog

## Unreleased — Facebook Organic observed aggregation + live rematerialization — 2026-08-21

### Shared Organic aggregation repair

- Fixed Shared Organic aggregation so authoritative `complete` / `revisable` source coverage no longer lets a few historical metric-specific null members erase otherwise observed Likes, Comments, Shares and Engagement totals.
- Preserved source and row-level null evidence: row Engagement remains strict, period observed subtotals require authoritative source coverage plus complete baseline coverage, and partial/unproven coverage remains fail-closed.
- Preserved observed zero and signed negative corrections; no missing metric is converted to zero.
- PR #662 merged the calculation repair to `main` at `0d8cac334405d755a108f2adea65e9cc6f4cd646` after full Branch Verification.

### Exact-runtime-preserving Integration rollout

- Added a narrow Facebook Organic 1D/3D/7D/30D rematerialization operator that reuses the existing Shared Report/D1/Lark/Queue/deployment primitives instead of creating a Facebook-specific Report engine.
- The operator captures the active Worker `MKT_*_ENABLED` vector, deploys current `main` with that vector preserved exactly, and temporarily enables only the two existing Shared Report execution flags when required.
- Refresh is stable-ID-only and D1-backed. It performs zero Facebook Provider refetch, zero manual Lark patch, one private D1 backup before Queue mutation, bounded D1↔Lark verification for every window, and exact runtime-flag restoration after execution.
- Recorded deploy/send attempts block blind rerun. Recovery may restore the exact captured runtime and verify completed reports, but sends zero Queue jobs.
- PR #663 passed final Branch Verification on head `c2c73ebe1117018c73375f9903e152c6430c8848` (Run `32446529335`, Job `96667104644`) and merged to `main` at exact SHA `55435bbabbf5788a2cb76790ed5e0b3d137587fb`.

### Live preflight JSON-Boolean binding hotfix

- Controlled Integration execution remained fail-closed before any remote mutation when the active Worker exposed `MKT_CONNECTOR_FACEBOOK_ENABLED` as a Cloudflare `json` Boolean binding. The original rollout helper incorrectly admitted only `plain_text` execution flags.
- Updated remote flag readback to accept both reviewed Cloudflare forms: `plain_text` containing strict `true`/`false`, and `json` containing the actual Boolean `true`/`false`. JSON strings, objects, numbers, secret bindings and all other execution binding types remain rejected.
- Baseline and temporary Report-overlay configs now preserve each local Wrangler flag's Boolean-vs-string representation instead of coercing every captured flag into text.
- The failed live attempts produced zero Provider requests, zero Production mutation and no recorded deploy/send attempt evidence; no recovery/rollback was required.
- Hotfix Branch Verification and merge remain required before the next controlled live attempt.
- Customer-owned Production and PR #661 remain out of scope with zero mutation.

## Historical changelog

The complete active Changelog immediately before this 2026-08-21 Facebook observed-aggregation/live-rollout closeout is preserved verbatim at:

```text
docs/archive/CHANGELOG-before-facebook-observed-aggregation-live-rollout-2026-08-21.md
```

That archive includes every active entry from the prior Changelog and its existing pointer to the immutable pre-2026-07-25 archive. New entries continue in this active `CHANGELOG.md`.
