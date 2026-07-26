# Current Task — Google Ads Canonical Lark Mapping Hotfix

## Authoritative status

```text
TASK_STATUS                         = PR_62_MERGED_GUARDED_RECOVERY_DEPLOY_READY
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
INCIDENT_DATE                       = 2026-07-26
INCIDENT_RUN_ID                     = 88351cb4-714d-49ef-91db-d95550a93ebf
FIRST_DLQ_ID                        = terminal:a6ed54413000c25efd73ce7888cc2d10
FIRST_DLQ_STATUS                    = redriven
SECOND_DLQ_ID                       = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
SECOND_DLQ_STATUS                   = open
FIRST_FAILURE_FIELD                 = RAW_Ads_Daily.metric_date
SECOND_FAILURE_FIELD                = MKT_Ads_Accounts.ads_account_id
SECOND_FAILURE_REASON               = field does not exist in destination schema
TRANSPORT_CHUNKS                    = 7 / 7
TRANSPORT_ROWS                      = 1375 / 1375
D1_ADS_BUSINESS_ROWS                = 0
LARK_BUSINESS_WRITES                = 0
SCRIPT_MODE                         = DRY_RUN
SCRIPT_DELIVERY_ENABLED             = false
API_GOOGLE_ADS_FLAGS                = false
SYNC_GOOGLE_ADS_FLAGS               = false
DLQ_REDRIVE_ENABLED                 = false
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Incident progression

The first guarded LIVE run reached destination preflight and failed before any business write because
Google Ads date-only `metricDate` was sent to Lark DateTime fields without timezone resolution. PR
`#61` corrected the date serialization and guarded same-generation `failed_permanent` redrive.

The original DLQ was then redriven exactly once. The second attempt passed the original
`metric_date` failure and stopped at the first Canonical Ads row:

```text
sync_run_id          = 115a17e8-2a25-4260-b921-5a5ae4e7f127
error_code           = LARK_PREFLIGHT_FAILED
table_id             = tbl3yPcXdQzZQvBc
logical_table        = MKT_Ads_Accounts
row                  = 0
field                = ads_account_id
reason               = field does not exist in destination schema
partial              = false
new terminal DLQ     = terminal:6b1c7a5142f1eedb12a2b40b0a7cba78
```

This confirms PR `#61` worked and exposed an independent Canonical adapter/schema drift. Both
attempts remained non-partial: destination preflight stopped execution before any D1 Ads fact or
Lark business write.

## Root cause

The live Lark Base already uses the applied Canonical Ads v2 field contract. The Google Ads runtime
adapter still emitted several pre-migration aliases, including:

```text
ads_account_id
ads_account_name
connection_status
campaign_key
campaign_id
campaign_status
ad_group_key
ad_group_id
ad_group_status
creative_key
ad_status
last_sync_at
```

Lark Schema, Views and Formulas are not defective and are not changed by this hotfix.

## Merged correction

PR `#62` was Squash Merged into `main`:

```text
PR                       = #62 / MERGED
MERGE_COMMIT             = 3ab7a249cb40f6e3f377cecf02f2d8713bbdcb61
REVIEWED_SOURCE_HEAD     = 56d27b6c98b7b915e4367a2b5781f110cbc10f45
FINAL_BRANCH_HEAD        = f702319a9bcbb339f7f300c9e56fb46fee460a0a
SOURCE_VERIFICATION      = PASS / RUN_505
FINAL_DOCS_VERIFICATION  = PASS / RUN_509
```

The merged implementation:

1. Accounts use `account_id`, `account_name`, `status` and grounded Google extensions.
2. Campaigns use `ads_campaign_key`, `account_id`, `external_campaign_id`, optional `objective`,
   Canonical status, reviewed channel values and source-timezone DateTime values.
3. Ad Groups use `ads_ad_group_key`, `external_campaign_id` and `external_ad_group_id`.
4. Ads use `ads_ad_key`, exact external parent IDs, `ad_type` and `final_url`.
5. YouTube assets use `ads_creative_key`, `external_creative_id`, `creative_name`,
   `creative_type`, `status` and `source_content_id`.
6. Daily rows use Canonical account/entity/external IDs, currency and approved metric fields.
7. Google source statuses map to `active`, `paused`, `removed` or `unknown`.
8. Search, Display, YouTube, Demand Gen, Performance Max, Shopping, App and fallback channels map
   to reviewed Canonical options.
9. Canonical Daily derives modern channel from Campaign source enums when signed transport v1 uses
   legacy `google_other`.
10. Average CPV micros convert to the Canonical display-unit `average_cpv` field.
11. Generic ownership metadata is omitted because it is not grounded in signed source/runtime data.
12. All D1 contracts, source payloads and stable-key values remain unchanged.
13. Exact per-table allowlists and forbidden-alias tests prevent stale names from returning.

## Acceptance result

```text
MKT_Ads_Accounts no longer emits ads_account_id             PASS
all Canonical rows obey exact per-table field allowlists    PASS
all forbidden pre-migration aliases are absent              PASS
optional Campaign objective is preserved                    PASS
ungrounded generic ownership metadata is omitted            PASS
stable-key values remain unchanged                          PASS
D1 date-only facts and write contracts remain unchanged     PASS
ENABLED status maps to active                               PASS
campaign dates use source-timezone local midnight           PASS
Daily account/entity/external IDs and currency are present  PASS
legacy google_other is normalized from Campaign source      PASS
```

## Verification result

```text
FOCUSED_TIKTOK_TESTS     = 4 / 4 PASS
NODE_UNIT_INTEGRATION    = 825 / 825 PASS
WORKERS_RUNTIME_TESTS    = 9 / 9 PASS
REPORT_RELIABILITY       = 70 / 70 PASS
DEPENDENCY_AUDIT         = 0 vulnerabilities
WRANGLER_DRY_RUN         = PASS
REVIEW_THREADS           = 0
REVIEW_COMMENTS          = 0
REMOTE_ACTIONS_IN_PR     = none
```

## Controlled recovery authorized next

The Repository gate is complete. The remaining Integration Workspace runtime steps are:

1. pull clean merged `main`;
2. deploy the merged Sync Worker through the guarded recovery configuration;
3. keep signed ingress and Google Ads schedule disabled;
4. enable Connector, Queue admission, D1/Lark writes and DLQ redrive only for the bounded window;
5. send one redrive command for the second DLQ only;
6. verify Queue → destination preflight → D1 → Lark → reconciliation for the original Run ID;
7. restore all Google Ads and DLQ-redrive flags to false immediately after verification.

The first DLQ must never be redriven again. Manager Script must not be rerun.

## Runtime hold boundary

```text
Google Ads Script          DRY_RUN / delivery=false
API Google Ads flags       false
Sync Google Ads flags      false
DLQ redrive                false
Google Ads schedules       false
First DLQ                  redriven / retain / never redrive again
Second DLQ                 open / retain
Second exact redrive       blocked until merged Sync recovery deploy is verified
Production                 blocked
```
