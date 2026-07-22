# 00 — Current State

## Source baseline

- Implementation baseline: `d4a531fbb4e05dad7ce2296859c97f571e23acf3` / PR `#13`
- Documentation closeout: PR `#14`
- Current task: `docs/current-task.md` — signed delivery implemented; Integration Workspace validation pending
- Application package line: `0.11.0`
- Contract versions: View `v0.13.5`, Formula `v0.13.6`, audit correction `v0.13.7`

## Lark Integration Workspace baseline

Fresh configuration-only audit of `Social MKT Data Hub(11).base`:

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
Google Formula fields        4/4
Google managed filters      19/19
Shared managed filters      17/17
Report Views                 6/6
```

`Google Ads Daily 30D` is `platform=google_ads AND metric_date=TheLastMonth`.

No Lark View or Formula Apply is pending. Do not rerun.

## View classification

133 Views:

- 17 Shared-table managed
- 6 Report managed
- 19 Google Ads managed
- 36 All/default preserved unfiltered
- 55 specialized legacy Views preserved without inferred business logic

42 filtered Views are exactly `17 + 6 + 19`.

The 55 specialized Views are not defective merely because their names imply Active, Latest, Failed or similar semantics. They have no approved exact business-owner contract and must remain unchanged until a separate task defines Filter, Sort and Hidden fields.

## Channel state

### Active in Integration Workspace

- TikTok Organic
- YouTube Organic

### Access/schema ready but connector pending

- Facebook Organic
- Instagram Organic
- Meta Ads

### Implemented with Integration Workspace validation pending

- Google Ads signed delivery

### Planning/access pending

- TikTok Ads
- WooCommerce
- Chatwoot

## Google Ads state

Completed:

- customer-authorized account link/selectability
- Manager Script read-only validation
- six bounded non-empty datasets
- errors/truncation `0/0`
- Google Ads `No changes`
- Frequency `—`
- Lark schema/Relations/filters/formulas
- update-only Google View maintenance guard

Direct API:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current access Test Account Access
```

Implemented in Source:

- exact signed payload Contract and read-only Script snapshot
- HMAC/timestamp/nonce/replay/key-rotation checks
- Worker ingress and D1 idempotency/payload state
- reference-only Queue job using shared lock/retry/DLQ/redrive
- six RAW plus six Canonical plan-before-write mappings
- reconciliation, retention and regression tests

Remaining:

- signed PREVIEW and manual one-shot LIVE using Chemistry K data in the Integration Workspace
- customer-data idempotency/reconciliation/retry/lock/DLQ evidence
- schedule approval and Production

## Google View safety correction

The generic View installer may create Views for setup workflows. The Google Ads Filter command is explicitly update-only:

- `createViews=0`
- action allowlist `update_view`
- missing View is a blocker
- wrapped client rejects `createView`

Current Live Base is already zero drift; the guard protects future maintenance.

## RAW error coverage

The 13 Google RAW error Views use stable-key-only minimum QA:

```text
primary raw stable key isEmpty
```

Comprehensive customer/entity/status/report/policy validation is a separate future Data Quality contract.

## Repository correction verification

PR #13 passed:

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

The transitive `sharp` vulnerability chain was fixed with `overrides.sharp=0.35.3` and a refreshed lockfile. No Live resource mutation occurred.

## Runtime safety

- One mixed-source Integration Workspace uses the existing resources; Production remains isolated
- Integration and Production connectors/schedules remain disabled by default until their gates pass
- Production customer-owned
- secrets only in Environment/Secret Manager
- every write path requires stable key, idempotency, retry and reconciliation
- missing metric remains `null` unless the source proves zero

## Next gate

Run `docs/google-ads-signed-delivery-integration-validation.md` on the existing resources with `MKT_ENV=development` and profile `integration_workspace`. Schedule stays disabled, Lark Formula/View/schema work stays closed, and Production remains blocked.
