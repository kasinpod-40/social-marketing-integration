# Current Task — Google Ads LIVE Lark Date Serialization and Failed-Permanent Redrive Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTED_PR_61_BRANCH_VERIFICATION_PASS_AWAITING_REVIEW
CURRENT_PROGRAM                     = GOOGLE_ADS_MANAGER_SCRIPT_SIGNED_DELIVERY_TO_LARK
INCIDENT_DATE                       = 2026-07-26
INCIDENT_RUN_ID                     = 88351cb4-714d-49ef-91db-d95550a93ebf
INCIDENT_DLQ_ID                     = terminal:a6ed54413000c25efd73ce7888cc2d10
INCIDENT_ERROR_CODE                 = LARK_PREFLIGHT_FAILED
TRANSPORT_CHUNKS                    = 7 / 7
TRANSPORT_ROWS                      = 1375 / 1375
D1_ADS_BUSINESS_ROWS                = 0
LARK_BUSINESS_WRITES                = 0
SCRIPT_MODE                         = DRY_RUN
SCRIPT_DELIVERY_ENABLED             = false
API_GOOGLE_ADS_FLAGS                = false
SYNC_GOOGLE_ADS_FLAGS               = false
SCHEDULE                            = DISABLED
PRODUCTION                          = BLOCKED
```

## Incident evidence

The first guarded external Google Ads Manager Script LIVE delivery completed signed transport and
reference-only Queue admission for all six datasets, seven chunks and 1,375 rows. Processing then
failed permanently during Lark destination preflight before any D1 Ads fact or Lark business write.

```text
run_id               = 88351cb4-714d-49ef-91db-d95550a93ebf
work_key              = google_ads:88351cb4-714d-49ef-91db-d95550a93ebf
generation            = 1785048890422
admission_status      = failed_permanent
work_lifecycle_status = active
last_error_code       = LARK_PREFLIGHT_FAILED
failed_table          = RAW_Ads_Daily
failed_field          = metric_date
failed_value_shape    = YYYY-MM-DD
```

Sanitized runtime evidence:

```text
Lark preflight failed: raw_ads_daily_key=google_ads:5662332033:campaign:23664394265:2026-06-26:all:all,
field=metric_date: Lark field metric_date must be a valid ISO-8601 date-time with an explicit timezone
```

The incident is non-partial: destination preflight runs before D1 and Lark business phases, and the
verified business row counts remain zero.

## Root causes

### 1. Lark DateTime serialization mismatch

`buildGoogleAdsLarkWriteSet()` forwarded Google Ads `metricDate` as the source date-only string
`YYYY-MM-DD` into both Shared RAW and Canonical Lark daily rows. The live Lark fields are DateTime
fields and the shared serializer intentionally accepts only epoch values or ISO-8601 instants with
an explicit timezone.

The D1 daily-fact contract and every stable key correctly use the date-only source value and remain
unchanged.

### 2. Failed-permanent exact redrive state mismatch

`D1GoogleAdsLiveAdmissionStore.markFailed()` stores `completed_at` for `failed_permanent` as terminal
failure evidence. `D1GoogleAdsLiveRedriveStore.prepare()` declared `failed_permanent` eligible but its
SQL required admission `completed_at IS NULL`, so the exact incident could not be revived through the
reviewed same-generation redrive path.

## Objective

Repair the two source defects so the exact staged LIVE run can later be redriven from its retained
DLQ reference without running Google Ads Manager Script again, while preserving source dates,
stable keys, same-generation identity, payload retention guards and all completed/superseded safety
fences.

## Implemented scope

1. Convert Google Ads date-only `metricDate` to epoch milliseconds at local midnight in
   `run.sourceTimezone` for Lark DateTime fields only.
2. Apply the conversion to:
   - `raw.daily[].metric_date`;
   - `canonical.daily[].metric_date`.
3. Preserve date-only values in:
   - D1 `ads_daily_facts.metric_date`;
   - RAW and Canonical stable keys;
   - Coverage identities and report period bounds;
   - source payload JSON.
4. Permit controlled exact redrive from `failed_permanent` when:
   - admission and Work identities match exactly;
   - Work is same-generation `terminal` or `active` and not completed/superseded;
   - no active lock exists;
   - staged transport run and chunk payloads remain available and unredacted.
5. On successful redrive preparation:
   - revive Work to `active`;
   - move admission to `send_pending`;
   - clear terminal admission `completed_at` and `last_error_code`;
   - increment `send_attempts` once only;
   - retain exact original Queue reference and generation.
6. Add focused tests for date serialization, failed-permanent redrive with non-null
   `completed_at`, idempotent prepare and fail-closed payload availability.
7. Update Current Task, Project Brain module and CHANGELOG with sanitized implementation evidence.

## Out of scope

- Remote D1 mutation, manual SQL repair or staged-payload edits;
- Queue send, DLQ redrive or any real Worker invocation;
- Lark Schema/View/Formula changes or changing DateTime fields to Text;
- Google Ads Manager Script rerun;
- Google Ads campaign, ad, bid, budget or spend mutation;
- schedule activation;
- Production deployment or cutover;
- deleting or closing forensic DLQ/alert evidence.

## Contracts

### Lark metric date

For each source `metricDate=YYYY-MM-DD`:

```text
lark_metric_date = local midnight of YYYY-MM-DD in run.sourceTimezone, expressed as epoch ms
```

Example:

```text
source date       = 2026-07-24
source timezone   = Asia/Bangkok
Lark epoch ms     = 1784826000000
UTC instant       = 2026-07-23T17:00:00.000Z
```

Stable keys continue to contain `2026-07-24`, not the epoch value.

### Failed-permanent redrive

The redrive store fails closed when any of these is true:

- admission or Work is completed;
- Work is superseded;
- generation/work identity drifts;
- active lock exists;
- admission payload has been redacted;
- transport run payload has been redacted;
- any staged chunk payload is unavailable;
- staged run is incomplete.

No generic reopening of arbitrary terminal jobs is authorized.

## Acceptance result

- Shared RAW and Canonical Lark daily rows contain identical epoch-millisecond `metric_date` values
  resolved from the signed source timezone: PASS.
- D1 daily facts and all stable keys retain the original date-only value: PASS.
- Fixture `2026-07-24` / `Asia/Bangkok` resolves to `1784826000000`: PASS.
- `failed_permanent` with non-null admission `completed_at` becomes `send_pending`, clears
  `completed_at`, clears `last_error_code` and increments attempts exactly once: PASS.
- Repeated prepare before Queue mark remains idempotent: PASS.
- Redacted or unavailable staged payload fails closed without state mutation: PASS.
- Completed, superseded, active-lock and identity-drift guards continue to pass: PASS.
- No Remote D1, Cloudflare, Queue, Lark, schedule or Production action occurred: PASS.

## Implementation result

```text
STATUS                   = READY_FOR_REPOSITORY_REVIEW
BRANCH                   = work/google-ads-live-lark-date-redrive-hotfix
PR                       = #61 / DRAFT
REVIEWED_SOURCE_HEAD     = ca07b6033e4d306258702227154405298dddcc90
BRANCH_VERIFICATION      = PASS / RUN_492
FILES_CHANGED            = 7
FOCUSED_TIKTOK_TESTS     = 4 / 4 PASS
NODE_UNIT_INTEGRATION    = 822 / 822 PASS
WORKERS_RUNTIME_TESTS    = 9 / 9 PASS
REPORT_RELIABILITY       = 70 / 70 PASS
DEPENDENCY_AUDIT         = 0 vulnerabilities
WRANGLER_DRY_RUN         = PASS
REMOTE_ACTIONS           = none
REMAINING_RISK           = exact staged incident redrive blocked until review, merge and guarded rollout
```

Changed files:

```text
CHANGELOG.md
docs/current-task.md
docs/project-brain/google-ads-manager-script-live-path.md
packages/application/src/google-ads/google-ads-live-run.js
packages/connectors/src/google-ads/d1-google-ads-live-redrive-store.js
tests/application/google-ads-live-run.test.js
tests/google-ads/d1-google-ads-live-redrive-store.test.js
```

## Runtime hold boundary

Until this hotfix is reviewed, merged and deployed through a separately guarded operator step:

```text
Google Ads Script          DRY_RUN / delivery=false
API Google Ads flags       false
Sync Google Ads flags      false
Google Ads schedules       false
Incident DLQ               open / retained
Staged transport payload   retained / do not edit or delete
Exact redrive              prohibited
Production                 blocked
```
