# Current Task — Customer-real UAT Foundation v0.11.2

## Status

- **Task status:** `implementation_in_progress`
- **Accepted code baseline:** `7d0e8e545d2c318e7fe01a18c47ee2fe8941d023`
- **Merged review:** `PR #5`
- **Working branch:** `work/customer-real-uat-foundation`
- **Target profile:** `uat_chemistry_k`
- **Target environment:** `uat`
- **Last updated:** `2026-07-21`

Batch C was independently reviewed, CI-verified and squash-merged to `main` as `7d0e8e5`. This task creates the fail-closed configuration and ownership contract required before connecting customer-real data to the developer-owned UAT infrastructure. No Lark, Cloudflare, Queue, D1, platform API or Production mutation is authorized in this task.

## Security prerequisite

Previously exposed YouTube API/OAuth credentials must be rotated before the next external UAT or deployment. Old credentials must not be used for external calls.

## Confirmed UAT operating model

UAT uses real customer data and real customer-owned source accounts across every approved channel. Only the temporary UAT infrastructure is developer-owned:

| Layer | DEV | Customer-real UAT | Production |
| --- | --- | --- | --- |
| Source accounts/data | Developer | Customer | Customer |
| Lark Base | Developer | Developer, temporary | Customer |
| Cloudflare Worker/D1/Queue/DLQ | Developer | Developer, isolated | Customer |
| Runtime profile | `dev_ft_pumkin` | `uat_chemistry_k` | `chemistry_k` |
| Canonical customer/account identity | DEV-specific | `chemistry_k` | `chemistry_k` |

UAT is production-like and contains real customer data. It is not sample, sandbox or demo data.

## Locked contracts

1. `MKT_ENV` supports `development`, `uat` and `production` as separate fail-closed environments.
2. `uat_chemistry_k` is a runtime/profile identity only. It must not become a Canonical customer or account identity.
3. `customerKey` and every customer connector `accountKey` remain `chemistry_k` in both UAT and Production, preventing Stable-key drift during cutover.
4. UAT ownership must be represented explicitly:
   - `infrastructureOwner=developer`
   - `sourceAssetOwner=customer`
   - `dataOwner=customer`
   - `dataMode=customer_real_uat`
5. `resourceOwner` remains a compatibility alias for infrastructure ownership only; new code must use the explicit ownership fields.
6. Every UAT connector and every schedule is disabled by default.
7. Source-specific live identity such as TikTok handle must not be guessed or committed. A disabled connector may omit it; enabling the connector requires an exact Environment value.
8. TikTok UAT begins with Lark Native connection and read-only identity/source-contract preflight. Worker sync remains disabled until that gate passes.
9. Tokens, passwords, OTPs, API keys, app secrets, cookies, customer numeric IDs and Lark table IDs remain outside Source and operational logs.
10. DEV, UAT and Production must use separate Lark Base, Worker, D1, Queue, DLQ, Secrets, checkpoints, locks, alerts and schedules.

## In scope

### A — Close Batch C documentation state

- Record that PR #5 was squash-merged to `main` as `7d0e8e5` after `PASS_FOR_MERGE`.
- Retain the verified Batch C evidence: Node 495/495, Workers 9/9, Report reliability 70/70, architecture 133/304/0, audit 0, migration replay 0001–0008 and Wrangler dry-run.
- Keep migrations `0007` and `0008` explicitly unapplied to the remote UAT/DEV database.

### B — Add customer-real UAT runtime contract

- Add `uat` to supported environments.
- Add `uat_chemistry_k` with explicit source/data/infrastructure ownership.
- Preserve `chemistry_k` Canonical identity across UAT and Production.
- Keep all UAT connectors disabled by default.
- Allow disabled connectors to omit live source identity while requiring it immediately when enabled.

### C — Documentation and configuration examples

- Add a modular Project Brain document for customer-real UAT ownership, isolation, authorization, identity, rollout and cutover rules.
- Update `AGENTS.md`, `PROJECT_BRAIN.md`, `README.md`, `CHANGELOG.md` and `wrangler.sync.example.jsonc`.
- Do not place real customer identifiers, Table IDs, credentials or resource IDs in Source.

## Acceptance criteria

- `loadCustomerRuntimeConfig` accepts only the correct `uat`/`uat_chemistry_k` pairing.
- UAT resolves `customerKey=chemistry_k` and connector `accountKey=chemistry_k`.
- UAT reports developer infrastructure ownership and customer source/data ownership.
- UAT loads successfully with TikTok disabled and no source handle.
- Enabling UAT TikTok without `TIKTOK_SOURCE_HANDLE` fails closed.
- Enabling UAT TikTok with an Environment handle preserves `accountKey=chemistry_k` and marks the handle source as `environment`.
- Planned connectors remain impossible to enable.
- Existing DEV and Production profile behavior remains compatible.
- Repository documents consistently describe customer-real UAT and customer-owned Production.

## Required tests and gates

```bash
npm ci
node --test tests/config/customer-profiles.test.js tests/config/connector-runtime-config.test.js
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Do not weaken, skip or hide an existing gate.

## Out of scope

- Connecting or authorizing TikTok in Lark
- Reading customer TikTok data
- Creating or mutating a Lark Base/table/view
- Creating Cloudflare UAT Worker, D1, Queue or DLQ resources
- Applying migration `0007` or `0008` remotely
- Deploying a Worker
- Sending a live Queue message
- Enabling a connector or schedule
- Calling TikTok, Meta, YouTube, WooCommerce or Chatwoot APIs
- Copying UAT data to Production
- Any Production mutation

## Implementation result

- **Implementation status:** `in_progress`
- **External/Live UAT:** not run and not authorized

### Implemented so far

- [x] Added `uat_chemistry_k` with explicit ownership/data-mode fields.
- [x] Preserved `chemistry_k` customer/account stable identity across UAT and Production.
- [x] Kept UAT connectors disabled by default and TikTok live handle out of Source.
- [x] Required live connector identity only when that connector is enabled.
- [x] Added focused profile/runtime regression coverage.
- [ ] Update repository/project documentation and example config.
- [ ] Run focused/full CI gates and perform independent diff review.

## Next live gate after this task

After this source-only foundation is reviewed and merged, the next task must begin with a customer-authorized Lark Native TikTok connection and read-only preflight:

1. Confirm the connected TikTok account identity exactly.
2. Inspect Raw table fields and historical volume without destination writes.
3. Confirm unique video IDs, duplicate behavior, date range, null/zero semantics and pagination.
4. Only then design isolated UAT Cloudflare resources and a guarded migration/deploy/manual-sync plan.
