# Current Task — Google Ads End-to-End Lark Ready Before Customer OAuth

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_DRAFT_PR_57
CURRENT_PROGRAM                     = GOOGLE_ADS_CUSTOMER_VISIBLE_DELIVERY
SOURCE_BASELINE                     = 42D7347F
WORK_BRANCH                         = work/google-ads-end-to-end-lark-ready-before-oauth
DRAFT_PR                            = PR_57_OPEN
BRANCH_VERIFICATION                 = FINAL_DOCS_RUN_PENDING
EXTERNAL_SIGNED_PREVIEW             = PASS_PREVIEW_VALIDATED
SIGNING_SECRET                      = PROVISIONED_CONFIRMED
CUSTOMER_OAUTH                      = WAITING_CUSTOMER_CLICK
CUSTOMER_CREDENTIAL_RUNTIME_BRIDGE  = IMPLEMENTED_LOCAL
REFERENCE_ONLY_QUEUE_ADMISSION      = IMPLEMENTED_LOCAL
QUEUE_CONSUMER                      = IMPLEMENTED_LOCAL_UAT_PENDING
D1_ADS_BUSINESS_WRITES              = IMPLEMENTED_LOCAL
LARK_RAW_WRITES                     = IMPLEMENTED_LOCAL
LARK_CANONICAL_WRITES               = IMPLEMENTED_LOCAL
DLQ_REDRIVE                         = IMPLEMENTED_LOCAL_MANUAL_ONLY
MANUAL_LIVE_OPERATOR                = IMPLEMENTED_PLAN_ONLY_DEFAULT
REMOTE_ROLLOUT                      = NOT_AUTHORIZED_NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
META_AND_YOUTUBE_TASKS              = PAUSED_NOT_DISCARDED
```

The completed External Signed PREVIEW closeout is preserved at:

```text
docs/archive/current-task-google-ads-external-signed-preview-closeout-merged-2026-07-26.md
```

The rollout runbook is:

```text
docs/rollouts/google-ads-end-to-end-lark-ready-before-oauth.md
```

## Objective

Finish the complete Google Ads repository implementation before customer OAuth so
customer authorization does not require another coding phase. After a separately
approved rollout, the intended external sequence is:

```text
customer authorizes Google Ads
→ encrypted Refresh Token reference is validated
→ clean Manager Script delivers one signed LIVE run
→ API Worker admits one reference-only Queue operation
→ Sync Worker writes D1 first, then Shared RAW and Canonical Lark
→ reconciliation completes and staged payload is redacted
→ exact rerun proves zero duplicate/business-count drift
```

Provider rejection, insufficient scope, wrong Google account, pending/rejected
Developer Token access, manager/advertiser mismatch, currency mismatch or timezone
mismatch remain real external blockers and must fail closed.

## Source and authorization architecture

```text
Customer Google OAuth connection
  = customer-owned authorization, encrypted credential lifecycle and exact identity gate

Google Ads Manager Script signed delivery
  = bounded six-dataset source transport

API Worker + Queue + Sync Worker
  = authenticated admission, durable processing, D1-first writes and Lark delivery
```

The OAuth gate and signed source must resolve to the same approved customer,
manager, advertiser, currency and timezone before Queue admission. No Refresh Token,
Access Token, Signing Secret, nonce, signature, ciphertext or IV enters Queue,
business rows, Lark, logs, alerts or Git.

## Existing verified foundation

- Actual Manager Script PREVIEW passed six datasets, seven chunks and 1,375 rows.
- PREVIEW payloads were redacted and produced zero Queue/Business/Lark drift.
- Migration `0013` provides nonce/run/chunk signed transport state.
- Migration `0014` and one-time provisioning established the Signing Secret outside Git.
- Customer OAuth, AES-256-GCM credential persistence, refresh lifecycle and target
  validation already existed.
- Migration `0009` and `D1MarketingHistoryStore` provide approved Ads/Coverage grains.
- Shared Ads RAW and Canonical Lark schema/View/Formula work is already applied and is
  not reopened by this task.

## Implementation result

Draft PR `#57` implements:

1. exact-schema reference-only Queue contract;
2. provider-aware stable Queue operation identity independent from Cloudflare message ID;
3. additive `0015_google_ads_live_admission.sql` transport-to-business lifecycle;
4. encrypted Customer Connection read gate using only active credential references;
5. exact customer/manager/advertiser/currency/timezone/scope validation;
6. six-dataset LIVE run reconstruction after complete cross-chunk validation;
7. D1-first Ads entity, daily fact and six-dataset Coverage writes;
8. Shared `RAW_Ads_Entities` / `RAW_Ads_Daily` plans;
9. Canonical Ads table plans with connector-owned fields only;
10. destination preflight before first write, bounded D1 phases and one-Lark-table
    continuation checkpoints;
11. durable reconciliation, payload redaction and exact completed replay;
12. protected `uat_pending` Sync Worker route available only in developer-owned
    `integration_workspace` with all manual flags enabled and schedule false;
13. producer-marker ambiguity recovery from actual Queue receipt;
14. controlled Google Ads DLQ redrive using the exact original Queue reference;
15. same-generation terminal Work revival only when no active lock exists;
16. completed/superseded Work redrive protection;
17. phase-confirmed rollout operator whose default invocation is plan-only;
18. synthetic transport, OAuth, Queue, D1, Lark, checkpoint, redrive and operator tests;
19. release examples with every Google Ads execution/schedule flag false.

No provider-specific `RAW_Google_*` table, competing Google Ads API ingestion pipeline,
new Reliability stack or schedule was created.

## Queue reference contract

Queue body contains only:

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

- `operationId` equals the signed Run ID;
- `workKey` equals `google_ads:<runId>`;
- `generation` and `originalRequestedAt` equal `Date.parse(runStartedAt)`;
- `requestedAt` is the exact ISO representation of that generation;
- unknown fields fail permanently;
- no customer/manager/advertiser ID, source row, signature, nonce or credential enters
  the Queue body;
- ambiguous send may create an exact duplicate reference and is fenced by stable
  operation identity;
- Google Ads redrive sends the exact original body without redrive metadata.

## D1 and Lark destination scope

### D1 authority

```text
ads_entity_state
ads_daily_facts
data_coverage_runs
data_coverage_entities
google_ads_delivery_runs / google_ads_delivery_chunks
google_ads_live_admissions
sync_work_runs / sync_work_phases / sync_work_units
sync_runs / sync_locks / dead_letter_jobs / system_alerts
```

`ads_conversion_daily_facts` remains unused in v1 because the signed source has no
explicit conversion-action identity. Aggregate conversions are not fabricated into a
conversion-action grain.

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

No `MKT_Ads_AssetGroups` write occurs in v1. Existing ownership masks, formulas,
relations and Views remain authoritative.

## Dataset mapping

```text
account                  → account entity / MKT_Ads_Accounts
campaigns                → campaign entities / MKT_Ads_Campaigns
adGroups                 → ad_group entities / MKT_Ads_AdGroups
ads                      → ad entities / MKT_Ads_Ads
youtubeAssets            → creative entities / MKT_Ads_Creatives
campaignDailyMetrics     → ads_daily_facts / RAW_Ads_Daily / MKT_Ads_Daily
```

Missing unsupported metrics remain `null`; observed zero remains `0`; money remains
integer micros. Reach is not fabricated from another metric.

## Required processing order

```text
1. verify exact Queue reference and LIVE Admission
2. reconstruct complete signed Run from D1 transport chunks
3. validate all six datasets and cross-dataset relations
4. plan every Shared RAW/Canonical Lark destination before first business write
5. claim generation fence and renewable distributed lock
6. write D1 Ads entities, daily facts and Coverage in bounded checkpointed units
7. write Shared RAW one table at a time
8. write Canonical Lark one table at a time with ownership masks
9. reconcile created + updated + skipped = expected and failed = 0
10. complete durable Work and Admission
11. redact staged LIVE payload only after durable completion
```

Partial failure remains partial/retryable and resumes from checkpoints. Incoming
unsupported `null` does not erase protected non-null history.

## DLQ and controlled redrive

- Main Queue and existing DLQ remain authoritative.
- Google Ads retries preserve stable operation identity.
- DLQ terminal marking does not execute the job again.
- Manual redrive requires `MKT_DLQ_REDRIVE_ENABLED=true` and an explicit admin job.
- Redrive revives only the same Work key/generation with lifecycle `terminal` or an
  already active retry boundary and no active lock.
- Completed and superseded Work remain closed.
- Queue-send ambiguity may resend only the exact original reference.
- Actual Queue receipt may promote a `send_pending` Admission to `queued`
  idempotently before processing.

## Feature gates

All release examples keep these false:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
MKT_DLQ_REDRIVE_ENABLED=false
```

Google Ads Connector and Job remain `uat_pending`, not `active`. The protected route
is limited to Development Integration Workspace manual UAT and does not make generic
`uat_pending` connectors runnable.

## In scope completed

- [x] Full current-codebase review before source edits.
- [x] Existing transport/OAuth/Queue/Reliability/D1/Lark stacks reused.
- [x] Encrypted credential-reference bridge implemented without plaintext exposure.
- [x] Exact authorization and signed-source identity gate implemented.
- [x] Additive LIVE Admission migration/store implemented.
- [x] Reference-only Queue producer and stable consumer implemented.
- [x] D1-first normalization, Coverage and bounded writes implemented.
- [x] Shared RAW and Canonical Lark planning/writing implemented.
- [x] Checkpoint/resume, retry, partial failure, alert and redaction semantics implemented.
- [x] Exact-schema DLQ redrive and terminal Work revival implemented.
- [x] Protected manual operator/runbook implemented.
- [x] Synthetic/fake provider, Queue, D1 and Lark tests added.
- [x] Google Ads execution/schedule flags remain false in release examples.
- [ ] Final Branch Verification after documentation closeout.

## Explicitly not executed

- Customer OAuth click/callback.
- Remote D1 backup or migration `0015` apply.
- Worker deployment.
- Runtime Secret or flag mutation.
- Actual external LIVE signed delivery.
- Actual Queue message.
- D1 Ads business write.
- Shared RAW or Canonical Lark business write.
- DLQ redrive.
- Schedule/Cron activation.
- Production cutover.
- Google Ads campaign/ad/bid/budget/spend mutation.

## Required rollout sequence after separate approval

```text
1. review and merge PR #57
2. run guarded preflight
3. back up Remote D1
4. apply additive migrations
5. deploy both Workers with all execution flags false
6. wait for exact validated Customer OAuth connection
7. run read-only encrypted Connection gate
8. obtain separate manual LIVE approval
9. enable only approved manual flags
10. execute one clean Manager Script LIVE run
11. disable execution flags immediately after admission
12. verify D1 / Shared RAW / Canonical reconciliation
13. exact rerun and verify zero business-count drift
14. observe clean manual cycles
15. open a separate Schedule decision task
```

Approval of this implementation task never authorizes Remote rollout, customer OAuth,
LIVE execution, Lark writes, schedule activation or Production.
