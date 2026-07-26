# Current Task — Google Ads Manager Script LIVE to Lark

## Authoritative status

```text
TASK_STATUS                         = HOTFIX_MERGED_REMOTE_ROLLOUT_READY_OPERATOR_ENV_REQUIRED
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
USER_AUTHORIZATION                  = COMPLETE_THROUGH_MANUAL_LIVE_D1_LARK_UAT_2026_07_26
DELIVERY_SOURCE                     = GOOGLE_ADS_MANAGER_SCRIPT
DIRECT_GOOGLE_ADS_API               = OPTIONAL_FUTURE_PATH
GOOGLE_ADS_API_ACCESS               = PENDING_NON_BLOCKING
CUSTOMER_OAUTH                      = COMPLETED
CUSTOMER_CONNECTION                 = CONNECTED_ENCRYPTED_REFRESH_TOKEN_ACTIVE
SCRIPT_GATE_HOTFIX                  = MERGED_PR_59
MERGE_COMMIT                        = 82767ffe80e417901e9b0a9f1f767ecefedb8c82
REVIEWED_SOURCE_HEAD                = 84cd1a34c23282000ed43b8e0a378069fdfbbdd8
BRANCH_VERIFICATION                 = PASS_RUN_490
REPOSITORY_REVIEW                   = PASS
REMOTE_OPERATOR_PREFLIGHT           = BLOCKED_OPERATOR_ENV_NOT_CONNECTED
REMOTE_D1_BACKUP                    = NOT_RUN
REMOTE_D1_MIGRATION_0015            = NOT_RUN
API_WORKER_DEPLOYMENT               = NOT_RUN
SYNC_WORKER_DEPLOYMENT              = NOT_RUN
SIGNED_LIVE                         = NOT_RUN
QUEUE_BUSINESS_PROCESSING           = NOT_RUN
D1_ADS_BUSINESS_WRITES              = NOT_RUN
LARK_RAW_WRITES                     = NOT_RUN
LARK_CANONICAL_WRITES               = NOT_RUN
EXACT_RERUN                         = NOT_RUN
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Authoritative delivery decision

The primary Google Ads ingestion path is:

```text
Google Ads
→ Manager Script
→ signed HMAC delivery
→ reference-only Queue operation
→ durable D1 Ads facts and Coverage
→ Shared RAW Ads tables in Lark
→ Canonical Ads tables in Lark
```

Google Ads API Developer Token approval is not a prerequisite. The completed OAuth connection
continues to provide customer consent and encrypted credential evidence, while direct API
access remains an optional future path. `google_ads_api_access_pending` must not block Manager
Script delivery.

Related Project Brain authority:

```text
docs/project-brain/google-ads-manager-script-live-path.md
```

## Root cause and merged correction

PR `#57` implemented the durable LIVE, Queue, D1 and Lark path but incorrectly coupled Manager
Script LIVE admission to direct Google Ads API validation. The customer had completed OAuth and
Manager Script PREVIEW had already proved six datasets, seven chunks and 1,375 rows, but
`google_ads_api_access_pending` prevented LIVE admission.

PR `#59` corrected the gate and was Squash Merged into `main` at:

```text
82767ffe80e417901e9b0a9f1f767ecefedb8c82
```

The merged correction:

1. accepts `validated` or `google_ads_api_access_pending` for the Manager Script path;
2. still requires `connected`, the exact `adwords` scope and an active encrypted
   refresh-token reference;
3. requires exact approved Manager `9463570541` and advertiser `5662332033` mappings;
4. preserves signed runtime identity, HMAC, key ID, timestamp, nonce/replay, manifest,
   dataset count and payload limits;
5. checks API-derived currency/timezone metadata when present, without requiring it while
   direct API access is pending;
6. treats API status as informational in the operator connection gate;
7. executes the D1 read query and operator SQL through the SQLite/D1 test adapter;
8. leaves Queue contract, D1/Lark writers, migrations, stable keys, generation fences,
   renewable locks, resumable checkpoints, reconciliation and redaction unchanged.

## Verification result

Final Branch Verification run `#490` passed on reviewed source head:

```text
84cd1a34c23282000ed43b8e0a378069fdfbbdd8
```

Passed stages:

- locked dependency installation;
- syntax, architecture and repository hygiene;
- focused TikTok regression;
- Node Unit/Integration and Workers runtime tests;
- report reliability regression;
- high-severity dependency audit;
- Wrangler deployment dry-run;
- diagnostics upload.

Focused Manager Script coverage passed:

```text
PASS  connected + google_ads_api_access_pending + exact scope/token/manager/advertiser
PASS  connected + validated + exact scope/token/manager/advertiser
FAIL  missing connection or unsupported state
FAIL  missing adwords scope
FAIL  inactive/replaced encrypted credential
FAIL  approved advertiser mismatch
FAIL  manager mismatch
FAIL  optional API metadata conflict
PASS  LIVE HTTP queues one reference from API-pending Script consent
PASS  exact retry does not enqueue a second operation
PASS  operator SQL accepts pending or validated API state
PASS  operator SQL executes through SQLite/D1 adapter
FAIL  operator gate when a required Script consent field mismatches
```

No Remote D1, Cloudflare, Queue, Lark, schedule or Production action occurred during the hotfix.
No existing business fact was changed.

## Approved remaining work

The user has authorized one guarded Integration Workspace rollout through manual LIVE, Lark
visibility and exact rerun:

1. guarded read-only preflight;
2. Remote D1 backup and SHA-256 evidence;
3. additive Migration `0015`;
4. flags-false API and Sync Worker deployment;
5. disabled-route and schema verification;
6. read-only Manager Script Customer Connection gate;
7. enable only required manual flags while schedule remains false;
8. run the reviewed Manager Script once in LIVE mode;
9. verify Queue and durable Work completion;
10. verify D1 Ads facts and six Coverage records;
11. verify Shared RAW and Canonical Lark writes;
12. reconcile all six datasets;
13. perform one exact rerun with zero durable business-fact drift;
14. restore manual execution flags to false and retain sanitized evidence.

Expected Lark destinations:

```text
RAW_Ads_Entities
RAW_Ads_Daily
MKT_Ads_Accounts
MKT_Ads_Campaigns
MKT_Ads_AdGroups
MKT_Ads_Ads
MKT_Ads_Creatives
MKT_Ads_Daily
```

## Runtime safety contract

LIVE still requires:

```text
connected customer consent
+ exact adwords scope
+ active encrypted refresh-token reference
+ exact approved manager and advertiser mapping
+ signed runtime identity
+ valid HMAC key ID/signature
+ bounded timestamp
+ reserved non-replayed nonce
+ complete six-dataset manifest
+ all manual LIVE/Queue/D1/Lark flags explicitly enabled
+ schedule disabled
```

The Queue body remains reference-only and contains no token, signature, source row or customer
identity. D1-first and Lark phases retain stable keys, generation fences, renewable locks,
resumable checkpoints, reconciliation and staged-payload redaction.

## Out of scope

- Direct Google Ads API as the primary ingestion source;
- schedule activation;
- Production cutover;
- DLQ redrive unless the UAT creates a specifically reviewed retryable incident;
- Google Ads campaign, ad, bid, budget or spend mutation;
- deleting or rewriting existing D1/Lark business facts;
- reopening completed Lark Schema/View/Formula work.

## Exact remote resume boundary

Remote execution must begin only from the clean merged `main` checkout in the protected
operator environment containing reviewed ignored Wrangler configs, authenticated
Cloudflare/Wrangler identity and a writable ignored evidence directory. The current chat
session does not have those resources and must not guess config paths or request/expose
Secrets.

```text
1. guarded read-only preflight
2. preserve evidence
3. Remote D1 backup + SHA-256
4. apply Migration 0015 only after backup validation
5. deploy API and Sync Workers with all Google Ads flags false
6. verify disabled routes and schema
7. run read-only Manager Script authorization gate
8. enable manual UAT flags, schedule remaining false
9. run one Manager Script LIVE delivery
10. verify Queue → D1 → Lark and six-dataset reconciliation
11. exact rerun with zero durable count drift
12. restore manual execution flags false and preserve sanitized evidence
```

Runbook:

```text
docs/rollouts/google-ads-end-to-end-lark-ready-before-oauth.md
```
