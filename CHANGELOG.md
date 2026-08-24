# Changelog

## 2026-08-24 — Customer Organic Dashboard copied-Base compatibility replay

- extended the reviewed Dashboard compatibility projection to Customer Production so copied Dashboard blocks
  receive both the preserved Display V2 label and legacy Period selector alongside canonical metric dimensions;
- replayed the exact 16 D1-backed Organic materializations for Facebook, Instagram, TikTok and YouTube at
  1D/3D/7D/30D without changing source facts or Dashboard configuration;
- completed 16/16 operations with no new alert, DLQ or lock delta; follow-up export comparison then proved the
  copied Dashboard still needs exact `customer_profile=chemistry_k` isolation because both retained Integration
  rows and Customer rows now satisfy its legacy display selectors.
- corrected bounded Meta Organic coverage semantics from `full_inventory` to `report_range`, preventing an empty
  daily Instagram content result from authoritatively excluding prior observed content across rolling windows.

## 2026-08-24 — Customer Social MKT Data Hub Production COMPLETE

- completed and idempotently replayed Customer Chatwoot `3,707` rows and WooCommerce `18,911` rows in canonical
  Lark tables while preserving Customer-only commerce history;
- activated and proved 32 Report materializations across eight active platforms and four preset windows;
- added portable Customer workflow identity hashes and explicit Lark client wiring for reviewed destination lookup;
- completed Customer Weekly Native AI, sent exactly one group message, mirrored Notification Log/AI Run state,
  proved claim count one and zero duplicate send, then resolved only the exact cutover incidents.

## 2026-08-24 — Customer Chatwoot/WooCommerce exact D1-to-Lark closeout path

- added a disabled-by-default, Customer-Production-only Queue importer that reads only ten reviewed Chatwoot and
  WooCommerce D1 tables in 50-row batches and writes their existing canonical Customer Lark tables;
- bound every job to an exact table/snapshot manifest and stable Queue identity, with manifest drift and partial
  reconciliation failing closed before completion;
- kept Business rows out of Queue payloads and retained the existing Workers Free batch-size-one consumer topology.

## 2026-08-24 — Customer Workers Free runtime and Meta creative Select repair

- removed the canceled Customer Lark visible-field ordering runtime so source continuations retain the proven
  pre-field-order Workers Free CPU profile;
- normalized Meta creative provider types to the exact Customer Base Select contract: `image`, `video`,
  `carousel`, or `other`;
- added focused regression coverage for all K3-observed values, including unknown and missing types.
- schedule the TikTok two-pass RAW watermark probe once daily at configurable local time (default 06:55) instead
  of every five-minute primary Cron tick.

## 2026-08-24 — Customer Lark Base empty-field View hygiene

- added a disabled-by-default, exact Customer Production Queue job that hides only Live-proven empty fields in
  reviewed Data Hub Grid views;
- bound each allowed table/view/field set to a SHA-256 scope, protected the primary field, preserved existing
  hidden fields, and verified every View by readback;
- kept customer-created Base areas, records, schema, filters and View names outside the mutation contract.
- added the Live-proven Record Search contract for valueless operators (`value: []`) while preserving the separate
  View-filter PATCH rule that omits `value`; regression coverage prevents the two request schemas from drifting.
- completed the corrected one-time Customer run across 19 reviewed tables / 81 Grid views, resolved only its 19
  pre-hotfix DLQ/alert pairs, and restored the production feature flag to false with zero new hygiene incidents.

## 2026-08-24 — Customer Weekly Notification Settings activation boundary

- added an exact customer-Production-only Queue path that enables AI/Notification on the eight active 7D Report
  Settings after Weekly Report and Notification runtime authority is active;
- preserved stable keys, excluded TikTok Ads and all non-7D/Integration settings, and kept raw Lark group identity
  out of Queue payloads, logs and committed configuration;
- kept live Settings mutation and message delivery closed until source completion and reviewed deployment.

## 2026-08-24 — Customer Report/AI/Notification runtime authority

- removed historical Integration-only profile assumptions from the automatic Weekly AI source, seed and
  snapshotless notification delivery path;
- required Customer Production to supply an exact destination chat-name and SHA-256 identity while retaining the
  reviewed Integration Workspace defaults;
- kept Report, AI and Notification gates fail-closed pending live Customer source/report/group validation.

## 2026-08-23 — YouTube Customer Production UAT and readiness promotion

- migrated the exact Chemistry K YouTube operational cursor and 837 source-record fingerprints from the
  Integration D1 into the customer-owned D1 after proving the business/history tables were already present;
- superseded the retained full-inventory recovery after the Customer Workers Free CPU ceiling was confirmed,
  preserving its complete 17/17 source phases and closing only its exact stale runs, lock, DLQ and alert;
- completed one fresh customer Production incremental UAT without a Workers Paid upgrade: 100 recent videos,
  837/837 Owner Analytics scope, 17/17 Analytics chunks, 64 Content updates, 100 Content Daily creates and
  one Account update in the customer Lark Base;
- verified durable completion, checkpoint advancement, zero exact-scope lock/DLQ/alert and promoted YouTube
  large-account readiness from `dev_ready` to `verified`; schedule activation remains a separate deployment.

## 2026-08-23 — YouTube Production-UAT stable recovery delivery

- made controlled YouTube Production UAT use a stable reviewed Queue operation identity so a new Cloudflare
  delivery can resume the exact prior D1 page/chunk checkpoint after a retry, CPU termination or DLQ handoff;
- kept scheduled and ordinary YouTube work scoped to their existing message identity and kept normal
  Production readiness fail-closed;
- added focused drift, recovery-delivery and legacy-behavior regression coverage; no schedule activation or
  readiness promotion is implied by this code change.

## 2026-08-23 — YouTube customer credential no-reconnect cutover path

- added an exact reviewed Customer Production credential runtime while preserving the Integration Workspace
  tuple and rejecting aliases, mixed environments/profiles and foreign ownership;
- added bounded previous encryption-key reads and current-key writes so the existing validated YouTube Refresh
  Token can be rewrapped to a Customer-owned key without another customer OAuth login;
- added a disabled-by-default, dedicated-token-authenticated, Integration-only rewrap route that keeps plaintext
  in Worker memory, returns only credential references/key-version metadata and does not rotate the general
  Connection operator token;
- preserved the unrelated legacy `YOUTUBE_OAUTH_*` path as ineligible for Analytics runtime and kept all
  schedules/Report/AI/Notification flags unchanged pending reviewed merge and Live validation.

## 2026-08-23 — Customer Production first source schedules activated

- deployed reviewed main `400a17795f3a2fee0175504c20f3758f377675f8` to the customer Worker as version
  `d93072cb-a179-4158-944c-0eb08cf0e759`, authored by `dev.datahub.2026@gmail.com` and receiving 100% traffic;
- activated the shared five-minute primary Cron and only the Instagram, Meta Ads and Chatwoot source/D1/Lark
  schedule paths, while preserving `workers_dev=false` and the Workers Free Queue batch size of one;
- retained TikTok, Facebook, Google Ads, YouTube, WooCommerce, Report, AI, Notification, retention, webhook
  and DLQ-redrive paths as disabled pending their exact time/secret/live-proof gates;
- recorded pre-run Customer D1 counts/checkpoints and zero active locks for Monday one-connector-at-a-time
  reconciliation; retained TikTok forensic alert/DLQ evidence was not mutated;
- created the thread heartbeat `customer-production-cutover-monitor` to resume the reviewed cutover at 06:50
  `Asia/Bangkok`; automatic source and Lark group exactly-once results remain explicitly pending.

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
