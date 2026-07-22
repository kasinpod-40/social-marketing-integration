# Current Task — Repository Audit Corrections v0.13.7

## Status

- **Task status:** `ready_for_merge`
- **Environment:** source-only correction branch
- **Target profile:** none; no Runtime execution
- **Branch:** `work/repository-audit-corrections-2026-07-22`
- **Base commit:** `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- **Verification commit:** `edd0ad2de3901b64a06c7f2b5f832fb2126ba8f3`
- **Verification workflow:** Branch Verification run `170` / `29933315983`
- **Live Lark mutation:** none
- **Google Ads mutation:** none
- **Worker/Queue/D1/Schedule:** unchanged
- **Deployment:** none
- **Production mutation:** none
- **Last updated:** `2026-07-22`

Repository audit found that the Live Lark closeout and Google Ads read-only UAT were valid, but documentation contained stale/conflicting state and the Google Ads View command did not enforce its documented update-only scope at code level. This task corrects those gaps before the signed delivery connector starts.

Full correction record: `docs/repository-audit-corrections-v0.13.7.md`.

## Verified current baseline

### Repository

- Main commit before this correction: `ddd876c3670af0dc6a4748b5399a1ac5acfe6642`
- Application package line: `0.11.0`
- Lark contract versions: `v0.13.5` View filters, `v0.13.6` Formula UI, `v0.13.7` repository correction
- Dependency lock refreshed after adding the patched `sharp` override

### Lark DEV

Fresh `Social MKT Data Hub(11).base` configuration-only audit:

- Physical tables: `42`
- Fields: `737`
- Views: `133`
- Filtered Views: `42`
- Sorted Views: `6`
- Views with hidden fields: `7`
- Duplicate table names: `0`
- Table emoji/folder placement: `42/42`
- View emoji names: `133/133`
- Formula fields: `4/4`
- Google Ads managed filters: `19/19`
- Shared-table managed filters: `17/17`
- Report Views: `6/6`
- Google Ads Daily 30D: `platform=google_ads AND metric_date=TheLastMonth`
- New Google RAW/AssetGroups records: `0`

Do not rerun Lark View Apply or Formula UI work.

### View contract interpretation

133 Views are classified as:

- `17` Shared-table managed Views;
- `6` Report managed Views;
- `19` Google Ads managed Views;
- `36` All/default baseline Views intentionally unfiltered;
- `55` legacy specialized Views preserved without inferred business rules.

“Full View contract” means every View is either managed or explicitly preserved. It does not mean the 55 specialized Views have business filters matching names such as Active, Failed, Latest or Connection Issues. A separate business-owner contract is required before changing those Views.

### Google Ads access and read-only UAT

- Customer-authorized advertiser link/selectability: `PASS`
- Manager Script read-only Preview: `PASS`
- Dataset result: `data_available`, `6/6` non-empty, errors/truncation `0/0`
- Google Ads changes: `No changes`
- Script Frequency: `—`
- External delivery: disabled
- Current direct API level: `Test Account Access`
- Basic Access application: submitted `2026-07-21`, case `1-686800040839`, review pending
- Direct API remains optional Phase 2 and does not block Manager Script MVP

Sanitized evidence and reproducibility boundary: `docs/google-ads-manager-script-read-only-uat-evidence.md`.

## Scope implemented on this branch

### 1. Google Ads View update-only safety guard

Added `guard-google-ads-view-filter-plan.js` and wired it into `setup-google-ads-view-filters.mjs`.

The Google Ads command now:

- requires `readyToApply=true`;
- requires `createViews=0`;
- permits only `update_view` actions;
- blocks missing managed Views with `GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE`;
- wraps the Lark client so `createView` always fails with `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN`;
- retains DEV target and explicit confirmation gates;
- does not alter the generic View installer used by workflows that legitimately create Views.

### 2. Access-history correction

Corrected the authoritative state to:

```text
Basic Access application submitted: 2026-07-21
Case ID: 1-686800040839
Review: pending
Current level: Test Account Access
```

Any older statement saying no application was submitted is superseded.

### 3. Manager Script evidence boundary

The 598-line safety scan remains documented Live review evidence because sanitized Script source is not committed. The next signed-delivery task must add a sanitized source snapshot or immutable checksum/query/output manifest before enabling external delivery.

### 4. RAW error View coverage decision

The 13 Google RAW error Views use the accepted **stable-key-only minimum contract**:

- one primary raw stable key;
- operator `isEmpty`;
- conjunction `and`.

This detects missing raw identity only. Comprehensive customer/entity/status/report/policy QA requires a separate Data Quality contract.

### 5. Documentation synchronization

Current authoritative state is recorded in:

- `docs/current-task.md`
- `PROJECT_BRAIN.md`
- `README.md`
- `docs/project-brain/00-current-state.md`
- `docs/project-brain/03-platform-decisions.md`
- `docs/project-brain/04-api-discoveries.md`
- `docs/project-brain/10-next-actions.md`
- `docs/project-brain/mkt-progress-v0.13.0.md`
- `docs/repository-audit-corrections-v0.13.7.md`

Historical release notes remain historical; when a historical statement conflicts with this file, this file wins under `AGENTS.md` authority order.

### 6. Dependency security correction

Branch Verification exposed four High findings through the transitive `sharp <0.35.0` chain used by the Cloudflare test/runtime toolset. The branch now:

- pins the patched transitive dependency through `overrides.sharp=0.35.3`;
- refreshes `package-lock.json`;
- retains `audit.log` in CI diagnostics;
- passes the online High-level dependency audit with `0 vulnerabilities`.

No application source behavior or deployment configuration was changed by this dependency correction.

## Explicitly out of scope

- Google Ads signed delivery endpoint;
- HMAC/timestamp/nonce/replay implementation;
- Google Ads connector catalog/runtime feature flag;
- Google Ads Queue job/router;
- D1 nonce/checkpoint/idempotency state;
- normalization and Lark Business Record writes;
- schedule activation;
- deployment;
- direct Google Ads API OAuth UAT;
- specialized business filters for the 55 preserved Views;
- customer-real UAT and customer-owned Production cutover.

## Next approved workstream

Create a separate task:

`Google Ads Manager Script signed delivery connector`

Contract must be approved before coding:

1. six-dataset payload schema and schema version;
2. stable key and idempotency key;
3. HMAC signature, timestamp, nonce and replay window;
4. bounded batch and payload limits;
5. null semantics;
6. partial-write and retry classification;
7. Queue/DLQ/checkpoint/lock/reconciliation;
8. retention, redaction and audit;
9. DEV/UAT/Production ownership and isolation;
10. schedule disabled by default.

## Acceptance criteria for this correction task

- [x] Google Ads View command has a code-level no-create guard.
- [x] Missing managed View fails closed before any mutation.
- [x] Defense-in-depth client blocks `createView` during a race.
- [x] Focused guard tests added.
- [x] Basic Access application history corrected in authoritative docs.
- [x] View contract wording distinguishes managed filters from 55 preserved specialized Views.
- [x] RAW error stable-key-only coverage documented.
- [x] Manager Script evidence level documented without overclaiming reproducibility.
- [x] Connector/schedule/deployment remain out of scope and disabled.
- [x] Vulnerable transitive `sharp` chain upgraded and lockfile refreshed.
- [x] `npm ci`
- [x] `npm run check`
- [x] `npm test`
- [x] `npm run test:report-reliability`
- [x] `npm audit --audit-level=high`
- [x] `npm run deploy:dry-run`
- [x] Work review of final source and documentation diff

## Implementation result

### Files added

- `packages/application/src/use-cases/guard-google-ads-view-filter-plan.js`
- `tests/application/guard-google-ads-view-filter-plan.test.js`
- `docs/repository-audit-corrections-v0.13.7.md`
- `docs/google-ads-manager-script-read-only-uat-evidence.md`

### Files updated

- `scripts/setup-google-ads-view-filters.mjs`
- `package.json`
- `package-lock.json`
- `.github/workflows/branch-verification.yml`
- Current state, Project Brain and handoff documentation listed above

### Live operations

```text
Lark writes           0
Google Ads writes     0
Business Record reads 0
Worker deploys        0
Queue messages        0
D1 migrations         0
Schedule changes      0
Production changes    0
```

### Verification result

Branch Verification run `170` passed on commit `edd0ad2de3901b64a06c7f2b5f832fb2126ba8f3`:

```text
npm ci                         PASS
npm run check                  PASS
Focused staged TikTok           4/4 PASS
Node Unit/Integration         540/540 PASS
Workers runtime                 9/9 PASS
Report reliability             70/70 PASS
npm audit --audit-level=high    0 vulnerabilities
npm run deploy:dry-run          PASS
```

The verification workflow has returned to read-only `contents` permission. No temporary lockfile write job remains.
