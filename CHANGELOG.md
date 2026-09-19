# Changelog

## 2026-09-18 — Scheduled Organic Daily growth completeness

- bound Meta provider source work per Queue invocation with a default of one unit and an explicit maximum of 25;
  Customer Production uses five sequential units per invocation so the 1,929-item Instagram inventory can resume
  safely without increasing Queue concurrency or weakening the durable per-unit checkpoint;
- raise only the Customer Production Meta operation ceiling from 500 to 2,500 durable source units after live
  sizing proved the first complete Instagram inventory requires more than 500 units;
- make every scheduled YouTube run request a full current-video snapshot while preserving the existing bounded
  uploads pagination, D1-first persistence and continuation batches; this removes the accidental latest-100
  logical cutoff caused by a less-than-24-hour `auto` checkpoint interval;
- make scheduled Instagram page every current media item published on or after `2026-06-19` and collect its
  current/lifetime insights on the completed report date, while excluding older media and keeping account insights
  and manual/history operations on their exact reviewed date ranges;
- bind the Instagram scope to the durable operation fingerprint, preserve Facebook/TikTok behavior and the
  10,000-row Lark cache/retention contract, and never fabricate snapshots before collection began.
- pass YouTube's validated completed reporting date into the durable Content history writer, so scheduled
  Content observations and Coverage no longer fall forward to the run date while Account Daily remains correct.

## 2026-09-18 — Chatwoot historical reprojection revision

- use processing-time `fetched_at` only for retained-D1 Chatwoot Daily reprojection, so a historical window timestamp cannot make D1 skip facts written by a later scheduled sync;
- preserve the pinned 30-day window, stable keys, D1 revision guard and normal Daily timestamp behavior. Controlled PROD rerun and D1/Lark/Report readback remain pending.

## 2026-09-18 — Chatwoot 30-day Report bound

- raise only Chatwoot's default bounded D1 Report read from 10,000 to 25,000 facts after Customer PROD sizing found 12,106 Conversation Daily identities in the 30-day window;
- preserve the existing 50,000 hard maximum, explicit configuration override, and every other channel's 10,000-row default. Reviewed deploy and live Report readback are still required.

## 2026-09-18 — Chatwoot Reporting-event Daily projection repair

- rebuild First Response, Resolution, Reply and Resolved-conversation Daily values from the authoritative raw D1
  Reporting events, including unchanged older Conversations omitted by the incremental revision filter;
- write the corrected Conversation Daily stable keys before deriving Agent/Inbox/Account Daily, and carry raw
  event sums/sample counts so rollup averages remain weighted and reruns remain idempotent;
- preserve message/new/reopen values and null semantics, leave the removed Resolution Time Dashboard block
  removed, and require reviewed merge/deploy plus exact PROD D1/Lark reconciliation before live completion.
- add a bounded 30-calendar-day D1-only reprojection trigger with an isolated cursor so Production repair
  reuses retained facts, never calls the Chatwoot Provider, and does not disturb the normal Daily checkpoint.

## 2026-09-17 — Pin Meta Ads exact recovery Queue auth to Customer PROD profile

- use the exact `chemistry-k-prod` Wrangler profile for the Queue REST bearer. The default profile returned
  403 before any recovery claim or Queue send; add a focused regression guard and sanitized HTTP diagnostics.

## 2026-09-17 — Exact Meta Ads 2026-09-16 terminal recovery operator

- add a guarded, read-only-by-default, one-incident-at-a-time operator for the observed scheduled K2/K3
  Graph 2/1504044 terminal Work; the original Queue payload/generation and durable checkpoint are preserved;
- fail closed on changed DLQ/Work/fence, other active channel, newer operation, lock or uncertain Queue send.
  No generic redrive, customer-group failure notification, Business deletion, or unrelated terminal access.

## 2026-09-17 — Deferred Customer Meta Ads retry

- classify only the observed scheduled Meta Ads Graph `2/1504044` response as retryable, preserving
  permanent classification for adjacent and Organic errors;
- add a default-off Customer Production gate that delays retry until after the daily source window and
  while another same-day channel Work is active, using the original Queue identity and checkpoint;
- leave customer-group failure messages, generic DLQ redrive, broad auto-recovery, and Business data
  unchanged. Production activation and exact K2/K3 incident recovery require reviewed live gates.

## 2026-09-17 — YouTube Account Daily fallback wiring

- fix the scheduled YouTube `organic_sync` fallback route to pass its already validated complete Lark table
  set, including `MKT_Account_Daily`, into the D1-first use case. A post-deploy read-only check identified
  the missing argument before any source read; no source data or other connector route is changed;
- add a focused regression check for the fallback destination-table handoff.
- add a guarded one-incident recovery operator for the failed `youtube-scheduled-20260917` generation. It is
  plan-only by default and permits one exact Queue send only after reviewed-version, DLQ, lock, operation,
  source-failure and missing-target-fact fences pass; generic redrive and other incidents remain untouched.
- PR `#852` passed both Branch Verification jobs and merged as `main@2bde0650`. One exact Queue send recovered
  the original Work, which completed and wrote the `2026-09-16` YouTube Account Daily fact to Customer D1.
  Controlled Lark reconciliation created its missing row, updated one TikTok current-state row and read back
  36/36 exact Account Daily projections; rerun planned zero creates/updates and zero duplicate input keys.
- add a YouTube Account Daily post-write stable-key readback guard for both bounded and unbounded destination
  paths. A Lark acknowledgement without a matching row can no longer complete the Work or advance account
  freshness; a focused regression covers the false-acknowledgement case.

## 2026-09-16 — Organic Account Daily for YouTube and TikTok

- project exact Customer YouTube D1 account facts and TikTok current-state portfolio metrics to the existing
  `MKT_Account_Daily` table, preserving Facebook/Instagram and unsupported metrics as null;
- add normal D1-first daily writes plus an exact Customer Preview-only backfill with D1/Lark readback and
  stable-key idempotency. TikTok snapshot date comes from the source observation, not YouTube's latest day;
- exclude the retained foreign/dev YouTube channel by exact identity. Production execution and live reconciliation
  passed after PR `#849` merged as `main@5225e535`: Lark created/read back 35/35 Customer rows; D1 TikTok
  fact readback 1/1; separate rerun was create 0/update 0/skip 35 with zero duplicates. Worker version
  `c98e61e1-83a0-4b2c-b0c3-c901bf83dadc` serves 100% with unchanged bindings and Preview URLs disabled.

## 2026-09-14 — Customer Organic exact history repair

- added a create-only, 50-row bounded Customer PROD repair for exact Facebook daily Insights from
  `2026-06-19..2026-06-29` and YouTube cumulative video views from `2026-06-19..2026-07-27`;
- writes Facebook to D1 and the bounded `MKT_Content_Daily` cache, while retaining the roughly 32,500-row YouTube
  interval in durable D1 only so the customer Lark table cannot be overfilled;
- rejects Instagram/TikTok historical mutation because their current sources do not expose exact historical
  snapshots, preserves missing metrics as null and fences every write on zero active Production locks;
- added isolated Preview-only execution, exact Customer authority/confirmation, stable-key reconciliation,
  D1/Lark readback and completed-batch no-op reruns without changing Production Worker traffic or schedules.
- merged the complete repair chain through `main@19871a82` and finished controlled Customer PROD execution:
  Facebook is exact at 321 D1/Lark rows across 11 dates, and YouTube is exact at 32,164 durable D1 rows across
  all 39 dates with 655 completed coverage batches;
- final reconciliation has zero failed rows, duplicate Stable keys or active locks. Preview URLs are disabled and
  Production continues serving version `54b80d1b-80f8-45dd-907f-7d9bcd0877db` at 100%.

## 2026-09-14 — Customer Weekly AI bounded recommendation repair

- added an isolated read-only Customer Weekly diagnostic that returns only retained identity hashes, output
  presence and quality violation codes, with no generated prose or remote writes;
- deterministically removes unsupported `[NO-SCALE]` wording and completes missing action detail only for the two
  proven recommendation failures, while preserving the immutable generated AI row and rerunning the unchanged
  full quality gate before Notification admission;
- keeps all unrelated AI quality failures fail-closed and preserves the existing exactly-once Queue, delivery and
  Lark mirror contracts.
- deployed reviewed `main@6b6ef743` to Customer Production version
  `54b80d1b-80f8-45dd-907f-7d9bcd0877db` and recovered the exact retained Weekly generation once; final
  readback proves one sent and mirrored Group delivery with claim count one, zero lock, redriven DLQ, resolved
  Alert, and no duplicate.

## 2026-09-13 — TikTok Organic partial-period Dashboard values

- changed only the TikTok Organic Report path to aggregate the observed period subtotal when source coverage is
  complete but a small number of retained contents still lack a valid pre-period baseline;
- marks those numeric Period metrics as `coverage_incomplete`, keeps comparison/change values null, and preserves
  the existing strict null behavior for Facebook, Instagram and YouTube;
- extended the controlled Weekly AI evidence gate to admit high-coverage TikTok subtotals while explicitly keeping
  comparison unavailable, so the customer report can use measured values without presenting them as complete.
- updated the reviewed Report-window reconciliation gate to accept this exception only when all six Period metrics,
  the minimum 99% coverage threshold and the tracked/covered/missing counters reconcile exactly.
- PR #832 passed both Branch Verification workflows and merged as
  `main@c82522be7840b7bc00df289b98e8cbb962a378a2`; Customer Worker version
  `85f50869-3a7c-4d89-ab75-4e9994c7a8bd` is active at 100% with Queue safety and schedules unchanged.
- provisioned only the missing `coverage_incomplete` option in the Customer Report metric table through an isolated
  Preview version, restored Preview URLs disabled, and completed exact serial 1D/3D/7D/30D materializations.
- D1/Lark readback agrees for all 24 selected Period metrics, with 17 rows per report and zero duplicate selected
  keys. Final target locks and new open Report DLQs are zero; the protected forensic incident was not touched.

## 2026-09-13 — Customer manual final wording review

- refined only the customer-facing Thai wording in the Markdown and Word manuals so descriptions read naturally,
  while preserving the document structure, Dashboard blocks, table names, technical meaning and system conditions.

## 2026-09-13 — Customer manual Dashboard block reference and Word delivery

- expanded the Thai customer manual with every active Dashboard block, the value shown by each block, its display
  form and the relevant completeness/`N/A` behavior;
- added the formatted Word delivery `docs/คู่มือ-Social-MKT-Data-Hub.docx`, kept the customer-facing title as
  `คู่มือ Social MKT Data Hub`, and retained the concise Lark Base and Cloudflare D1 table reference.

## 2026-09-12 — Customer Social MKT Data Hub manual

- added a concise Thai customer manual for all active Production Lark tables, six Dashboards, date semantics,
  retention behavior, and the functional D1 table groups without exposing credentials or internal customer IDs.

## 2026-09-12 — Scheduled YouTube completed-day validation

- fixed the scheduled YouTube application boundary to validate the scheduler's latest fully completed Bangkok
  reporting day instead of incorrectly requiring the current execution date;
- retained same-day validation for manual/operator calls unless they explicitly opt into completed-day semantics,
  and preserved the scheduled Work generation, actual fetch timestamp, stable keys and destination ordering;
- added regression coverage for both accepted previous-day and rejected current-day scheduled payloads. The exact
  failed Customer PROD `youtube-scheduled-20260912` generation requires one guarded same-generation recovery only
  after reviewed merge/deploy and read-only lock/DLQ admission.
- PR `#827` passed both Branch Verification workflows and merged as
  `main@e354cf033495837cd4b1fd9709bc7bf1786d0839`; Customer Worker version
  `c8045a16-234f-4746-a10f-53f5ecb6a682` is active at 100% with the original triggers and Queue safety settings.
- completed the retained generation once with `848/848` source/D1/Lark identities, zero duplicate input rows and
  one Account update. The Account sync timestamp is `2026-09-12` while the completed reporting date is
  `2026-09-11`; the exact DLQ/Alert are closed and no protected or historical Business data was changed.

## 2026-09-11 — Organic reporting-date and freshness semantics

- aligned scheduled YouTube `MKT_Content_Daily.metric_date` with the latest completed Bangkok reporting day,
  matching the other Organic channels while preserving the current operation/fetch timestamp;
- changed TikTok `MKT_Accounts.last_sync_at` to the stable successful Work time written after Content/Daily;
- added an exact, isolated Customer PROD repair for the 50-row YouTube 2026-09-11 misdated set and the single
  TikTok account freshness field, with D1/Lark authority gates, readback and idempotent rerun.
- normalized the repair's live Lark rich-text key/identity readback through the shared cell parser so exact
  duplicate detection compares canonical values instead of array object strings.
- completed the exact Customer PROD repair with `50/50` YouTube identities reconciled to `2026-09-10`, TikTok
  freshness advanced to the successful post-Lark completion, zero D1 observation deletes, and a zero-change rerun.

## 2026-09-11 — Campaign Summary color month groups

- changed the Paid-only `period_month_th` presentation from Text to Single Select labels containing only Thai month
  and Buddhist year, with a value-preserving full-row migration and exact readback before and after conversion;
- kept the month as the descending group field in Overview/Meta/Google/TikTok while hiding its repeated column;
- made normal Paid daily maintenance append only a missing current-month option before stable-key MTD upsert, without
  rereading history, changing schedules, mutating D1, or touching Organic/unrelated tables.
- completed Customer PROD conversion on the same field ID with `185/185` rows preserved, current/history D1 parity,
  zero duplicate keys, zero Daily deletes/D1 mutations, and active Worker version
  `13f4ebb7-34ac-45f5-9f9f-d20caa7d8547` from reviewed `main@475f8b30`.

## 2026-09-10 — Campaign Summary Thai monthly history

- extended the same Paid-only Campaign Summary table with a sortable Thai Buddhist-year month label and Thai
  managed-field descriptions, while retaining `campaign_summary_key` as the Primary stable key;
- added a controlled D1-derived monthly backfill from `2026-06-19` and kept normal daily runtime bounded to the
  current month only;
- defined the customer presentation contract for all four Views: group newest month first and show campaign/
  metric fields before technical fields, without touching Organic data or immutable D1 facts.
- added guarded Base v3 View-property read/apply/readback for monthly Group, Sort state, and readable visible-field
  order across the four exact Summary Views; unchanged properties are not rewritten.
- follow the Customer Lark canonical grouped-Grid response by leaving independent Sort empty; descending Thai
  month Group remains the sole newest-first ordering source and avoids a repeated no-op Sort write.
- completed live Customer PROD View readback across Overview/Meta/Google/TikTok, proving the exact Thai month
  Group and 22-field order; the final history rerun remained zero-change at 185 rows and Production Worker
  version `8dc08bc8-fbe0-4ea7-aee7-e944d3f0233c` is active from `main@d62eb477`.

## 2026-09-10 — Paid Ads Campaign Summary and bounded Daily retention

- added the exact 21-field `MKT_Ads_Campaign_Summary` schema with `campaign_summary_key` as primary key and four
  canonical Overview/Meta/Google/TikTok Views;
- materialize current-month campaign metrics from PROD D1 into Lark using stable-key upsert, exact readback
  reconciliation, and a zero-change idempotency rerun;
- bounded `MKT_Ads_Daily` Lark retention to 90 days, soft limit 17,000, target 15,000 and at most 500 oldest-first
  deletes per run, with exact Customer PROD D1 identity proof for every deletable record;
- added a single fail-closed operator that provisions schema/Views, materializes MTD, applies retention and verifies
  live state without mutating D1, Organic tables, unrelated Ads tables or Production traffic during Preview.
- pinned the operator's Wrangler auth/upload/status boundary to profile `chemistry-k-prod` after the default OAuth
  identity was correctly rejected before the first Preview version upload.
- added a bounded, GET-only Preview-route readiness probe for fresh alias propagation; schema/materialization/
  retention execution remains a single non-retried POST.
- exposed redacted operational status/Lark codes from the isolated operator so live schema failures remain
  diagnosable without logging credentials, record values, or customer identities.
- corrected the Ads Daily retention DateTime filter to Lark's required `ExactDate` wire shape after live code
  `1254018 InvalidFilter`, without changing retention eligibility or delete bounds.
- completed the controlled Customer PROD operator and exact D1/Lark readback: 45 current-MTD campaign summaries,
  zero duplicate stable keys, a zero-change rerun, and no Daily deletion because the live 5,209-row table is below
  the 17,000-row soft limit;
- enabled the reviewed Paid-only runtime on Customer Worker version
  `2f3322d2-fb44-411d-8bc1-6857f7d4e40b`, preserving Queue batch/concurrency `1/1`, disabled generic recovery,
  all Organic data, unrelated tables, and immutable D1 source facts.

## 2026-09-08 — WooCommerce Production readiness promotion

- promoted WooCommerce from `dev_ready` to `verified` using the retained 2026-08-31 Customer Production
  source/D1/Lark and idempotent incremental reconciliation evidence;
- restored normal `04:30` Production incremental admission through the existing central readiness gate;
- added a scheduler regression that proves the exact WooCommerce job and Reliability wake-up are enqueued,
  without enabling full reconciliation or changing historical Business data.

## 2026-09-08 — Customer Weekly AI neutral-context quality repair

- retained the evidence-backed positive channel/metric requirements for Weekly Executive strengths;
- stopped treating a neutral metric mentioned only as context as an independent quality failure;
- bound automatic Weekly source collection to the job's exact period end so reviewed retrospective recovery does
  not drift to a newer materialized week;
- derive and query explicit Weekly `report_id` stable keys for fresh exact-period reads, avoiding unsupported
  Lark DateTime filters;
- resume a retained Weekly operation from its already-generated, hash-bound AI row and eight checksum-validated
  D1 Report materializations when the Lark current-slot snapshots have advanced; the rebuilt prompt evidence must
  match the generated row exactly before admission, without regenerating AI or creating a replacement operation;
- closed the missed 2026-09-06 Customer Weekly delivery in Production with one sent and mirrored notification,
  claim count one, resolved Alert and retained DLQ marked redriven;
- preserved all other cross-channel, candidate, decision-action and exactly-once Notification gates.

## 2026-09-07 — Chatwoot bounded hydration concurrency

- kept Queue batch/concurrency at one while allowing at most two Conversation message/event hydrations inside
  the same bounded delivery;
- made the speed control execution-only and default-safe at one, preserving the active Work fingerprint,
  deterministic output order, retryable deferral, stable-key upserts and all historical Business data.

## 2026-09-05 — Bounded Chatwoot and Meta Ads Daily source

- corrected Chatwoot's D1 revision lookup contract so the three-day Daily overlap hydrates only missing or
  strictly newer Conversations instead of treating every candidate as changed;
- versioned the persisted revision-filter marker so an in-flight generation filtered by the defective contract
  refreshes and prunes its retained identities exactly once without replaying the generation;
- made new scheduled Meta Ads generations read Daily Insights first and fetch Creative metadata only for unique
  active Ads, avoiding a full historical Creative inventory scan on every daily run;
- preserved all existing Business history, legacy/in-flight generation fingerprints, stable keys and bounded
  D1/Lark checkpoint semantics.

## 2026-08-31 — Chatwoot revision-aware Daily continuation

- skip Chatwoot Daily candidates whose provider revision is already present in D1, while retaining missing and
  strictly newer identities for the existing idempotent D1/Lark write path;
- let an in-flight Daily generation refresh and prune its persisted pending identities without changing its
  generation, checkpoint or historical Business data;
- hydrate retained Conversations serially inside each bounded execution envelope after live Customer evidence
  showed the provider's message/reporting endpoints become unstable under parallel reads; deterministic ordering
  and existing provider/reporting limits remain unchanged.

## 2026-08-28 — Meta K2 bounded post-source materialization

- split the 194-unit retained K2 snapshot into a durable Workers Free-safe compaction phase instead of loading
  and assembling about 13.96 MB in one post-source Queue delivery;
- preserve the same Work, generation, stable identities and exact Daily source payload hashes while persisting
  only canonical Ads-builder fields in batches of five source units;
- precompute normalized entity metadata hashes inside the same bounded phase so 19,200 Creative fingerprints are
  not recalculated on every preflight/D1/Lark continuation;
- continue from the compact snapshot into the existing bounded preflight, D1 and Lark phases without another
  Meta provider read or a replacement generation.

## 2026-08-28 — Customer TikTok exact newer-only fast bridge

- imported only the sealed Dev Lark TikTok `2026-08-27` delta into Customer D1 and Lark: `2,053` Daily rows,
  two missing Content identities and one Account freshness row, with no older/equal overwrite;
- proved complete `2,053/2,053` Coverage, `44/44` first-attempt Lark Queue deliveries and zero exact retry,
  DLQ or Alert;
- regenerated Customer-owned `1D/3D/7D/30D` Reports and matched their latest totals exactly to the sealed Dev
  Lark source, then disabled the temporary import gate;
- made the bridge operator tolerate Wrangler progress text before valid JSON so a successful large D1 apply is
  not reported as a parser failure.

## 2026-08-28 — Chatwoot Daily updated-only discovery

- changed only new Chatwoot Daily generations to snapshot the immutable three-day `updated_within` result once,
  then hydrate the stored conversation identities through existing bounded durable continuations;
- retained full stable two-pass discovery for Initial reconciliation and retained every explicit strategy and
  checkpoint already persisted by legacy Work;
- preserved requested-at filtering, stable-key idempotency, D1-first writes and bounded reporting execution while
  removing the repeated full-account Daily scan that was unsuitable for Customer Workers Free.

## 2026-08-27 — Customer staggered schedules and newer-only parity guard

- staggered the serial Customer source windows from `00:30` through `07:30` Asia/Bangkok, keeping each
  Cloudflare-produced connector at least one hour apart and leaving Google Ads on its external Manager Script
  boundary;
- moved Daily/Weekly Report to `09:00`/Monday `09:15` and the exactly-once weekly notification to `09:30`, after
  every source window;
- defined Dev-to-Customer repair as insert-only for Production-missing stable keys with strictly newer business
  dates; older/equal Customer rows and all operational state remain immutable;
- require fresh Customer D1/Lark materialization and exact `1D/3D/7D/30D` metric parity before completion.
- add a fail-closed Dev Lark to Customer D1 bridge for the exact reviewed Facebook/TikTok delta. The operator
  seals Customer date boundaries and SQL digests, permits only append-only Organic/Account/Coverage statements,
  and aborts if a Customer schedule advances before apply;
- prove the prepared delta contains only Facebook `2026-08-26` and TikTok `2026-08-24` through `2026-08-26`,
  with no Ads, Instagram, YouTube, Chatwoot, older/equal row, operational-state mutation or copied Report row.

## 2026-08-26 — Customer Workers Free bounded post-source continuation

- split YouTube D1 storage and Lark Content/Daily/Account writes into durable post-source phases, keeping Account
  freshness last and preserving the complete canonical D1-first snapshot;
- split Meta complete-payload preflight and Lark writes by durable table/row offsets while retaining full-scope
  stable-key validation and compatibility with already completed preflight state;
- added Customer-tunable 100-row execution envelopes for YouTube destination and Meta preflight/D1/Lark work,
  without changing the retained operation fingerprint or creating replacement generations;
- added focused large-payload continuation regression and passed all repository, Workers runtime, Report
  reliability, audit and deploy dry-run gates.
- checkpoint YouTube organic-history D1 storage at 100 content rows per delivery after Live Free CPU evidence
  proved the 838-row sequential writer was still an unbounded phase; Coverage completes only after all batches.
- separate the YouTube D1 execution budget from the Lark destination budget after Live continuation proved the
  100-row D1 batch could persist progress but still exceed Customer Workers Free CPU; Customer can run D1 at five
  rows while retaining 100-row Lark delivery without changing the durable Work fingerprint.
- resume incomplete YouTube D1 storage from an indexed, stable sorted Video range instead of rehydrating and
  normalizing all 838 staged resources on every five-row continuation; reuse the existing Coverage watermark and
  retain the same storage offset/generation.
- resume an incomplete YouTube Owner Analytics phase before hydrating Video resources, and place an explicit
  continuation boundary after its final checkpoint so Free-plan retries do not rebuild 838 resources for each
  50-video Analytics chunk or repeat provider calls.
- allocate YouTube destination unit sequences from durable `chunksProcessed` rather than the current batch-size
  arithmetic, preserving unique resumable units when a Free-plan execution limit changes mid-phase.
- resume an existing bounded YouTube Content/Daily destination from only the exact staged Video range needed for
  the next batch, avoiding full 838-resource hydration and normalization on every Lark continuation.

## 2026-08-26 — Chatwoot fingerprint-stable Free execution cap

- added deploy-only Chatwoot conversation/reporting caps that can shrink a Queue delivery without
  changing the existing durable operation fingerprint;
- kept expansion impossible and preserved the same generation, phase checkpoint and stable keys.

## 2026-08-26 — Customer Meta Ads Daily Select projection repair

- proved the K2 permanent failure was nine auxiliary placement values rejected by the Customer
  `MKT_Ads_Daily.ad_channel` Select, not a token, permission or provider problem;
- retained all detailed Meta placement channels in D1 while limiting the canonical Lark projection to the
  reviewed `facebook_ads` and `instagram_ads` options;
- consolidated scheduled, exact-snapshot and provider-direct Lark paths onto one projection contract without
  changing source normalization, D1 facts or stable identities;
- added focused regression and passed the complete repository, Workers runtime, Report reliability, audit and
  deploy dry-run gates before Customer release.
- classify the exact Meta Ads Business Use Case throttle pair `80004/2446079` as transient even when returned as
  HTTP 400 without `is_transient`, reusing durable page checkpoints and bounded retries while near-matches remain
  permanent.

## 2026-08-25 — Customer Production bounded Queue auto-recovery

- added disabled-by-default, exact Customer Production self-healing for retry-exhausted stable connector Work;
- retained the original operation, generation, payload and checkpoint with lock-aware cooldown and a five-incident
  per-Work recovery budget;
- kept permanent/completed/superseded Work and the protected TikTok forensic terminal non-recoverable, while
  leaving generic DLQ redrive disabled;
- close only the exact DLQ/Alert after durable Work completion, preserving stable idempotency across send/marker
  crash retries.
- deployed PR #745 to Customer Production and proved non-synthetic same-checkpoint recovery for Chatwoot, Meta Ads
  and TikTok, while YouTube advanced to complete its 837-row Owner Analytics phase;
- reduced only the Customer Meta D1 batch from 10 to 5 after Live Workers Free evidence; generic redrive remains
  disabled and the protected TikTok forensic terminal remains excluded.
- recorded the external Workers Free Queue daily-write ceiling at operation 10,253 and retained exact checkpoints
  for post-reset continuation; permanent Meta K2 Lark preflight remains fail-closed rather than blindly retried.

## 2026-08-25 — Customer Workers Free durable runtime recovery

- gave daily YouTube scheduled work a stable operation identity and split playlist, video-resource and Owner
  Analytics source reads into one durably checkpointed unit per Queue delivery;
- changed Chatwoot Daily conversation discovery to the existing page-bounded stable two-pass strategy, including
  safe in-memory upgrade of the deployed zero-progress Daily state;
- separated Meta's whole-operation large-account page ceiling from its existing one-page Queue invocation budget;
- retained reference-only Queue continuations, Stable-key idempotency, Customer D1-first writes and the protected
  TikTok forensic terminal boundary.

## 2026-08-25 — Customer YouTube daily-only schedule and TikTok Free-plan probe repair

- reduced the dedicated YouTube trigger from four six-hourly runs to one daily run at `07:50` Asia/Bangkok;
- made the scheduler reject the retired six-hour Cron so an overlapping stale trigger cannot enqueue duplicate
  YouTube work;
- separated the Customer TikTok two-pass watermark probe (`500` rows/page) from durable business processing
  (`25` rows/unit), keeping both external-subrequest count and per-invocation CPU inside independent Free-plan
  budgets instead of forcing one page size to serve incompatible phases.

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
- deployed the correction to Customer Production, repaired the exact affected Instagram coverage row and
  rematerialized 1D/3D/7D/30D in four first-attempt Queue operations with no Alert/DLQ/active-lock delta.

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
