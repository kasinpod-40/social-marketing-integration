# Google Ads Signed-delivery Phase 2 Remote Transport UAT — 2026-07-25

## Result

```text
SOURCE_MERGE             = PR #52 / e317fb9
REMOTE_MIGRATION_0013    = APPLIED
API_WORKER               = DEPLOYED
SIGNED_PREVIEW           = PASS
EXACT_RETRY              = PASS
NONCE_REPLAY             = REJECTED
PAYLOAD_REDACTION        = PASS
BUSINESS_QUEUE_DRIFT     = ZERO
FINAL_SIGNED_INGRESS     = DISABLED
BUSINESS_WRITES          = DISABLED
SCHEDULES                = DISABLED
PRODUCTION               = BLOCKED
```

This rollout proves the deployed signed transport with a contract-equivalent
client. It does not yet prove Google Ads Manager Script `AdsApp`, GAQL result
shape or `UrlFetchApp` compatibility.

## Backup and rollback evidence

Before migration, Wrangler captured a Time Travel recovery point and exported
the complete Remote D1 database:

```text
backup_file   = social-mkt-state-dev-pre-0013.sql
backup_bytes  = 503743626
backup_sha256 = 4d84fd74b37cbcc9d01b36bfd1f6269c27f457ffae10ac53336028983fadac11
```

The export imported into a fresh Local SQLite database, passed
`PRAGMA integrity_check=ok` and reproduced every pre-migration row count.
Ignored operator artifacts remain under:

```text
outputs/google-ads-signed-delivery-rollout-20260725/
```

## Migration verification

- Preflight showed exactly one pending migration:
  `0013_google_ads_signed_delivery_transport.sql`.
- Wrangler applied all eight SQL statements successfully.
- Post-apply migration listing returned no pending migrations.
- Three transport tables and four explicit transport indexes exist.
- New Nonce/Run/Chunk tables were empty before PREVIEW.
- Every pre-existing Business/Queue evidence count matched its baseline.

The first automation attempt supplied unsupported `--yes`; Wrangler rejected
the argument before any Remote write. The exact interactive migration then
applied successfully after displaying only Migration `0013`.

## Deployment and HTTP smoke

`social-mkt-api-worker` was created with the Integration Workspace D1/Queue
bindings. Initial deployment kept all Google Ads flags `false`.

The first HTTP probe during edge propagation returned Cloudflare code `1042`
before reaching the Worker. Deployment inspection was healthy; the retry passed:

```text
GET /health                                      = 200
POST /v1/google-ads/manager-script/deliveries    = 404 while disabled
health identity exposure                         = false
```

## Signed PREVIEW proof

The signing Secret was generated without terminal output, uploaded to
Cloudflare Secret storage and read by the test client from a mode-`600`
temporary file. Signed ingress was enabled only with:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED=false
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED=true
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED=false
```

Sanitized outcomes:

```text
first PREVIEW       = 200 / preview_validated / staged
exact retry         = 200 / preview_validated / exact_retry
same nonce replay   = 409 / GOOGLE_ADS_DELIVERY_NONCE_REPLAYED
received chunks     = 1 / expected 1
received rows       = 1 / expected 1
```

Post-PREVIEW D1 evidence:

```text
nonce fingerprints       = 2
runs                     = 1
preview_validated runs   = 1
chunks                   = 1
unredacted payloads      = 0
redacted chunks          = 1
Ads entity/daily facts   = 0 / 0
Queue/business drift     = 0
```

## Final safe state

Signed ingress was restored to `false` and redeployed. Final verification:

```text
GET /health                                      = 200
POST /v1/google-ads/manager-script/deliveries    = 404
Connector / Signed ingress / Business write      = false / false / false
final Worker version                             = bdcb152f-92e3-4f52-b357-204aac3e090b
```

The Local temporary signing-secret file was deleted. The Cloudflare Secret
remains stored for a separately approved future PREVIEW; no value appears in
Source, logs, health responses or evidence.

## Remaining gates

1. Review and merge this sanitized Closeout.
2. Run an actual Google Ads Manager Script external PREVIEW with Secret kept in
   Script Properties only.
3. Prove all six read-only GAQL datasets and `UrlFetchApp` signing compatibility.
4. Restore Signed ingress to `false`.
5. Only then consider Local reference-only Queue admission.

Queue processing, Business writers, D1 Ads facts, Lark writes, LIVE mode,
schedules and Production remain unimplemented or disabled.
