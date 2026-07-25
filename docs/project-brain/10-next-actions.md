# 10 — Next Actions

## Immediate next action — External Signed PREVIEW closeout review

Google Ads Manager Script signed-delivery source/transport progression is now:

1. Phase 1 merged through PR `#51` at `d7400c5`;
2. Phase 2 merged through PR `#52` at `e317fb9`;
3. Remote transport Closeout merged through PR `#53` at `217d54e`;
4. actual Manager Script external `DRY_RUN` correction merged through PR `#54`;
5. one-time Signing Secret provisioning implementation merged through PR `#55`
   at `4008b991e9aba2309691b733caccd7613f2ad2a8`;
6. Migration `0014`, actual Script provisioning and actual external Signed
   PREVIEW passed in separately approved operator windows.

Verified runtime result:

- one-time Ticket status `confirmed`;
- actual Manager Script used `AdsApp`, `AdsManagerApp`, GAQL, HMAC and
  `UrlFetchApp`;
- transport Run status `preview_validated`;
- datasets `6/6`, chunks `7/7`, rows `1375/1375`;
- every staged payload redacted;
- Business/Queue/Lark drift zero;
- signed ingress and provisioning routes restored to disabled / `404`;
- Business writer disabled;
- Script Properties restored to `DRY_RUN` / delivery `false`;
- clean Repository Script restored;
- schedules, LIVE and Production disabled.

Current action:

1. Review this documentation-only branch and sanitized rollout record.
2. Confirm only documentation changed; no Source, dependency, migration,
   runtime flag or deployment change belongs in this PR.
3. Merge the Closeout only after diff/hygiene review passes.
4. Open a new separately approved task for Local reference-only Queue admission.
5. Keep Connector activation, Queue processing beyond references, Business
   writers, D1 Ads facts, Shared RAW/Lark writes, schedules, LIVE and Production
   disabled until their own gates.

Draft PR `#17` remains Draft/HOLD and evidence-only. Do not merge or use it as
the implementation baseline.

## Parallel external wait — Customer OAuth callbacks

PR A/B/C and retry-safe PR `#45` are merged. Migration `0012` and Worker v2 are
live. The test invitations expired unused; seven-day customer links are active.
Next:

1. Keep PR #17 Draft/HOLD.
2. Keep merged source `9ca8375` plus docs closeout `5e5b8ee` as rollout evidence.
3. Review the additive data model and guarded rollout; keep orphaned PKCE cleanup
   outside this rollout.
4. Do not poll while waiting; customer explicitly confirms Google Ads and
   YouTube links before `2026-08-01 00:15 Asia/Bangkok`.
5. Verify successful callback closure, encrypted Refresh Tokens, provider
   identity and zero Queue/Lark side effects.
6. Regenerate links only if they expire or exhaust the three-attempt budget.

Do not enqueue business jobs, write Lark, enable schedules or rerun TikTok recovery. Exact commands are in `docs/customer-connection-oauth-rollout.md`.

## Parallel Meta connection preflight

The customer-owned Meta app does not require a new customer Connect link because
this phase uses customer-supplied Facebook and Instagram tokens. The local
preflight foundation is implemented with separate redacted results for Facebook
Organic, Instagram Organic and Meta Ads. A read-only Safari inspection on
`2026-07-25` found Marketing/Page permissions available for testing, but the app
is API-restricted. The Instagram token passed `/me` with HTTP `200`; the
Facebook token returned `API access blocked` on every read-only identity/scope
probe, and the administrator that issued it is no longer visible in Business
Settings. Treat it as orphaned and rotate it.

Safe order:

1. Restore at least one verified administrator on the customer-owned Meta
   app/business and complete any required Developer Portal verification.
2. Rotate the orphaned Facebook token; keep Facebook/Meta Ads under
   `META_ACCESS_TOKEN` and Instagram under `META_INSTAGRAM_ACCESS_TOKEN` only in
   `.dev.vars` or the Worker Secret boundary.
3. Configure `META_GRAPH_API_VERSION=v25.0` and exact non-secret
   `META_FACEBOOK_PAGE_ID`, `META_INSTAGRAM_ACCOUNT_ID` and
   `META_AD_ACCOUNT_ID`.
4. Run `npm run preflight:meta`; require exact identity matches, sufficient
   permissions, independently classified results and `businessWrites=0`.
5. Record Live UAT evidence, then request separate approval before adding
   Business ingestion, Queue/Lark writes, schedules or deployment.

The no-credential Business ingestion design and local fixture-driven source
boundary are now complete: contract-bound GET-only adapters, safe operation
observability, synthetic fixtures and pure Shared Raw/D1 candidate normalizers
are implemented with all datasets still `live_fixture_required`. After token
preflight passes, the next separately approved boundary is GET-only Live fixture
capture against exact customer identities. D1/Lark writers remain a later PR
after those Live response shapes and null/zero/action semantics are proven.

Do not reuse the developer-owned Meta app as customer evidence. Do not change
permissions, publish the app, submit App Review or generate Meta customer links
from this token-based preflight. The dashboard restriction is an operational
blocker/risk; the old Facebook credential is not accepted as current customer
evidence.

## Completed source correction

Repository audit/safety correction PR `#13` was squash-merged to main commit:

`d4a531fbb4e05dad7ce2296859c97f571e23acf3`

Verification passed:

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

No Live Lark Apply, Google Ads mutation, Queue message, D1 migration, schedule change or deployment occurred.

## Current approval gate

Documentation-only Closeout review/merge for the actual Google Ads Manager
Script Secret provisioning and External Signed PREVIEW. Runtime gates are already
safe-closed. After merge, the next implementation task may design and implement
Local reference-only Queue admission from authenticated completed Run/Chunk
references only. Business writer, D1 Ads facts, Shared RAW/Lark writes, LIVE,
Schedule and Production remain separately gated.

## Approved contract retained for next boundary

### Payload

1. Envelope schema and version.
2. Exact six dataset schemas:
   - account;
   - campaigns;
   - ad groups;
   - ads;
   - YouTube assets;
   - campaign daily metrics.
3. Null semantics and unsupported-field handling.
4. Bounded batch and payload size.
5. Stable ordering where required for deterministic signatures/tests.

### Security

1. HMAC algorithm and canonical serialization.
2. Timestamp format and allowed clock skew.
3. Nonce format and replay window.
4. Key rotation and environment separation.
5. Constant-time signature comparison.
6. Redacted diagnostics that never expose key, token, customer ID or raw payload.

### Identity and idempotency

1. Canonical `customerKey` and `accountKey`.
2. Stable key per dataset grain.
3. Request-level idempotency key.
4. Row-level fingerprint/checkpoint rules.
5. Rerun behavior with zero duplicate records.

### Reliability

1. Worker ingress validation order.
2. Queue job type in the central catalog.
3. Retryable versus Permanent classification.
4. D1 nonce/replay state.
5. D1 checkpoint and distributed lock.
