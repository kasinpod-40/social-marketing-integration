# Google Ads Manager Script LIVE UAT Closeout — 2026-07-26

## Decision

The guarded Google Ads Manager Script signed-delivery LIVE UAT for the Integration Workspace is
complete and safely closed.

```text
run_id                    88351cb4-714d-49ef-91db-d95550a93ebf
work_key                  google_ads:88351cb4-714d-49ef-91db-d95550a93ebf
generation                1785048890422
mode                      LIVE
transport                 7 / 7 chunks, 1375 / 1375 rows
admission                 completed
send_attempts             4
work lifecycle            completed
ads_entity_state          1090 rows
ads_daily_facts           285 rows
coverage                  6 / 6 complete, failed rows 0
payload redaction         transport PASS / admission PASS
operator verify           PASS
safe Worker version       dcee150f-34cc-4a6f-aafa-5b52ece44093
schedule                  disabled
Production                blocked
```

## Runtime lineage

The completed run is the original signed LIVE transport. Recovery reused its retained durable staged
payload and did not rerun the Manager Script.

The runtime crossed three fail-closed boundaries:

```text
#61  RAW daily DateTime serialization
#62  Canonical Ads v2 Lark field aliases
#63  Campaign / Ad Group / Creative routing keys
```

Each source correction was reviewed and merged before the corresponding exact redrive. The completed
run preserves the original generation and source counts.

## Retained terminal evidence

```text
terminal:a6ed54413000c25efd73ce7888cc2d10  redriven
terminal:6b1c7a5142f1eedb12a2b40b0a7cba78  redriven
terminal:f909996a2e4985697f3e67feacfe7c69  redriven
```

These records are immutable forensic evidence for the incident. No future delete, cleanup, redrive or
reuse is authorized.

## Durable processing result

Destination preflight completed for all eight configured Lark destinations. D1 business processing
completed `2756 / 2756` durable operations. Coverage reconciled the six signed datasets:

```text
account                    1
campaigns                 58
adGroups                 110
ads                      760
youtubeAssets            161
campaignDailyMetrics     285
TOTAL                   1375
```

The final guarded operator accepted the reconciliation row with:

```text
expected chunks = received chunks = 7
expected rows   = received rows   = 1375
admission status                  = completed
work lifecycle                    = completed
coverage rows                     = 6
transport payload redacted        = true
admission payload redacted        = true
```

The persisted transport status remains `assembling`; it is informational in this completed incident
because exact chunk/row counts, payload redaction, admission completion, durable work completion and
Coverage all passed the authoritative verification gate.

## Final safety state

The bounded Recovery Window is closed. The normal Sync Worker configuration is deployed with all
Google Ads execution and redrive flags disabled:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=false
MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED=false
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
MKT_GOOGLE_ADS_LARK_WRITE_ENABLED=false
MKT_DLQ_REDRIVE_ENABLED=false
MKT_SCHEDULE_GOOGLE_ADS_ENABLED=false
```

The Manager Script remains `DRY_RUN` with delivery disabled. Shared Worker Cron triggers may remain,
but they cannot start Google Ads while its schedule and Connector gates are false.

## Architecture meaning

This UAT validates the reviewed primary ingestion path:

```text
Google Ads Manager Script
→ signed HMAC transport
→ durable staged D1 transport
→ reference-only Queue
→ resumable D1 Ads facts and Coverage
→ Shared RAW Ads Lark tables
→ Canonical Ads Lark tables
→ payload redaction and closeout
```

It does not authorize automatic schedules, a direct Google Ads API ingestion replacement, or
Production cutover.

## Permanent boundary

- No rerun of the completed LIVE Manager Script delivery.
- No redrive or deletion of the three incident terminal records.
- No reopening the applied Lark Ads v2 Schema/View/Formula contract for these incidents.
- No Google Ads execution flag or schedule activation without a separately approved task.
- Production must use customer-owned Cloudflare, D1, Queue, Lark, credentials and platform assets.
