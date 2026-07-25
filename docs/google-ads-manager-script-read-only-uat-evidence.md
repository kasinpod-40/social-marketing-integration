# Google Ads Manager Script Read-only UAT Evidence — 2026-07-22

## Evidence classification

- **Status:** `live_read_only_uat_pass`
- **Evidence level:** `documented_live_review`
- **Independently reproducible from Repository source:** `no`
- **External delivery:** disabled
- **Schedule:** disabled
- **Ads mutations:** none observed

ไฟล์นี้เก็บหลักฐานแบบ sanitized โดยไม่ Commit Customer ID, Token, OAuth credential หรือ Script source ที่มี customer-specific allowlist.

## Live target and access

- Authorized Chemistry K advertiser appeared `Enabled` under the intended manager.
- Account selection and Overview access passed.
- Manager Script executed under the manager account and selected only the approved advertiser allowlist.
- Current developer-token level remains `Test Account Access`.
- Direct Google Ads API Basic Access application was submitted on `2026-07-21`, case `1-686800040839`, and remains pending.
- Manager Script MVP does not depend on direct API approval.

## Reviewed Script characteristics

The reviewed Script was reported as 598 lines and used:

- `AdsManagerApp` for manager-account selection;
- `AdsApp.search()` for read-only GAQL;
- bounded logging and sample caps.

The live review reported no occurrence of:

- Campaign/Ad/Budget create or update;
- pause/enable/remove;
- campaign builder operations;
- `UrlFetchApp`;
- Spreadsheet or Mail delivery;
- external webhook delivery.

Because the sanitized Script source is not committed, these claims are retained as reviewed evidence and must not be presented as a reproducible Repository source audit.

## Dataset manifest

Final Preview returned six non-empty bounded datasets:

1. account;
2. campaigns;
3. ad groups;
4. ads;
5. YouTube assets;
6. campaign daily metrics.

Output contract keeps unsupported/missing values as `null`; it does not fabricate zero.

## Runtime discovery

First Preview failed closed because the Google Ads Scripts runtime rejected:

- `campaign.start_date`
- `campaign.end_date`

Both fields were removed from GAQL request selection while nullable output mapping was retained.

## Final Preview result

```text
status              data_available
datasets successful 6/6
datasets non-empty  6/6
dataset errors      0
truncation          0
Google Ads changes  No changes
Frequency           —
external delivery   disabled
```

## Safety boundary

This UAT proves only that the authorized Manager Script can read bounded real account data without changing Ads.

It does not prove or authorize:

- signed external delivery;
- Worker ingress;
- Queue/DLQ processing;
- D1 replay/idempotency state;
- Lark destination writes;
- Schedule activation;
- UAT/Production deployment.

## Reproducibility requirement before signed delivery

The next connector task must add at least one sanitized immutable artifact:

- reviewed Script source snapshot with customer-specific values replaced by placeholders; or
- SHA-256 of the reviewed Script plus exact GAQL field manifest, dataset schema, version and safety scan report.

The artifact must not contain Customer ID, token, secret, login identity or raw sample rows.

## Reproducible sanitized artifact validation — 2026-07-25

The committed sanitized Script artifact was later copied exactly into the
Google Ads Manager Script and run again in `DRY_RUN`. Authorization passed.
Two fail-closed GAQL compatibility drifts were corrected:

- `asset.status` was removed and the output keeps `youtubeAssets.status=null`;
- legacy video metrics were replaced with v24
  `video_trueview_views`, `video_trueview_view_rate` and
  `trueview_average_cpv`.

The final external DRY_RUN passed all six non-empty datasets, planned seven
chunks, reported `truncated=false` and showed `No changes`. Delivery remained
disabled and no Secret or `UrlFetchApp` call was required.

Current sanitized evidence:

`docs/rollouts/google-ads-manager-script-external-dry-run-2026-07-25.md`
