# Current Task — Google Ads Manager Script LIVE to Lark

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_PASS_AWAITING_MERGE
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
USER_AUTHORIZATION                  = COMPLETE_THROUGH_MANUAL_LIVE_D1_LARK_UAT_2026_07_26
DELIVERY_SOURCE                     = GOOGLE_ADS_MANAGER_SCRIPT
DIRECT_GOOGLE_ADS_API               = OPTIONAL_FUTURE_PATH
GOOGLE_ADS_API_ACCESS               = PENDING_NON_BLOCKING
CUSTOMER_OAUTH                      = COMPLETED
CUSTOMER_CONNECTION                 = CONNECTED_ENCRYPTED_REFRESH_TOKEN_ACTIVE
SCRIPT_GATE_HOTFIX                  = PASS_PR_59
SOURCE_HEAD                         = 96decafb6a1a83328f8798e7fd4ef957ee15a66a
BRANCH_VERIFICATION                 = PASS_RUN_489
REPOSITORY_REVIEW                   = PASS
REMOTE_OPERATOR_PREFLIGHT           = NOT_RUN
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

## Latest user decision

The primary and authoritative Google Ads ingestion path is:

```text
Google Ads
→ Manager Script
→ signed HMAC delivery
→ reference-only Queue operation
→ durable D1 Ads facts and Coverage
→ Shared RAW Ads tables in Lark
→ Canonical Ads tables in Lark
```

Google Ads API developer-token approval is not a prerequisite for this path. The existing
OAuth connection remains valuable as customer consent and encrypted credential evidence,
and may support a future direct API path, but `google_ads_api_access_pending` must not block
Manager Script signed delivery.

Related Project Brain authority:

```text
docs/project-brain/google-ads-manager-script-live-path.md
```

## Root cause

PR `#57` correctly implemented the durable LIVE, Queue, D1 and Lark path but coupled LIVE
admission to direct Google Ads API validation:

- the Connection read required `access_status = 'validated'`;
- the authorization layer required API-derived external account metadata;
- the rollout operator required API validation, currency and timezone metadata.

The customer has completed OAuth and has one active encrypted refresh token, but the direct
API validation status is `google_ads_api_access_pending`. Manager Script PREVIEW already proved
that the approved Manager and advertiser are selectable and that six datasets, seven chunks
and 1,375 rows can be signed and delivered without Google Ads API access.

## Implemented correction

1. Manager Script LIVE now accepts either `validated` or
   `google_ads_api_access_pending` while retaining all exact consent and identity checks.
2. Customer Connection remains fail-closed on:
   - `customer_key = chemistry_k`;
   - `connector_key = google_ads`;
   - `connection_status = connected`;
   - exact `adwords` OAuth scope;
   - active encrypted refresh-token credential reference;
   - Manager ID `9463570541`;
   - approved advertiser ID `5662332033`.
3. Signed Script source identity, HMAC, key ID, timestamp, nonce/replay, manifest,
   dataset count and payload limits remain unchanged.
4. API-derived currency/timezone metadata is checked when present, but is not required while
   direct API access is pending.
5. The operator connection gate treats API state as informational and Script consent as the
   blocking decision.
6. The D1 read query and operator SQL were executed through the SQLite/D1 test adapter.
7. Queue contract, D1/Lark writer, migrations, stable keys, generation fences, locks,
   resumable checkpoints, reconciliation and redaction were not weakened or duplicated.

## In scope after merge

The user has already authorized the guarded Integration Workspace rollout through one manual
LIVE UAT and exact rerun:

1. guarded read-only preflight;
2. Remote D1 backup and SHA-256 evidence;
3. additive Migration `0015`;
4. flags-false API and Sync Worker deployment;
5. disabled-route and schema verification;
6. read-only Manager Script Customer Connection gate;
7. enable only required manual flags with schedule remaining false;
8. run the reviewed Manager Script once in LIVE mode;
9. verify Queue, D1, Lark RAW and Canonical completion;
10. reconcile all six datasets;
11. exact rerun with zero durable business-fact drift;
12. restore manual execution flags to false.

## Out of scope

- Direct Google Ads API as the primary ingestion source;
- schedule activation;
- Production cutover;
- DLQ redrive unless the UAT creates a specifically reviewed retryable incident;
- Google Ads campaign, ad, bid, budget or spend mutation;
- deleting or rewriting existing D1/Lark business facts;
- reopening completed Lark Schema/View/Formula work.

## Runtime safety contract

The Manager Script gate must never accept only a bearer claim or a manually edited status.
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

## Validation result

Branch Verification run `#489` passed on source head:

```text
96decafb6a1a83328f8798e7fd4ef957ee15a66a
```

Verified stages include:

- locked dependency installation;
- syntax, architecture and repository hygiene;
- focused TikTok regression;
- Node Unit/Integration tests;
- Workers runtime tests;
- report reliability regression;
- high-severity dependency audit;
- Wrangler deployment dry-run.

Focused Google Ads coverage passed for:

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

## Implementation result

```text
PR                         = 59
BRANCH                     = agent/google-ads-manager-script-live-gate-hotfix
SOURCE_HEAD                = 96decafb6a1a83328f8798e7fd4ef957ee15a66a
BRANCH_VERIFICATION        = PASS_RUN_489
REMOTE_ACTIONS             = NONE
BUSINESS_FACT_MUTATION     = NONE
```

Changed files are limited to the Manager Script authorization/read gate, guarded operator,
focused tests, Current Task, rollout runbook, Changelog and the related Project Brain module.
No Queue schema, D1/Lark business writer, migration or Source business fact was changed.

## Exact remote resume boundary

Remote execution must start only from the clean merged `main` checkout in the protected
operator environment containing reviewed ignored Wrangler configs and authenticated
Cloudflare/Wrangler identity. Do not guess config paths or expose Secrets.

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
