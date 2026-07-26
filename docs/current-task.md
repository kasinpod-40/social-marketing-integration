# Current Task — Google Ads Remote Rollout Gate

## Authoritative status

```text
TASK_STATUS                         = REMOTE_ROLLOUT_APPROVED_PREFLIGHT_BLOCKED_OPERATOR_ENV_NOT_CONNECTED
CURRENT_PROGRAM                     = GOOGLE_ADS_CUSTOMER_VISIBLE_DELIVERY
ROLLOUT_APPROVAL                    = EXPLICIT_USER_INSTRUCTION_2026_07_26
AUTHORIZED_PHASES                   = PREFLIGHT_BACKUP_MIGRATE_FLAGS_FALSE_DEPLOY_DISABLED_VERIFY
MERGED_PR                           = PR_57
MERGE_METHOD                        = SQUASH
MERGE_COMMIT                        = e114db4669fea93b23fb4816232f4598de3e401a
SOURCE_HEAD_BEFORE_MERGE            = 168f2edc47c1cd0fdc8ddd15f6294287a5a7e1f9
BRANCH_VERIFICATION                 = PASS_RUN_482
REPOSITORY_REVIEW                   = PASS
REMOTE_OPERATOR_PREFLIGHT           = NOT_EXECUTED_OPERATOR_ENV_NOT_CONNECTED
REMOTE_D1_BACKUP                    = NOT_RUN
REMOTE_D1_MIGRATION_0015            = NOT_RUN
API_WORKER_DEPLOYMENT               = NOT_RUN
SYNC_WORKER_DEPLOYMENT              = NOT_RUN
DISABLED_ROUTE_SCHEMA_VERIFY        = NOT_RUN
CUSTOMER_OAUTH                      = WAITING_CUSTOMER_CLICK
GOOGLE_ADS_CONNECTOR_STATUS         = UAT_PENDING
GOOGLE_ADS_JOB_STATUS               = UAT_PENDING_MANUAL_ONLY
SIGNED_LIVE                         = NOT_RUN
QUEUE_BUSINESS_PROCESSING           = NOT_RUN
D1_ADS_BUSINESS_WRITES              = NOT_RUN
LARK_RAW_WRITES                     = NOT_RUN
LARK_CANONICAL_WRITES               = NOT_RUN
REAL_DLQ_REDRIVE                    = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
META_AND_YOUTUBE_TASKS              = PAUSED_NOT_DISCARDED
```

## Rollout authorization and execution attempt

The user explicitly authorized the next guarded Remote rollout task on 2026-07-26.
The authorized boundary is limited to:

1. read-only operator preflight;
2. Remote D1 backup and SHA-256 evidence;
3. additive migration apply, including `0015_google_ads_live_admission.sql`;
4. API and Sync Worker deployment with every Google Ads execution flag false;
5. disabled-route and schema verification.

The rollout did not begin because the current execution session has Repository access
but does not have the approved operator environment required by the merged runbook:

- no mounted clean `main` checkout from the developer workstation;
- no ignored real API/Sync Wrangler config files;
- no authenticated Cloudflare/Wrangler session;
- no access to the ignored evidence directory on the operator workstation.

This is an operator-environment blocker, not a Remote runtime failure. No config was
guessed, no Secret was requested or exposed, and no fallback deployment path was
created.

## Verified repository foundation

PR `#57` was Squash Merged into `main` at:

```text
e114db4669fea93b23fb4816232f4598de3e401a
```

Final Branch Verification run `#482` passed on source head:

```text
168f2edc47c1cd0fdc8ddd15f6294287a5a7e1f9
```

Verified stages:

- locked dependency installation;
- syntax, architecture and repository hygiene;
- focused TikTok staged regression;
- Node Unit/Integration tests;
- Workers runtime tests;
- report reliability regression;
- high-severity dependency audit;
- Wrangler deployment dry-run.

The final regression fix made the Google Ads redrive store lazy so the existing
YouTube admin-redrive route does not require Google Ads D1 capabilities.

## Implemented repository path

The merged implementation provides:

1. exact-schema reference-only Queue admission;
2. stable operation identity `google_ads:<runId>` independent from Queue message ID;
3. additive migration `0015_google_ads_live_admission.sql`;
4. encrypted Customer Connection credential-reference gate;
5. exact customer, manager, advertiser, scope, currency and timezone validation;
6. complete six-dataset signed LIVE reconstruction;
7. D1-first Ads entity, daily fact and Coverage writes;
8. Shared `RAW_Ads_Entities` and `RAW_Ads_Daily` delivery;
9. Canonical Ads account, campaign, ad-group, ad, creative and daily delivery;
10. destination preflight before first business write;
11. resumable D1/Lark phases, generation fence and renewable lock;
12. reconciliation and staged-payload redaction after durable completion;
13. producer-marker ambiguity recovery from actual Queue receipt;
14. exact Google Ads DLQ redrive using the unchanged original Queue body;
15. same-generation terminal Work revival with active-lock/completed/superseded guards;
16. protected Integration Workspace route while Connector/Job remain `uat_pending`;
17. guarded rollout operator with plan-only default;
18. synthetic transport, OAuth, Queue, D1, Lark, recovery and operator tests.

No provider-specific `RAW_Google_*` tables, duplicate Ads ingestion pipeline,
competing Reliability stack or Google Ads schedule were introduced.

## Queue contract

The only Google Ads Queue body is:

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

Unknown fields, identity drift and generation drift fail permanently. Customer IDs,
source rows, signatures, nonces, Secrets, tokens, ciphertext and IVs never enter the
Queue body.

## Runtime safety boundary

All release examples keep these values false:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
MKT_DLQ_REDRIVE_ENABLED=false
```

This rollout approval does not authorize:

- Secret, Script Property or runtime flag mutation beyond proving the existing flags
  remain false;
- customer OAuth completion;
- actual signed LIVE delivery;
- real Queue message;
- D1 Ads business write;
- Shared RAW or Canonical Lark write;
- real DLQ redrive;
- schedule activation;
- Production cutover;
- Google Ads campaign, ad, bid, budget or spend mutation.

## Exact resume boundary

Resume only from a clean reviewed `main` checkout in the approved operator environment.
Follow the merged operator and runbook without replacing or bypassing them:

```text
1. execute guarded preflight
2. preserve preflight evidence
3. create Remote D1 backup + checksum
4. verify backup evidence
5. apply additive pending migrations
6. deploy API and Sync Workers with all Google Ads execution flags false
7. verify disabled routes and migration schema
8. stop and wait for exact validated customer OAuth connection
```

Runbook:

```text
docs/rollouts/google-ads-end-to-end-lark-ready-before-oauth.md
```

A separate explicit instruction remains required before enabling manual execution
flags, running one signed LIVE delivery, sending a Queue operation, writing D1/Lark
business facts, performing redrive, enabling a schedule or cutting over Production.
