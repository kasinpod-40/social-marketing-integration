# Current Task — Guarded Shared-table DEV Schema Apply v0.12.3

## Status

- **Task status:** `implementation_complete_local_gates_passed_pending_remote_ci_review`
- **Accepted baseline:** `cbc3da8e40190509ed3985e14a573d6cedbe9c32`
- **Merged review:** `PR #9`
- **Working branch:** `work/shared-table-schema-apply`
- **Pull request:** `PR #10`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Apply implementation:** `approved_and_implemented_for_review`
- **Live Lark mutation:** `not_authorized_not_run`
- **Connector implementation:** `blocked_until_live_apply_and_zero_drift_verified`
- **Last updated:** `2026-07-21`

PR #9 merged the Read-only Preview and recorded a successful live DEV plan: five verified-empty tables can be reused in place, two tables are genuinely missing, all Primary metadata is authoritative, and there are no conflicts, warnings or protected-table actions. The user then authorized development of a separate Guarded Apply task. This authorization covers implementation and review only; an exact fresh authorization is still required before running the live Apply command.

## Objective

Implement a fail-closed, resumable and idempotent DEV-only Apply for the approved seven-table Shared-table contract while preserving every existing Table ID selected for reuse and guaranteeing zero mutation against `RAW_TikTok_Creator_Videos`.

## In scope

- add a separate `setup:shared-table-schema` Preview command and confirmation-gated Apply command;
- rerun a fresh live Preview immediately before the first write;
- validate the entire plan against the approved seven-table/128-field/17-View contract;
- rename five verified-empty Planned Raw tables in place, preserving their Table IDs;
- rename the five existing Text Primary fields in place, preserving their Field IDs and Primary role;
- add/update only approved Fields;
- create only `MKT_Account_Daily` and `MKT_Ads_Ads`;
- create and configure the 17 approved filtered Views through the existing live-verified View resolver;
- record confirmed progress when a later action fails so a rerun can reconcile safely;
- rerun Schema and View Preview after Apply and require absolute zero drift;
- return Table-ID environment updates to the local operator without committing them;
- update task, Project Brain, README, Changelog and Blueprint documentation;
- run full Repository gates and remote PR CI.

## Out of scope

- running the live Lark Apply while PR #10 is under implementation/review;
- deleting a Table, Field, View, Select option or Record;
- writing, updating or deleting Business records;
- changing `RAW_TikTok_Creator_Videos` in any way;
- Facebook, Instagram, Meta Ads, TikTok Ads or Google Ads connector implementation/activation;
- source Platform API calls;
- Cloudflare deployment, D1 migration, Queue message or schedule changes;
- advertisement creation, activation or spend;
- WooCommerce/Chatwoot live access;
- UAT or Production mutation.

## Locked execution contract

1. `npm run setup:shared-table-schema` is always Read-only, even if confirmation variables remain in the Shell.
2. Apply requires all of the following in the same invocation:
   - the dedicated `:apply` npm script, which supplies `--apply`;
   - `CONFIRM_WRITE=YES`;
   - `CONFIRM_SHARED_TABLE_SCHEMA=YES`.
3. Apply is allowed only when runtime resolves exactly to `MKT_ENV=development` and `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`.
4. A fresh Preview must have zero conflicts, warnings and manual blockers before the first write.
5. The protected TikTok Native table must be found exactly once and have zero planned actions.
6. Every reuse candidate must still resolve to the expected table, remain empty before rename and preserve its Table ID.
7. Only approved action kinds and contract resources may run; no implicit merge, delete or Record action exists.
8. Schema writes run sequentially and expose only confirmed progress on failure.
9. Create operations use idempotent reconciliation on rerun; ambiguous/partial View work is recovered by name and current property.
10. Final Schema and View verification must have zero remaining actions, conflicts, warnings and manual blockers.
11. Real Table IDs remain in ignored `.dev.vars`/`wrangler.sync.jsonc` only and are never committed.
12. Table rename uses the official Lark Base v3 `PATCH .../tables/:table_id` contract and requires the app scope `base:table:update`.

## Expected first live plan

The most recent Read-only live DEV Preview reported:

- 5 table renames;
- 5 Primary-field renames;
- 93 Field creates;
- 1 Field-description update;
- 2 table creates;
- 17 View creates;
- 0 conflicts, warnings, manual blockers, protected actions, deletes and Record writes.

These counts are evidence, not a bypass. The Apply command recalculates the live plan and stops before writing if the safety contract is no longer satisfied.

## Acceptance criteria

1. Preview remains Read-only and cannot be converted to Apply by ambient environment variables.
2. Apply fails unless both confirmation variables and `--apply` are present.
3. DEV/profile guard rejects UAT and Production before creating a Lark client write plan.
4. The official Table rename request preserves the current Table ID.
5. A non-empty reuse candidate, missing/ambiguous protected table, duplicate target, field conflict or missing reuse slot blocks before the first write.
6. New table creation is limited to `MKT_Account_Daily` and `MKT_Ads_Ads`.
7. `RAW_TikTok_Creator_Videos` receives zero Schema and Record actions.
8. Existing shared View resolver converts field names and Select names to live IDs and verifies filters idempotently.
9. Successful Apply rerun performs zero writes.
10. A failure after confirmed writes returns accurate progress and a rerun completes without duplicating tables or Views.
11. Final verification is zero drift and reports no delete/Record write.
12. Full Unit/Integration, Workers-runtime, Report reliability, architecture, hygiene, audit and Wrangler dry-run gates pass.

## Commands

```bash
npm ci
npm run check
node --test \
  tests/application/apply-shared-table-lark-schema.test.js \
  tests/application/preview-shared-table-lark-schema.test.js \
  tests/application/install-lark-report-views.test.js \
  tests/config/shared-table-lark-schema.test.js \
  tests/config/shared-table-schema-runtime-config.test.js \
  tests/connectors/lark-bitable-client.test.js \
  tests/scripts/shared-table-schema-installer-mode.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Operator commands after PR merge and a new explicit live authorization:

```bash
# Fresh read-only plan
npm run setup:shared-table-schema

# Live DEV Apply — do not run without the separate exact authorization
CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply

# Required zero-drift confirmation after Apply
npm run setup:shared-table-schema
```

## Implementation result

- **Implementation status:** `PASS_LOCAL_GATES_READY_FOR_REMOTE_REVIEW`
- **Guarded Apply:** implemented with fresh Preview, exact plan validation and zero-drift post-verification
- **DEV/profile guard:** implemented
- **Confirmation guard:** implemented; ambient confirmations cannot make Preview write
- **Table rename:** implemented using official Base v3 PATCH contract
- **Protected-table enforcement:** retained; missing/ambiguous protected source blocks Apply and planned actions remain zero
- **Schema scope:** exactly 7 tables / 128 Fields from approved CSV contract
- **Views:** exactly 17 filters use the existing live-verified View resolver
- **Partial recovery:** confirmed Field and View failure paths are tested; rerun is idempotent
- **Focused Apply/Preview/View/config/client tests:** 77 passed, 0 failed
- **Node Unit/Integration:** 532 passed, 0 failed
- **Workers runtime:** 9 passed, 0 failed
- **Report reliability:** 70 passed, 0 failed
- **Architecture:** 145 source files / 340 local dependencies / 0 cycles
- **Repository hygiene:** passed before final documentation-only edits
- **Dependency audit:** 0 vulnerabilities
- **Wrangler dry-run:** passed — 659.26 KiB / gzip 130.46 KiB
- **Live Lark Apply:** not run
- **Business Record writes:** none
- **External source APIs:** none
- **Cloudflare/Queue/D1/Schedule:** unchanged
- **Production mutation:** none

## Next gate

Run the final full Repository gates, publish PR #10 for review and wait for explicit Squash Merge approval. After merge, rerun the fresh Read-only plan and request a separate exact authorization before executing the live DEV Apply command.
