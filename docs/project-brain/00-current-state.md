# 00 — Current State

## Customer OAuth retry-safe v2 — source merged, rollout pending

As of 2026-07-24, Shared Customer Connection/OAuth, Google Ads OAuth and YouTube OAuth are implemented, verified and merged in order through PRs `#42` → `#43` → `#44`. The approved Integration Workspace rollout is complete through Remote D1 migration, Google Cloud configuration, Worker Secrets/runtime mappings, deployment and HTTP smoke.

```text
CONNECTOR_IMPLEMENTATION            COMPLETE_MERGED
RETRY_SAFE_V2                       MERGED_PR_45
MOCK_CONTRACT_TEST                  PASS
INTEGRATION_WORKSPACE_DEPLOYMENT    PASS
CUSTOMER_OAUTH                      AUTHORIZATION_PENDING_STATES_EXPIRED
LIVE_ACCESS                         NOT_RUN
HTTP_SMOKE                          PASS_404_405
CONNECT_LINK_GENERATION             ALL_4_CONSUMED_NO_CALLBACK
REMOTE_MIGRATION                    0011_APPLIED_0012_NOT_APPLIED
LIVE_WORKER                         V1_ONE_SHOT
SCHEDULE                            DISABLED
PRODUCTION                          BLOCKED
```

Migration `0011_customer_connection_oauth.sql` is applied remotely and the live
Worker remains version `e80e46f0-5f81-4ce9-ae06-678cafab6efe` with v1
one-shot-on-GET behavior. Both customer and test invitation pairs were consumed
without callback completion; D1 still has four expired states, no Refresh Token
and no identity selection.

PR `#45` implements contract v2 and is merged to `main` at `9ca8375`:
side-effect-free GET confirmation, exact POST-to-start, default three bounded
attempts, one atomic active-attempt lock, retry after expiry/failure and permanent
closure on successful callback. Additive migration
`0012_retry_safe_customer_connection.sql` is local only. Focused suites pass
43/43; Unit 686/686, Workers 9/9, report reliability 70/70, Architecture
191/460/0, audit 0 and deploy dry-run pass. GitHub Branch Verification passed.
Remote migration `0012` and deployment remain pending. No live mutation,
Queue/Lark effect or schedule change occurred. PR #17 remains Draft/HOLD.

## Source baseline

- Implementation baseline: `d4a531fbb4e05dad7ce2296859c97f571e23acf3` / PR `#13`
- Documentation closeout: PR `#14`
- Current task: `docs/current-task.md` — v2 local verification in progress
- Application package line: `0.11.0`
- Contract versions: View `v0.13.5`, Formula `v0.13.6`, audit correction `v0.13.7`

## Lark DEV baseline

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

### Active in verified DEV

- TikTok Organic
- YouTube Organic

### Access/schema ready but connector pending

- Facebook Organic
- Instagram Organic
- Meta Ads
- Google Ads signed delivery

### Planning/access pending

- TikTok Ads
- WooCommerce
- Chatwoot

## Google Ads state

Completed:

- customer-authorized account link/selectability
- Manager Script read-only UAT
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

Remaining:

- signed payload connector
- HMAC/timestamp/nonce/replay checks
- Worker ingress
- Queue/DLQ and D1 state
- normalization and destination writes
- reliability/reconciliation UAT
- schedule and Production

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

- DEV/UAT/Production remain isolated
- UAT and Production connectors/schedules disabled by default
- Production customer-owned
- secrets only in Environment/Secret Manager
- every write path requires stable key, idempotency, retry and reconciliation
- missing metric remains `null` unless the source proves zero

## Next approval gate

Proposed workstream:

`Google Ads Manager Script signed delivery connector`

Approve payload, signature/replay, idempotency, batch, null, retry, Queue/D1, retention/redaction and ownership contracts before implementation. Schedule stays disabled until isolated manual UAT and idempotent rerun pass.
