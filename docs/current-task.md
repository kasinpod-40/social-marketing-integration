# Current Task — Repository Audit Corrections v0.13.7

## Status

- **Task status:** `closed_repository_audit_corrections_verified`
- **Merged PR:** `#13`
- **Merged baseline:** `d4a531fbb4e05dad7ce2296859c97f571e23acf3`
- **Merge method:** squash
- **Environment:** source-only correction
- **Live Lark mutation:** none
- **Google Ads mutation:** none
- **Worker/Queue/D1/Schedule:** unchanged
- **Deployment:** none
- **Production mutation:** none
- **Last updated:** `2026-07-22`

Repository audit confirmed the Live Lark closeout and Google Ads read-only UAT, corrected stale/conflicting repository state, added an update-only safety guard for Google Ads View maintenance and remediated the vulnerable transitive `sharp` dependency.

Full correction record: `docs/repository-audit-corrections-v0.13.7.md`.

## Verified merged baseline

### Repository

- Main commit: `d4a531fbb4e05dad7ce2296859c97f571e23acf3`
- Application package line: `0.11.0`
- Lark contract versions:
  - View filters: `v0.13.5`
  - Formula UI: `v0.13.6`
  - Repository correction: `v0.13.7`
- Dependency lock includes patched `sharp 0.35.3` override

### Lark DEV

Fresh `Social MKT Data Hub(11).base` configuration-only audit:

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Table emoji/folders       42/42
View emoji names         133/133
Formula fields               4/4
Google Ads filters          19/19
Shared-table filters        17/17
Report Views                 6/6
Google Ads Daily 30D         platform=google_ads + TheLastMonth
```

Do not rerun Lark View Apply or Formula UI work.

## View contract interpretation

133 Views are classified as:

- `17` Shared-table managed Views;
- `6` Report managed Views;
- `19` Google Ads managed Views;
- `36` All/default baseline Views intentionally unfiltered;
- `55` legacy specialized Views preserved without inferred business rules.

“Full View contract” means every View is managed or explicitly preserved. It does not mean the 55 specialized Views have business filters matching names such as Active, Failed, Latest or Connection Issues. A separate business-owner contract is required before changing those Views.

## Google Ads access and read-only UAT

```text
Advertiser link/selectability       PASS
Manager Script read-only Preview    PASS
Dataset result                      data_available 6/6 non-empty
Dataset errors/truncation           0/0
Google Ads changes                  No changes
Script Frequency                    —
External delivery                   disabled
Current direct API level            Test Account Access
Basic Access application            submitted 2026-07-21
Case ID                             1-686800040839
Review                              pending
```

Direct API remains optional Phase 2 and does not block the Manager Script MVP.

Sanitized evidence and reproducibility boundary: `docs/google-ads-manager-script-read-only-uat-evidence.md`.

## Implemented corrections

### Google Ads View update-only guard

The Google Ads maintenance command now:

- requires `readyToApply=true`;
- requires `createViews=0`;
- permits only `update_view` actions;
- blocks missing managed Views with `GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE`;
- wraps the Lark client so `createView` always fails with `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN`;
- keeps DEV target and explicit confirmation gates;
- leaves the generic View installer unchanged for legitimate setup workflows.

### Access-history correction

The authoritative state is:

```text
Basic Access application submitted: 2026-07-21
Case ID: 1-686800040839
Review: pending
Current level: Test Account Access
```

Any older statement saying no application was submitted is superseded.

### Manager Script evidence boundary

The 598-line safety scan remains documented Live review evidence because sanitized Script source is not committed. The next signed-delivery task must add a sanitized source snapshot or immutable checksum/query/output manifest before external delivery is enabled.

### RAW error View coverage

The 13 Google RAW error Views use a stable-key-only minimum contract:

```text
primary raw stable key isEmpty
conjunction and
```

This detects missing raw identity only. Comprehensive customer/entity/status/report/policy QA requires a separate Data Quality contract.

### Dependency security correction

Branch verification exposed High findings through the transitive `sharp <0.35.0` chain. PR #13:

- pinned `overrides.sharp=0.35.3`;
- refreshed `package-lock.json`;
- retained `audit.log` in CI diagnostics;
- passed dependency audit with `0 vulnerabilities`.

## Verification result

Final PR head `0835957df06db02c57d37bf5ce47380642ed418b` passed Branch Verification run `171`:

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

The verification workflow uses read-only `contents` permission.

## Live-operation proof

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

## Scope not completed

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

## Next approval gate

Open a separate task only after user approval:

`Google Ads Manager Script signed delivery connector`

Lock before coding:

1. six-dataset payload schema/version;
2. stable key and idempotency key;
3. HMAC signature, timestamp, nonce and replay window;
4. bounded batch and payload limits;
5. null semantics;
6. partial-write and retry classification;
7. Queue/DLQ/checkpoint/lock/reconciliation;
8. retention, redaction and audit;
9. DEV/UAT/Production ownership and isolation;
10. schedule disabled by default.

## Definition of done

- [x] Repository state corrected and synchronized.
- [x] Google Ads View update-only guard merged.
- [x] Missing View and race protection tests merged.
- [x] Basic Access application history corrected.
- [x] 55 preserved specialized Views documented accurately.
- [x] RAW stable-key-only coverage documented.
- [x] Manager Script evidence boundary documented.
- [x] Vulnerable dependency chain remediated.
- [x] Full gates passed.
- [x] PR #13 squash-merged to `main`.
