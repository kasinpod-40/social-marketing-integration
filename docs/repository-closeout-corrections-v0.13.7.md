# Repository Closeout Corrections v0.13.7

## Scope

This document records corrections found during the repository-wide review after the Lark Formula/View and Google Ads read-only UAT closeout.

Target branch: `work/repository-closeout-corrections`

No Live Lark, Google Ads, Cloudflare, Queue, D1, Schedule or Production mutation is part of this correction.

## Corrected facts

### Google Ads direct API access

- Basic Access application submitted: `2026-07-21`
- Case ID: `1-686800040839`
- Cloud project number: `788131774873`
- Review status: `pending`
- Current developer-token level: `Test Account Access`
- Manager Script MVP does not require the direct API approval.

Older statements saying no application was submitted are superseded.

### Lark View interpretation

The 133 Views are classified as:

- Shared-table managed: `17`
- Report managed: `6`
- Google Ads managed: `19`
- All/default intentionally unfiltered: `36`
- Legacy specialized preserved without inferred business logic: `55`

The 42 filtered Views are exactly `17 + 6 + 19`.

The 55 legacy specialized Views are not claimed to implement business meanings implied by their names. They require a separate business-owner contract before Filter, Sort or Hidden fields are changed.

### Google Ads RAW error coverage

The current 13 RAW error Views check only the table-specific primary raw stable key with `isEmpty`.

This is an identity-key QA minimum. It is not comprehensive validation of customer IDs, entity IDs, statuses, report level, segment key or policy state.

## Code safety correction

The Google Ads View filter command is update-only.

Added:

- `packages/config/src/google-ads-view-filter-apply-guard.js`
- `tests/config/google-ads-view-filter-apply-guard.test.js`

Changed:

- `scripts/setup-google-ads-view-filters.mjs`

Behavior:

- zero-drift and `update_view` plans are allowed;
- any `create_view` or other action kind is blocked with `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN`;
- Apply validates the read-only Preview before mutation;
- final verification is checked again;
- no View creation, deletion or rename is permitted by this command.

## Manager Script evidence boundary

The repository documents the 598-line safety review and Live Preview result, but does not contain the complete sanitized Script source.

Current reproducible evidence:

- exact UAT outcome;
- six-dataset inventory;
- runtime-incompatible fields removed;
- nullable mapping behavior;
- zero Ads changes;
- no schedule/external delivery;
- signed delivery remains a separate task.

Before a future delivery connector release, add either:

1. a sanitized immutable Script snapshot with customer identity removed; or
2. an exact source SHA-256 plus query-field/output manifests and a safety-scan report tied to that hash.

## Application versus contract versions

- Root application package version: `0.11.0`
- v0.13.5: Google Ads View contract/tool revision
- v0.13.6: Formula UI contract revision
- v0.13.7: Repository correction revision

These v0.13.x labels do not by themselves represent a deployed application release.

## Required verification before merge

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
```

Focused expectation:

- Google Ads update-only guard tests pass;
- existing report View create behavior remains available for the report installer;
- Google Ads wrapper blocks missing managed Views before Apply;
- no runtime connector or deployment behavior changes.
