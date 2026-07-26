# Changelog

## Unreleased — Google Ads Lark Key-Field Contract Hotfix — 2026-07-26

### Runtime incident

- Confirmed the third controlled processing attempt passed the prior Lark DateTime
  and Canonical Ads v2 field-name defects.
- Recorded the next fail-closed boundary before any D1 or Lark business write:
  `UNHANDLED_SYNC_ERROR: TableSyncEngine requires campaign_key`.
- Verified `send_attempts=3`, zero `ads_entity_state` rows and zero
  `ads_daily_facts` rows for the Google Ads account.
- Kept the exact new terminal DLQ ID pending read-only verification rather than
  inferring or reusing either previously redriven DLQ.

### Source correction

- Aligned the processor Campaign routing key from `campaign_key` to
  `ads_campaign_key`.
- Aligned the Ad Group routing key from `ad_group_key` to
  `ads_ad_group_key`.
- Aligned the Creative routing key from `creative_key` to
  `ads_creative_key`.
- Preserved destination order, table bindings, Canonical row payloads, D1
  contracts, stable-key values, resumable phases, continuations, reconciliation
  and retry semantics.

### Verification and safety

- Added processor-level validation that every planned row contains its configured
  non-empty stable key.
- Added the exact eight-table key-field sequence for destination preflight and
  verified one-table-per-continuation Lark writes reuse the same contract.
- Branch Verification run `#510` passed syntax/architecture/hygiene, focused
  TikTok regression, 825 Node Unit/Integration tests, 9 Workers runtime tests,
  70 report reliability tests, dependency audit and Wrangler deployment dry-run.
- No Remote D1 mutation, Queue send, DLQ redrive, Lark write/schema mutation,
  Worker deployment, Manager Script execution, schedule or Production action
  occurred in this implementation.

## Unreleased — Google Ads Canonical Lark Mapping Hotfix — 2026-07-26

### Runtime incident

- Confirmed the first exact redrive passed the prior `RAW_Ads_Daily.metric_date`
  serialization defect and reached the Canonical Ads destination preflight.
- Recorded the second fail-closed boundary at `MKT_Ads_Accounts.ads_account_id`:
  the runtime adapter emitted a pre-migration alias that does not exist in the
  already-applied Canonical Ads v2 schema.
- Retained the new terminal DLQ
  `terminal:6b1c7a5142f1eedb12a2b40b0a7cba78` as `open`; the original DLQ remains
  `redriven` forensic evidence.
- Verified the second failure remained non-partial with zero D1 Ads business rows
  and zero Lark business writes.

### Source correction

- Replaced stale Canonical field aliases across Accounts, Campaigns, Ad Groups,
  Ads, Creatives and Daily output while preserving existing stable-key values and
  all D1 contracts.
- Preserved the Canonical Campaign `objective` field when supported by the signed
  source and omitted ungrounded ownership metadata from the generic adapter.
- Normalized Google Ads source statuses to the reviewed Canonical options
  `active`, `paused`, `removed` and `unknown`.
- Normalized Search, Display, YouTube, Demand Gen, Performance Max, Shopping, App
  and fallback channels to reviewed Canonical options.
- Derive Canonical Daily channel from the Campaign source enum when the signed v1
  transport uses its legacy `google_other` fallback.
- Resolve Campaign date-only fields to source-timezone local-midnight epoch values
  for Lark DateTime fields.
- Map Google video assets to Canonical Creative identity fields and convert average
  CPV micros to the Canonical display-unit `average_cpv` field.

### Verification and safety

- Added exact per-table Canonical field allowlists and forbidden-alias regression
  assertions so stale v1 names cannot silently return.
- Added value coverage for all six Canonical destinations, stable identities,
  nullable objective, status normalization, source-timezone dates and modern
  channel normalization.
- Final Branch Verification run `#505` passed syntax/architecture/hygiene, focused
  TikTok regression, 825 Node Unit/Integration tests, 9 Workers runtime tests,
  70 report reliability tests, dependency audit and Wrangler deployment dry-run.
- No Remote D1 mutation, Queue send, DLQ redrive, Lark mutation/write, Worker
  deployment, Manager Script execution, schedule or Production action occurred in
  this implementation.

## Unreleased — Google Ads LIVE Lark Date and Failed-Permanent Redrive Hotfix — 2026-07-26

### Runtime incident

- Recorded the first guarded Manager Script LIVE run
  `88351cb4-714d-49ef-91db-d95550a93ebf` with all six datasets, seven chunks and
  1,375 rows received.
- Confirmed processing failed permanently during Lark destination preflight before
  any D1 Ads fact or Lark business write.
- Identified the exact mismatch: source `metricDate` was forwarded as `YYYY-MM-DD`
  into Lark DateTime fields that require an epoch value or ISO-8601 instant with an
  explicit timezone.

### Source correction

- Convert Google Ads Lark daily `metric_date` values to epoch milliseconds at local
  midnight in the signed source timezone.
- Preserve D1 `metric_date`, Shared RAW/Canonical stable keys, Coverage identities
  and source payload JSON as the original date-only value.
- Add guarded `failed_permanent` exact-redrive support that clears terminal admission
  `completed_at` only when the same-generation staged LIVE payload is complete and
  unredacted.
- Continue to fail closed for completed/superseded Work, active locks, identity drift,
  redacted payloads, missing chunks and incomplete run counts.

### Safety and rollout

- Retain the original DLQ reference and staged transport payload for exact recovery;
  no new Manager Script LIVE run is required.
- Keep Script delivery, API/Sync Google Ads flags and schedules disabled throughout
  implementation.
- No Remote D1 mutation, Queue send, Lark write, Worker deployment or Production
  action is part of this branch.

## Unreleased — Google Ads Manager Script LIVE Gate Hotfix — 2026-07-26

### Architecture correction

- Locked the primary Google Ads ingestion path to Manager Script signed delivery:
  `Google Ads → Manager Script → HMAC ingress → reference-only Queue → D1 → Lark`.
- Decoupled Manager Script LIVE authorization from direct Google Ads API
  developer-token approval.
- Kept `google_ads_api_access_pending` as an informational state for the optional
  future direct API path instead of a Manager Script blocker.

### Security and reliability

- Manager Script LIVE still requires connected customer consent, the exact
  `adwords` OAuth scope, an active encrypted refresh-token reference, and exact
  approved Manager/advertiser mappings.
- Existing signed-delivery HMAC, key ID, timestamp, nonce/replay, runtime identity,
  manifest completeness, payload bounds, reference-only Queue, resumable D1/Lark
  phases, reconciliation and staged-payload redaction remain unchanged.
- API-derived currency/timezone metadata is checked when present, but is not
  required while direct API access is pending because signed Script/runtime
  identity remains authoritative for the Manager Script path.

### Tests and rollout

- Added focused Unit, HTTP integration, operator and executable SQLite/D1 coverage
  for API-pending and API-validated Manager Script consent.
- Updated the guarded rollout gate and runbook so pending Developer Token access
  does not stop Remote rollout or manual LIVE UAT.
- Remote D1 backup, Migration `0015`, Worker deployment, LIVE Queue processing and
  D1/Lark business writes remain unexecuted until the protected operator environment
  is available.
- Google Ads schedule and Production remain disabled.

## Unreleased — Google Ads Secret provisioning and External Signed PREVIEW Closeout — 2026-07-26

### Runtime validation

- Completed one-time Google Ads Manager Script Signing Secret provisioning from
  the actual Manager account with a five-minute capability Ticket, exact runtime
  identity binding and HMAC confirmation.
- Confirmed the Ticket reached `confirmed`; the provisioning route was restored
  to disabled / `404` and temporary Ticket-bearing Helper/clipboard material was
  cleared.
- Ran the actual Google Ads Manager Script External Signed PREVIEW using
  `AdsApp`, `AdsManagerApp`, Google Ads API `v24`, canonical JSON, HMAC and
  `UrlFetchApp`.
- Reconciled all six datasets, seven chunks and 1,375 rows; the D1 transport Run
  reached `preview_validated` and every staged payload was redacted.
- Verified zero Ads Business fact, Queue, DLQ, alert and Lark drift and zero
  Google Ads mutation.

### Final safety state

- Restored Signed ingress and Secret provisioning routes to disabled / `404`.
- Kept Google Ads Connector and Business-write gates disabled.
- Restored Script Properties to `DRY_RUN` and delivery `false`, removed the
  temporary delivery endpoint property and restored the clean Repository Script.
- Kept Queue admission, Sync Worker Business processing, D1 Ads facts, Shared
  RAW/Lark writes, schedules, LIVE and Production outside this Closeout.
- Recorded sanitized evidence in
  `docs/rollouts/google-ads-manager-script-external-signed-preview-2026-07-26.md`.

### Documentation

- Updated Current Task, Project Brain, Current State and Next Actions for the
  completed safe-closed runtime gates.
- Preserved the full prior Current Task and Changelog records verbatim under
  `docs/archive/` before replacing the active files with current concise
  authorities.
- The next separately approved implementation boundary is Local reference-only
  Queue admission from completed authenticated transport references only.

## Historical changelog

The complete Changelog through `2026-07-25` is preserved verbatim at:

```text
docs/archive/CHANGELOG-before-google-ads-external-preview-closeout.md
```

That archive remains immutable historical evidence. New entries continue in
this active `CHANGELOG.md`.
