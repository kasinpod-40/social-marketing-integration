# Meta Ads Report Entity Bind Chunk Hotfix v1

Date: `2026-08-05`

## Objective

Bound the Shared Paid Ads entity-hydration query after the exact Meta Ads 3D recovery produced six
`D1_ADS_REPORT_READ_FAILED` Sync Runs and no materialization. Preserve the explicit minimum D1 projections already
merged through PR #512.

## Defect

`D1AdsReportSource` derives sorted unique Ad IDs from reviewed ranking facts and previously placed every ID into one
`external_entity_id IN (...)` query. That statement also binds `customer_key`, `platform` and `account_key`.

The Repository's reviewed D1 boundary is 100 total parameters, so entity queries must reserve three fixed bindings
and contain at most 97 IDs. The old query was unbounded by ID count.

## Correction

- split unique sorted IDs into immutable 97-ID chunks;
- execute chunks sequentially to avoid unbounded concurrency;
- retain explicit projected entity fields only;
- merge all returned rows into the same identity map;
- preserve Top Ads sorting, metrics and missing-name behavior;
- record `entityQueryCount` and `entityQueryMaxIds=97` in the existing read summary.

## Runtime incident retained

```text
Report ID          integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
Failed runs        6
Error              D1_ADS_REPORT_READ_FAILED
Materialization    0
Original DLQ       terminal:e408707c9c2d383e04a3e213a7be45a0
New DLQ            dlq:2f292f08f5bdc4f12c91b68ceff71e1b
Work/Lock          0 / 0
Baseline           restored Notification Runtime
```

This repository defect is confirmed. Its role as the exact live failure root remains pending one SELECT-only unique-Ad
count because persisted Sync Run output retained only the Shared read wrapper code, not the underlying D1 message.

## Recovery boundary

Neither DLQ may be redriven or closed by this branch. No Queue message may be sent. After merge, a SELECT-only
inspector must count unique ranking Ads and bind the exact new DLQ message/payload/operation metadata. Any subsequent
continuation must use the existing exact recovery architecture and must not repeat the failed evidence root.

## Acceptance criteria

- 97 or fewer IDs use one query;
- 98 IDs use two queries with total binding counts `100` and `4`;
- no query exceeds 100 bindings;
- all 98 entities remain available to Top Ads;
- existing Meta and Google Ads regressions pass;
- full Repository and Report reliability gates pass;
- Remote action count remains zero;
- Notification Admission, Schedule and Production remain disabled.
