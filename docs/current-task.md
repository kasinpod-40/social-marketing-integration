# Current Task — Google Ads Manager Script LIVE to Lark

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
USER_AUTHORIZATION                  = COMPLETE_THROUGH_MANUAL_LIVE_D1_LARK_UAT_2026_07_26
DELIVERY_SOURCE                     = GOOGLE_ADS_MANAGER_SCRIPT
DIRECT_GOOGLE_ADS_API               = OPTIONAL_FUTURE_PATH
GOOGLE_ADS_API_ACCESS               = PENDING_NON_BLOCKING
CUSTOMER_OAUTH                      = COMPLETED
CUSTOMER_CONNECTION                 = CONNECTED_ENCRYPTED_REFRESH_TOKEN_ACTIVE
SCRIPT_GATE_HOTFIX                  = IN_PROGRESS
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

## In scope

1. Decouple Manager Script LIVE admission from direct API developer-token approval.
2. Keep Customer Connection requirements fail-closed:
   - `customer_key = chemistry_k`;
   - `connector_key = google_ads`;
   - `connection_status = connected`;
   - access status is `validated` or `google_ads_api_access_pending`;
   - exact `adwords` OAuth scope exists;
   - active encrypted refresh-token credential reference matches;
   - Manager ID matches `9463570541`;
   - approved advertiser ID matches `5662332033`.
3. Continue to validate signed Script source identity, signature, timestamp, nonce/replay,
   manifest, dataset count and payload limits through the existing signed-delivery contract.
4. Keep optional API-derived currency/timezone metadata consistent when present, without
   requiring it while direct API access is pending.
5. Update the guarded rollout connection gate to treat API access as informational and
   Manager Script authorization as the blocking decision.
6. Add focused Unit and HTTP integration coverage for API-pending Script consent.
7. After merge, execute the already-approved guarded Remote rollout:
   - preflight;
   - D1 backup and SHA-256 evidence;
   - additive Migration `0015`;
   - deploy API and Sync Workers with all execution flags false;
   - verify disabled routes and schema;
   - read-only Manager Script connection gate.
8. Execute one manually approved LIVE UAT with schedule disabled:
   - enable only required manual execution flags;
   - run the reviewed Manager Script once in LIVE mode;
   - verify Queue, D1, Lark RAW and Canonical completion;
   - reconcile all six datasets;
   - run one exact rerun and prove no business-fact drift;
   - restore manual execution flags to false after evidence capture.

## Out of scope

- Direct Google Ads API as the primary ingestion source;
- schedule activation;
- Production cutover;
- DLQ redrive unless the UAT creates a specifically reviewed retryable incident;
- Google Ads campaign, ad, bid, budget or spend mutation;
- deleting or rewriting existing D1/Lark business facts;
- reopening Lark Schema/View/Formula work already completed.

## Runtime safety contract

The Manager Script gate must never accept only a bearer claim or a manually edited status.
LIVE still requires all of the following:

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
```

The Queue body remains reference-only and contains no token, signature, source row or customer
identity. D1-first and Lark phases retain stable keys, generation fences, renewable locks,
resumable checkpoints, reconciliation and staged-payload redaction.

## Required tests

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run
```

Focused coverage must include:

```text
PASS  connected + google_ads_api_access_pending + exact scope/token/manager/advertiser
PASS  connected + validated + exact scope/token/manager/advertiser
FAIL  missing connection or disconnected state
FAIL  unsupported access status
FAIL  missing adwords scope
FAIL  inactive/replaced encrypted credential
FAIL  approved advertiser mismatch
FAIL  manager mismatch
FAIL  optional API metadata conflicts with signed source
PASS  LIVE HTTP path queues one reference from API-pending Script consent
PASS  exact retry does not enqueue a second operation
PASS  operator read-only SQL accepts pending or validated API state
FAIL  operator gate when any required Script consent field mismatches
```

## Implementation result

Implementation branch:

```text
agent/google-ads-manager-script-live-gate-hotfix
```

Changed so far:

- `google-ads-live-authorization.js` now authorizes Manager Script consent independently of
  direct API approval while retaining exact scope, encrypted credential and identity checks;
- `d1-google-ads-customer-connection-read-store.js` reads connected Script-authorized
  connections with either API-pending or API-validated status;
- the rollout operator now treats API state as informational and validates exact scope,
  active credential, Manager and approved advertiser;
- focused Unit, HTTP and operator tests cover the API-pending Manager Script path.

Pending before merge:

- Branch Verification and full CI;
- diff/regression review;
- documentation closeout and merge decision.

## Exact remote resume boundary

Remote execution must start only from the clean merged `main` checkout in the protected
operator environment containing the reviewed ignored Wrangler configs and authenticated
Cloudflare/Wrangler session. Do not guess config paths or expose Secrets.

```text
1. guarded read-only preflight
2. preserve evidence
3. Remote D1 backup + SHA-256
4. apply Migration 0015 only after backup validation
5. deploy API and Sync Workers with all Google Ads flags false
6. verify disabled routes and schema
7. run read-only Manager Script authorization gate
8. explicitly enable manual UAT flags, schedule remaining false
9. run one Manager Script LIVE delivery
10. verify Queue → D1 → Lark completion and six-dataset reconciliation
11. run exact rerun and prove no durable count drift
12. restore manual execution flags false and preserve sanitized closeout evidence
```
