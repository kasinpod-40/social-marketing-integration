# Google Ads Manager Script Evidence v0.13.7

## Status

- **Evidence type:** read-only UAT outcome and safety manifest
- **Live target:** customer-authorized Chemistry K advertiser under the intended manager
- **Google Ads changes:** none
- **Schedule:** disabled (`Frequency —`)
- **External delivery:** absent
- **Repository Script snapshot:** not yet included

## Verified UAT outcome

- Target advertiser was enabled and selectable.
- Exact allowlist selected the intended account.
- Script used `AdsManagerApp` and `AdsApp.search()` GAQL.
- Final status: `data_available`.
- Dataset success: `6/6`.
- Dataset errors: `0`.
- Truncation: `0`.
- Samples remained bounded by configured caps.
- Google Ads Preview showed `No changes`.

## Dataset manifest

The read-only Preview returned bounded data for:

1. account/customer;
2. campaigns;
3. ad groups;
4. ads;
5. YouTube/video assets;
6. campaign daily performance.

The signed-delivery task must lock exact payload names, field schemas, null semantics, stable keys and schema version before any endpoint is implemented.

## Runtime compatibility finding

The Google Ads Scripts runtime rejected:

- `campaign.start_date`
- `campaign.end_date`

with `QueryError.UNRECOGNIZED_FIELD`.

Those request fields were removed. Output mappers preserve the fields as nullable and return `null`; no value is fabricated.

## Safety scan record

The reviewed Script was reported as 598 lines and contained read-only GAQL/logging paths. The review found no:

- campaign/ad/budget mutation;
- pause/enable/remove;
- campaign builders;
- `UrlFetchApp`;
- Spreadsheet or Mail delivery;
- external destination write.

## Reproducibility limitation

The complete sanitized 598-line source is not committed in this repository. Therefore this file records the verified UAT result and safety manifest, but does not allow a new reviewer to reproduce the complete source-level scan from Git alone.

Before the signed delivery connector is released, add one of:

### Option A — sanitized source snapshot

Commit an immutable copy with:

- customer IDs replaced by placeholders;
- no secret/token material;
- exact dataset queries and output mapping retained;
- SHA-256 recorded here.

### Option B — external source hash evidence

Record:

- exact Script source SHA-256;
- query-field manifest;
- output field manifest;
- allowlist/config manifest without customer identity;
- safety-scan command/report tied to the same hash.

## Access status correction

- Basic Access application submitted: `2026-07-21`
- Case ID: `1-686800040839`
- Cloud project number: `788131774873`
- Review: pending
- Current direct API level: Test Account Access

Manager Script MVP remains usable independently of direct API approval.

## Out of scope

- signed delivery endpoint;
- HMAC/replay contract;
- Worker/Queue/D1/Lark destination writes;
- schedule activation;
- deployment;
- Production.
