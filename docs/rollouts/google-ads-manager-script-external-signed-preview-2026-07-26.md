# Google Ads Manager Script External Signed PREVIEW Closeout — 2026-07-26

## Result

```text
SOURCE_BASELINE            = PR #55 / 4008b991e9aba2309691b733caccd7613f2ad2a8
SECRET_PROVISIONING        = PASS / CONFIRMED
EXTERNAL_MANAGER_SCRIPT    = PASS
TRANSPORT_RUN              = PREVIEW_VALIDATED
DATASETS                   = 6 / 6
CHUNKS                     = 7 / 7
ROWS                       = 1375 / 1375
PAYLOAD_REDACTION          = PASS
BUSINESS_QUEUE_LARK_DRIFT  = ZERO
FINAL_SIGNED_INGRESS       = DISABLED / 404
FINAL_PROVISIONING_ROUTE   = DISABLED / 404
FINAL_BUSINESS_WRITES      = DISABLED
FINAL_SCRIPT_PROPERTIES    = DRY_RUN / DELIVERY_FALSE
FINAL_GOOGLE_ADS_SCRIPT    = CLEAN_REPOSITORY_ARTIFACT_RESTORED
SCHEDULE_LIVE_PRODUCTION   = DISABLED
```

This closeout proves the actual Google Ads Manager Script, including `AdsApp`,
`AdsManagerApp`, GAQL result mapping, Script Properties, HMAC signing and
`UrlFetchApp`, against the deployed PREVIEW-only API Worker boundary. It does
not authorize Queue admission, Sync Worker processing, Ads Business writes,
Lark writes, schedules, LIVE delivery or Production.

## One-time Signing Secret provisioning

Migration `0014_google_ads_signing_secret_provisioning.sql` had already been
applied to the Integration Workspace and the provisioning endpoint was deployed
safe-closed. The approved operator window then:

- enabled only `MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED` temporarily;
- kept the Google Ads Connector, signed ingress and Business writer disabled;
- created one five-minute capability Ticket with fingerprint-only D1 storage;
- redeemed and confirmed the Ticket from the actual Manager Script;
- wrote only `MKT_GOOGLE_ADS_SIGNING_KEY_ID` and
  `MKT_GOOGLE_ADS_SIGNING_SECRET` into Script Properties;
- restored the provisioning route to disabled / `404`;
- verified zero Business/transport drift and cleared the temporary helper and
  clipboard.

Sanitized operator evidence remains ignored outside Git:

```text
outputs/google-ads-provisioning-only-v3-20260725T174852Z
```

No Ticket, signing Secret, challenge, proof or raw identity value is recorded in
this document or Repository.

## External Signed PREVIEW

The PREVIEW window used the clean Repository Manager Script artifact with a
temporary wrapper that set only these Script Properties for one run:

```text
MKT_GOOGLE_ADS_MODE=PREVIEW
MKT_GOOGLE_ADS_DELIVERY_ENABLED=true
MKT_GOOGLE_ADS_DELIVERY_ENDPOINT=<approved Worker delivery endpoint>
```

The API Worker window enabled only signed ingress. Provisioning, Connector and
Business-write flags remained disabled. The actual Manager Script selected the
allowlisted advertiser, read six bounded GAQL datasets, created seven signed
chunks and delivered all 1,375 rows through `UrlFetchApp`.

Verified transport outcome:

```text
run status                 preview_validated
datasets                   6 / 6
chunks                     7 / 7
rows                       1375 / 1375
payload redaction          all staged payloads redacted
business facts             unchanged
Queue / DLQ / alerts       unchanged
Lark writes                0
Google Ads mutations       0
```

The six reconciled datasets were:

1. `account`
2. `campaigns`
3. `adGroups`
4. `ads`
5. `youtubeAssets`
6. `campaignDailyMetrics`

Sanitized operator evidence remains ignored outside Git:

```text
outputs/google-ads-external-signed-preview-20260725T182311Z
```

## Final safe state

After PREVIEW, the operator redeployed the safe-closed API config and verified:

```text
GET /health                                           200
POST /v1/google-ads/manager-script/deliveries         404
POST /v1/google-ads/manager-script/signing-secret/*   404
```

The temporary Script Properties were reset to `DRY_RUN` and delivery `false`,
the temporary endpoint property was removed, the clean signed-delivery Script
was restored, and temporary clipboard/helper files were cleared. The signing
Key ID and Secret remain only in Script Properties for a separately approved
future gate.

## Scope boundary retained

The following remain disabled or unimplemented:

- Google Ads Connector activation;
- reference-only Queue admission and Sync Worker processing;
- D1 Ads Business writers and Canonical normalization;
- Shared RAW and Lark writes;
- reconciliation/Coverage UAT for Business facts;
- schedules;
- LIVE delivery;
- Production.

The next separately approved implementation boundary is Local reference-only
Queue admission. It must consume only completed authenticated transport
references, reuse the central Job/Queue/Reliability contracts, and keep every
Business writer, Lark write, schedule, LIVE and Production gate disabled.
