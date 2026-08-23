# Changelog

## 2026-08-23 — Customer multichannel Production runtime admission

- centralized the reviewed runtime ownership tuple for the existing Integration Workspace and exact
  customer-owned `chemistry_k` Production profile; foreign profile/customer/ownership remains blocked;
- routed Meta, Google Ads, WooCommerce and Chatwoot through the central connector readiness gate before
  their provider or business execution paths;
- promoted Facebook, Instagram, Meta Ads, Google Ads and Chatwoot from retained customer-source Live UAT,
  bounded execution and D1/Lark reconciliation evidence;
- kept YouTube and WooCommerce `dev_ready` until Customer Production can exercise their missing/unreadable
  encryption and Provider secrets;
- kept Production dark pending reviewed merge/deploy and one-connector-at-a-time live reconciliation.

## 2026-08-23 — TikTok customer Production UAT and readiness promotion

- completed one fresh stable TikTok Production UAT in the customer Cloudflare/D1/Lark runtime with
  2,046 records across 82 bounded source, preflight and write units;
- reconciled customer Lark with 5 Content creates, 2,041 Content updates, 2,046 Daily Snapshot creates
  and one Account update while keeping the Native TikTok source read-only;
- advanced the migrated checkpoint through 2026-08-23 with zero exact-scope alert, DLQ or active lock;
- proved same-identity replay idempotency: completion, cursor, checkpoint count and Lark totals did not change;
- set the main Queue batch size to one after live evidence showed multi-message batches can exceed the
  Workers Free CPU ceiling, without requiring a Workers Paid upgrade;
- restore all connector-UAT, schedule, report, AI and notification flags to dark after validation;
- promote only TikTok large-account readiness from `dev_ready` to `verified`; other connectors retain
  their existing fail-closed readiness and secret gates.
- admit the post-Lark watermark probe/admitted-sync path only for the exact customer Production ownership
  tuple after verification, while preserving Integration Workspace and rejecting foreign Production targets.

## 2026-08-23 — TikTok Workers Free durable continuations

- split TikTok Native source staging, business-plan scan/finalization, preflight, write, and completion into
  bounded durable Queue invocations for the customer Workers Free runtime;
- preserve exact Queue operation identity across continuations and make duplicate, stale, ahead, and Queue-send
  outcomes explicit and fail-closed;
- persist the immutable business plan and verify Classification Dictionary stability before resumed writes;
- add configurable one-page/one-business-unit invocation defaults and focused routing/idempotency regression;
- record customer Production as a cutover of customer-owned source state/credentials to customer Cloudflare/D1
  and customer Lark Base, with connector schedules and exact-group AI notification enabled only after live proof;
- no Production deploy, flag enable, Queue send, Lark/D1 business mutation, or retained-DLQ redrive occurred.

## Facebook Organic observed aggregation + live rematerialization — 2026-08-21

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
- Audit of the next boundary found the shared post-deploy Report runtime verifier had the same `plain_text`-only assumption; leaving it unchanged could have caused the next attempt to fail only after baseline deployment.
- PR #665 updates both preflight readback and shared deployment verification to accept the two reviewed Cloudflare Boolean forms: `plain_text` containing `true`/`false`, and `json` containing the actual Boolean `true`/`false`. JSON strings, objects, numbers, secret bindings and all other execution binding types remain rejected; conflicting duplicate flags also fail closed.
- Baseline and temporary Report-overlay configs preserve each local Wrangler flag's Boolean-vs-string representation instead of coercing every captured flag into text.
- Focused tests cover live readback, shared post-deploy verification, invalid JSON, unsupported binding types, duplicate conflicts and local representation preservation.
- The failed live attempts produced zero Provider requests, zero Production mutation and no recorded deploy/send attempt evidence; no recovery/rollback was required.
- PR #665 exact head `728cdfec7b0ec082db1b0d8e23c4829f37f32c26` passed Branch Verification Run `32453689935`, Job `96686791658`, `SUCCESS` every step, then merged to `main` at exact SHA `0c7a06430d7f9f87bf85bda3313e2d3b5940bb91`.

### Target-scoped Report DLQ preflight guard

- The next read-only live preflight classified all eight globally open Report DLQ rows as retained Paid Ads forensic evidence: Meta Ads 1D/3D/7D/30D plus Google Ads 1D/3D/7D/30D from the earlier missing `LARK_TABLE_MKT_REPORT_TOP_ADS` configuration incident. No row belonged to Facebook.
- The eight rows remain retained forensic evidence and were not replayed, redriven, resolved, discarded or deleted.
- Shared Report runtime safety already scoped active work, locks and critical alerts to the selected platform/account, but `open_report_dlq` was global. PR #667 corrected that single shared guard to count the selected `payload_json.platformScope` while malformed or unscoped payloads still fail closed.
- PR #667 exact head `39c01ff9ac5595029c69c55ff70b585c35425355` passed Branch Verification Run `32460430480`, Job `96706121886`, `SUCCESS` every step and merged at `d7492b0dd30f81953c21355016f26a06e3a308fc`.

### Controlled Integration live completion

- Final preflight on exact `main == origin/main == d7492b0dd30f81953c21355016f26a06e3a308fc` proved global open Report DLQ `8` while the fail-closed Facebook-scoped guard was `0`; active Facebook Report work/locks/critical alerts and pending migrations were also `0`.
- Controlled execution refreshed the existing stable Facebook Organic 1D/3D/7D/30D Report identities exactly once through the existing Queue/materializer. Queue messages `4`, Provider requests `0`, manual Lark patches `0`, customer Production mutations `0`.
- Every window completed with 25 Report metrics, D1↔Lark mismatch `0`, one Lark snapshot, 25 metric rows, five Top Content rows, zero Top Ads rows and zero duplicate metric keys.
- Every window now exposes numeric observed latest totals: Likes `18477`, Comments `84`, Shares `2574`, Engagement `21135`. Missing source members remain null and `sourceNullsFabricatedAsZero=false`; 30D period subtotals remain null under the existing authoritative-baseline contract and were not fabricated.
- Runtime preservation passed exactly: pre/post execution-flag fingerprint `1932b9064a97daa40a9c0851ca2612456c0921dbda4779bba12cb6e658147267`, `exactFlagRestoration=true`, `changedFlagCount=0`. No temporary Report overlay was required.
- Final decision: `FACEBOOK_ORGANIC_1_3_7_30_REMATERIALIZED_VERIFIED`. The workstream is complete; do not rerun the live operator. Customer-owned Production and PR #661 remained out of scope with zero mutation.
- Detailed retained closeout record: `docs/project-brain/facebook-organic-live-rematerialization-closeout-2026-08-21.md`.

## Historical changelog

The complete active Changelog immediately before this 2026-08-21 Facebook observed-aggregation/live-rollout closeout is preserved verbatim at:

```text
docs/archive/CHANGELOG-before-facebook-observed-aggregation-live-rollout-2026-08-21.md
```

That archive includes every active entry from the prior Changelog and its existing pointer to the immutable pre-2026-07-25 archive. New entries continue in this active `CHANGELOG.md`.
