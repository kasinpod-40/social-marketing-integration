# Meta Ads D1 Report Projection & Exact Recovery Continuation v1

Date: `2026-08-05`

## Objective

Fix the existing Shared Paid Ads D1 reader after the exact Meta Ads 3D recovery job reached the Worker six times but
every run failed at the D1 source-read boundary. Keep both retained DLQs open and prepare an exact continuation only
after the repository correction is merged and the new DLQ identity is fully inspected.

## Runtime evidence

```text
Merged main             5b35861553d2a3074409635458d323b33641d994
Platform                meta_ads
Window                  3D
Period                  2026-07-29 through 2026-07-31
Report ID               integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
Recovery requested-at   1785938483493
Failed Sync Runs        6
Error                   D1_ADS_REPORT_READ_FAILED
Materialization         0
Active Work/Lock        0 / 0
Original DLQ            terminal:e408707c9c2d383e04a3e213a7be45a0
New DLQ                 dlq:2f292f08f5bdc4f12c91b68ceff71e1b
Worker baseline         restored Notification Runtime
```

No Provider request occurred. Notification Admission, Schedule and Production remained disabled.

## Repository finding

`D1AdsReportSource` used broad `SELECT *` reads for detailed facts, entities and Coverage. The detailed fact table
contains retained payload fields including `actions_json` and `breakdown_json`, each allowed up to 64 KiB, while the
Report calculation consumes only scalar identity and metric columns.

The repository correction replaces broad reads with explicit minimum projections while preserving:

- account/platform/date/report-level filters;
- bounded `LIMIT + 1` overflow detection;
- deterministic ordering;
- duplicate Stable identity rejection;
- Meta publisher-platform partition aggregation;
- Google campaign all/all aggregation;
- SUM-before-ratio metric semantics;
- deterministic Top Ads ordering;
- Coverage and null/zero behavior.

## Root-cause confidence

The projection defect is the leading hypothesis because:

- Meta Ads 1D completed under the same reader;
- Meta Ads 3D failed deterministically six times;
- all failures occurred before materialization and Lark write;
- no active Work/Lock remained;
- the 3D read can return materially more detailed rows and retained JSON bytes than 1D.

It is not yet marked proven. Post-merge SELECT-only row/byte evidence or a successful exact continuation must confirm
the diagnosis.

## Exact continuation rules

The prior recovery evidence root is immutable. The continuation must not rerun it.

Before another Queue message, bind the new DLQ to:

- exact DLQ and message identity;
- exact replay-payload hash;
- exact platform, period, report setting and original job requested-at;
- exact operation metadata, historical work key and generation;
- exact main/DLQ attempt counters;
- zero target D1/Lark materialization and zero active Work/Lock.

After the repository fix merges, the continuation may submit the exact original job once under the reviewed Active
Report Worker. It must fail closed on any identity drift. A successful first materialization, exact replay, baseline
restore and both forensic DLQ closures remain separately verified stages.

## Forbidden actions

- rerun the failed exact recovery root;
- rerun Run All or its retained handoff;
- generic Queue resend or generic DLQ redrive;
- edit or delete either DLQ;
- change Report ID/requested-at/period/source watermark;
- manually insert D1/Lark Report rows;
- refresh Meta Provider facts;
- enable Notification Admission, Schedule or Production.

## Acceptance criteria

- no `SELECT *` remains in the Shared Paid Ads D1 reader;
- retained large JSON/payload fields are absent from Report fact queries;
- entity and Coverage projections contain only consumed fields;
- Meta and Google Ads focused tests pass;
- full Repository and Report reliability gates pass;
- repository implementation performs zero Remote action;
- exact continuation remains blocked until post-merge identity inspection.
