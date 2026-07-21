# Current Task — Customer-real UAT Foundation v0.11.2

## Status

- **Task status:** `verification_passed_docs_closeout_pending`
- **Accepted code baseline:** `7d0e8e545d2c318e7fe01a18c47ee2fe8941d023`
- **Merged review:** `PR #5`
- **Working branch:** `work/customer-real-uat-foundation`
- **Draft pull request:** `PR #6`
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
4. UAT ownership is represented explicitly:
   - `infrastructureOwner=developer`
   - `sourceAssetOwner=customer`
   - `dataOwner=customer`
   - `dataMode=customer_real_uat`
5. `resourceOwner` remains a compatibility alias for infrastructure ownership only; new code must use the explicit ownership fields.
6. Every UAT connector and every UAT business schedule is disabled by default.
7. A bounded system-recovery job may exist only under the isolated runtime contract and must not write customer business data when no durable recovery work exists.
8. `accountKey` remains required even when a connector is disabled.
9. Source-specific live identity such as TikTok handle must not be guessed or committed. A disabled connector may omit it; enabling the connector requires an exact Environment value.
10. TikTok UAT begins with Lark Native connection and read-only identity/source-contract preflight. Worker sync remains disabled until that gate passes.
11. Authentication secrets, customer numeric IDs and Lark table IDs remain outside Source and operational logs.
12. DEV, UAT and Production use separate Lark Base, Worker, D1, Queue, DLQ, Secrets, checkpoints, locks, alerts and business schedules.

## Implemented scope

### A — Batch C handoff state

- Recorded PR #5 squash merge baseline `7d0e8e5` and retained the verified Batch C evidence.
- Migrations `0007` and `0008` remain unapplied to remote DEV/UAT.

### B — Customer-real UAT runtime contract

- Added `uat` to supported environments.
- Added `uat_chemistry_k` with explicit source/data/infrastructure ownership.
- Preserved `chemistry_k` Canonical identity across UAT and Production.
- Kept all UAT connectors disabled by default.
- Allowed disabled connectors to omit live source identity while requiring it immediately when enabled.
- Kept Canonical `accountKey` mandatory even for disabled connectors.

### C — Documentation and safe configuration

- Added modular Project Brain document `docs/project-brain/customer-real-uat.md`.
- Updated `AGENTS.md`, `docs/current-task.md` and `wrangler.sync.example.jsonc`.
- Kept real customer identities, Table IDs, credentials and Cloudflare resource IDs out of Source.
- Root `PROJECT_BRAIN.md`, `README.md` and `CHANGELOG.md` still require a documentation-only closeout before this PR can be marked complete.

## Acceptance results

- Correct `uat`/`uat_chemistry_k` pairing: passed.
- UAT `customerKey=chemistry_k` and connector `accountKey=chemistry_k`: passed.
- Developer infrastructure ownership plus customer source/data ownership: passed.
- Disabled TikTok with no source handle: passed.
- Enabled TikTok without `TIKTOK_SOURCE_HANDLE`: fails closed as required.
- Enabled TikTok with Environment handle: passed while preserving Canonical account key.
- Disabled connector without `accountKey`: fails closed as required.
- Planned connectors remain impossible to enable: passed.
- Existing DEV and Production profile regressions: passed.
- Root documentation consistency: pending documentation-only closeout.

## Verification evidence

GitHub Actions Branch Verification run `29800251001` passed on clean head `95d2b44` before the final documentation wording-only commits:

- Locked dependency install: passed
- Architecture, syntax and repository hygiene: passed
- Focused staged TikTok: **4 passed, 0 failed**
- Node Unit/Integration: **498 passed, 0 failed**
- Workers runtime: **9 passed, 0 failed**
- Report reliability: **70 passed, 0 failed**
- Dependency audit: passed
- Wrangler dry-run: passed

A final merge-ref CI run is still required after documentation closeout. No existing gate was weakened, skipped or hidden.

## Out of scope

- Connecting or authorizing TikTok in Lark
- Reading customer TikTok data
- Creating or mutating a Lark Base/table/view
- Creating Cloudflare UAT Worker, D1, Queue or DLQ resources
- Applying migration `0007` or `0008` remotely
- Deploying a Worker
- Sending a live Queue message
- Enabling a connector or business schedule
- Calling TikTok, Meta, YouTube, WooCommerce or Chatwoot APIs
- Copying UAT data to Production
- Any Production mutation

## Implementation result

- **Implementation status:** `source_and_tests_complete_root_docs_pending`
- **External/Live UAT:** not run and not authorized
- **Independent review:** code/config review in progress; merge decision blocked by root documentation closeout and final CI

## Next live gate after this task

After this source-only foundation is reviewed and merged, the next task begins with a customer-authorized Lark Native TikTok connection and read-only preflight:

1. Confirm the connected TikTok account identity exactly.
2. Inspect Raw table fields and historical volume without destination writes.
3. Confirm unique video IDs, duplicate behavior, date range, null/zero semantics and pagination.
4. Only then design isolated UAT Cloudflare resources and a guarded migration/deploy/manual-sync plan.
