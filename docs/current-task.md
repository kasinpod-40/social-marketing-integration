# Current Task — Google Ads End-to-End Lark Ready Before Customer OAuth

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_IMPLEMENTATION
CURRENT_PROGRAM                     = GOOGLE_ADS_CUSTOMER_VISIBLE_DELIVERY
SOURCE_BASELINE                     = PR_56_MERGED_3488C2A6
WORK_BRANCH                         = work/google-ads-end-to-end-lark-ready-before-oauth
EXTERNAL_SIGNED_PREVIEW             = PASS_PREVIEW_VALIDATED
SIGNING_SECRET                      = PROVISIONED_CONFIRMED
CUSTOMER_OAUTH                      = WAITING_CUSTOMER_CLICK
CUSTOMER_CREDENTIAL_RUNTIME_BRIDGE  = TO_IMPLEMENT
REFERENCE_ONLY_QUEUE_ADMISSION      = TO_IMPLEMENT
QUEUE_CONSUMER                      = TO_IMPLEMENT
D1_ADS_BUSINESS_WRITES              = TO_IMPLEMENT
LARK_RAW_WRITES                     = TO_IMPLEMENT
LARK_CANONICAL_WRITES               = TO_IMPLEMENT
MANUAL_LIVE_OPERATOR                = TO_IMPLEMENT
REMOTE_ROLLOUT                      = NOT_AUTHORIZED_BY_THIS_TASK
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
META_AND_YOUTUBE_TASKS              = PAUSED_NOT_DISCARDED
```

The completed External Signed PREVIEW closeout is preserved at:

```text
docs/archive/current-task-google-ads-external-signed-preview-closeout-merged-2026-07-26.md
```

## Product decision

Finish the complete Google Ads implementation now so the repository and safely
closed Integration Workspace can be prepared before the customer authorizes the
Google Ads connection.

After this implementation and its separately reviewed flags-false rollout are
complete, customer authorization must not trigger another coding phase. The only
remaining steps should be external/runtime gates:

```text
customer clicks Google OAuth confirmation
→ encrypted Refresh Token is stored
→ exact advertiser identity and provider access are validated
→ one protected manual sync is triggered
→ D1 / Shared RAW / Canonical Lark reconciliation is verified
→ exact rerun proves zero duplicate/business drift
```

Provider-side access rejection, insufficient scope, wrong Google account or pending
Google Ads Developer Token access remain real external blockers. They must be
reported as such, not hidden as implementation success.

## Source and authorization architecture

Do not create a competing direct-fetch pipeline that discards the completed Manager
Script signed-delivery work.

Use these responsibilities:

```text
Customer Google OAuth connection
  = customer-owned authorization, encrypted credential lifecycle and exact identity gate

Google Ads Manager Script signed delivery
  = bounded six-dataset source transport

API Worker + Queue + Sync Worker
  = authenticated admission, durable processing, D1-first writes and Lark delivery
```

The customer OAuth gate and the signed source identity must both resolve to the same
approved advertiser. A mismatch fails closed before Queue admission or business write.
No Refresh Token, Access Token, Signing Secret, Nonce, signature or raw credential may
enter Queue, D1 business rows, Lark, logs, alerts or Git.

## Existing verified foundation

- Manager `9463570541` and advertiser `5662332033` were selectable in the actual
  Manager Script path.
- The actual signed PREVIEW completed `6/6` datasets, `7/7` chunks and `1375/1375`
  rows.
- The transport reached `preview_validated`, redacted every PREVIEW payload and
  produced zero Business/Queue/Lark drift.
- Migration `0013` provides nonce/run/chunk transport state.
- Migration `0014` and one-time provisioning established the Signing Secret without
  storing it in Git.
- Customer Google OAuth flow, encrypted credential persistence and exact target
  validation foundation already exist.
- Existing Ads D1 grains and Shared RAW/Canonical Lark tables are the only approved
  business destinations.

## Completion boundary before customer click

Implementation is ready-before-OAuth only when all of the following exist and pass
locally, with repository/runtime defaults still false:

1. encrypted Customer Connection credential bridge usable by the manual Google Ads
   workflow without copying a Refresh Token into ordinary environment config;
2. exact authorization gate for customer key, manager, advertiser, currency and
   timezone;
3. signed `LIVE` run assembly and cross-chunk validation;
4. durable reference-only Queue admission;
5. stable Queue operation identity and duplicate-safe consumer processing;
6. D1-first normalization and writes for Ads entities, daily facts, conversion facts
   and Coverage;
7. Shared RAW and Canonical Lark plans/writers;
8. checkpoint, retry, partial failure, DLQ, alert and redrive semantics;
9. exact reconciliation and idempotent replay tests;
10. protected manual operator and flags-false rollout/runbook;
11. all migrations and Worker code deployable safely with every Google Ads execution
    gate disabled until the customer connection becomes validated.

## Queue reference contract

Queue body contains only a stable Run reference:

```json
{
  "schemaVersion": 1,
  "type": "google.ads.manager.signed-delivery.process",
  "operationId": "<runId>",
  "workKey": "google_ads:<runId>",
  "generation": 0,
  "originalRequestedAt": 0,
  "requestedAt": "<RFC3339>"
}
```

Rules:

- `operationId` equals the signed Run ID.
- `workKey` equals `google_ads:<runId>`.
- `generation` and `originalRequestedAt` equal `Date.parse(runStartedAt)`.
- no source row, customer/manager ID, campaign/ad ID, credential, key ID, signature,
  nonce or Secret enters the Queue body;
- an ambiguous Queue send may produce an exact duplicate reference; consumer dedupe
  must use the stable operation identity rather than Cloudflare message ID.

## D1 and Lark destination scope

### D1 authority

```text
ads_entity_state
ads_daily_facts
ads_conversion_daily_facts
data_coverage_runs
data_coverage_entities
sync_cursors
sync_work_runs / sync_work_phases / sync_work_units
sync_runs / sync_locks / dead_letter_jobs / system_alerts
```

### Shared RAW Lark

```text
RAW_Ads_Entities
RAW_Ads_Daily
```

### Canonical Lark

```text
MKT_Ads_Accounts
MKT_Ads_Campaigns
MKT_Ads_AdGroups
MKT_Ads_Ads
MKT_Ads_Creatives
MKT_Ads_Daily
```

Reuse the approved Google Ads Blueprint fields, ownership masks, formulas, relations
and Views. Do not reopen Schema/View/Formula Apply and do not create provider-specific
duplicate tables.

## Dataset mapping

The six signed datasets are processed as follows:

```text
account                  → Ads account entity / MKT_Ads_Accounts
campaigns                → campaign entities / MKT_Ads_Campaigns
adGroups                 → ad_group entities / MKT_Ads_AdGroups
ads                      → ad entities / MKT_Ads_Ads
youtubeAssets            → creative/asset entities / MKT_Ads_Creatives
campaignDailyMetrics     → ads_daily_facts / RAW_Ads_Daily / MKT_Ads_Daily
```

Conversion facts are written only from explicitly mapped conversion-action fields.
No fabricated conversion total, value, CPA or ROAS is allowed. Missing metrics remain
`null`; observed zero remains `0`. Money uses exact micros/integer-safe parsing.

## Required write order

For one completely validated Run:

```text
1. verify Customer Connection and exact advertiser identity
2. verify signed Run identity, manifest and all chunks
3. reserve one durable Queue admission reference
4. consumer acquires distributed lock and generation fence
5. reconstruct and validate the bounded Run from D1 transport chunks
6. normalize and plan every D1 and Lark destination before the first business write
7. write D1 Ads entities/daily/conversion facts and Coverage
8. write Shared RAW Lark
9. write Canonical Lark with ownership masks
10. reconcile created + updated + skipped = expected and failed = 0
11. persist checkpoint/completion
12. redact staged payloads only after durable completion or terminal retention policy
```

A partial failure remains partial and resumes from a durable checkpoint. It must not
publish success, advance completion incorrectly or erase prior non-null facts with an
unsupported incoming `null`.

## Feature gates

Add or reuse independent fail-closed flags. Repository examples and deployed
pre-authorization configuration must keep every execution gate false:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
```

A manual source-to-Lark run may be authorized only after:

- merged reviewed source;
- required Remote migration/backup and flags-false deployment;
- customer connection is present and accepted by the exact identity gate;
- a separate explicit rollout instruction.

No schedule is authorized by this task.

## In scope

- Full review of the current Google Ads transport, OAuth, Queue/reliability, D1,
  Lark repository, Sync Engine and test architecture.
- Customer Connection credential/identity bridge without plaintext token copying.
- Additive migration(s) for Queue admission and processing lifecycle.
- Signed `LIVE` assembly behind default-false gates.
- Reference-only Queue producer and stable-operation consumer.
- D1-first Ads entity/daily/conversion normalization and persistence.
- Shared RAW and Canonical Lark planning/writing.
- Coverage, checkpoint, retry, DLQ, alert, redrive, reconciliation and payload
  redaction/retention.
- Manual one-shot operator/runbook that remains unusable without explicit approval.
- Synthetic/fake provider, Queue, D1 and Lark tests only during implementation.
- Full regression for PREVIEW, OAuth, TikTok, YouTube, Meta and Core.

## Out of scope

- Customer clicking the OAuth link during implementation.
- Remote D1 migration, Worker deployment, Secret/flag mutation or Queue send.
- Actual external `LIVE` run or Lark write before a separate rollout approval.
- Schedule/Cron activation.
- Google Ads campaign/ad mutation or Spend changes.
- Meta/YouTube implementation while this task is active.
- Production cutover or customer-owned infrastructure migration.
- Reuse, merge or cherry-pick of Draft PR `#17`; current architecture must be
  implemented fresh against the verified Storage model.

## Acceptance criteria

- [ ] Full current-codebase review completed before source edits.
- [ ] No duplicate Google Ads client, Lark writer or reliability stack is created.
- [ ] Customer credential bridge reads only encrypted Connection storage and never
  exposes a plaintext token outside the provider client boundary.
- [ ] Exact customer/manager/advertiser identity mismatch fails before admission.
- [ ] Queue body is exact-schema reference-only and secret/identity scan passes.
- [ ] Admission race creates one durable identity; exact retry is duplicate-safe.
- [ ] Queue unavailable and sent-marker ambiguity preserve correct retry state.
- [ ] Consumer uses stable operation identity and rejects unknown version/type.
- [ ] Six datasets reconcile across all expected chunks and rows.
- [ ] D1 Ads entities/daily/conversion facts use approved stable keys and UPSERT rules.
- [ ] Shared RAW and Canonical Lark plans use existing tables and ownership masks.
- [ ] Partial failure resumes from checkpoint without duplicate facts or false success.
- [ ] Exact rerun creates zero duplicate groups and zero false metric observations.
- [ ] Payloads remain bounded and are redacted after durable completion.
- [ ] PREVIEW still performs zero Queue/Business/Lark writes and immediate redaction.
- [ ] All execution flags remain false in repository examples and rollout baseline.
- [ ] Google Ads Connector/Job are not promoted to active before manual Live UAT.
- [ ] No real Queue, Remote D1, Worker, Secret, Google Ads or Lark action occurs.
- [ ] Focused tests pass.
- [ ] `npm ci`, `npm run check`, `npm test`, `npm run test:report-reliability`,
  `npm audit --audit-level=high` and `npm run deploy:dry-run` pass.
- [ ] Current Task, Project Brain and CHANGELOG record sanitized implementation result
  and the exact remaining customer/runtime gates.

## Required implementation sequence

1. Review all current Google Ads, OAuth, Queue, D1, Lark and reliability source/tests.
2. Record duplicate/dead-code, architecture and retention risks before editing.
3. Add migration and transport/admission lifecycle tests first.
4. Implement the encrypted Customer Connection authorization bridge.
5. Implement reference-only admission and shared Queue operation identity.
6. Implement the consumer, D1-first business plans and durable checkpoints.
7. Implement Shared RAW and Canonical Lark plans/writers.
8. Add failure/retry/DLQ/redrive/reconciliation and exact-rerun tests.
9. Prove PREVIEW and all unrelated regressions.
10. Run the full Definition of Done gates.
11. Update `Implementation result` and stop for Work review before PR/Remote action.

## Implementation result

Not started.

## Next approval gate

Review the completed local diff and all gate results. Commit/PR, Remote migration,
flags-false deployment, customer OAuth confirmation, manual `LIVE`, Queue send, D1/Lark
business write, schedule and Production remain separate approval boundaries.
