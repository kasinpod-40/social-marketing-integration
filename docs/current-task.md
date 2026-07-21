# Current Task — Shared-table DEV Schema Preview v0.12.2

## Status

- **Task status:** `live_dev_preview_passed_ready_for_merge_review`
- **Accepted baseline:** `ff74c373b57e5d4dc9e2088cdbbd5d2e4d68d194`
- **Merged review:** `PR #8`
- **Working branch:** `work/shared-table-dev-schema-preview`
- **Pull request:** `PR #9`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Live Lark mutation:** `not_authorized_not_run`
- **Live Lark preview:** `passed_read_only`
- **Schema Apply:** `blocked_not_implemented_separate_authorization_required`
- **Connector implementation:** `blocked_until_schema_apply_verified`
- **Last updated:** `2026-07-21`

PR #8 locked the Shared-table + View architecture and protected `RAW_TikTok_Creator_Videos`. This task implements and verifies the next gate as a Preview-only schema planner. It may inspect live DEV schema and at most one record item per reuse candidate to prove emptiness, but it cannot rename, create or update any Lark resource.

## Objective

Build a source-controlled, fail-closed Read-only Preview for the seven-table Shared-table contract:

- reuse five current zero-record Planned Raw tables in place;
- plan two genuinely new Canonical tables;
- compare all 128 approved fields;
- list the 17 required Views;
- verify the protected TikTok Native table receives zero actions;
- expose every conflict or manual Primary-field dependency before Apply is designed or authorized.

## In scope

- derive Schema and View plans directly from `docs/shared-table-blueprint-v0.12.1/*.csv`;
- resolve current reuse tables through their existing names while preserving Table IDs;
- verify each reuse candidate is empty with a bounded one-record read;
- detect duplicate target names, field-type conflicts and missing/ambiguous resources;
- plan Primary-field rename when authoritative live `is_primary` metadata identifies exactly one Text Primary field;
- retain a blocking manual action when an offline export lacks authoritative Primary metadata;
- support live DEV preview through `.dev.vars` and offline preview through `--base-export`;
- keep the generic schema planner genuinely Read-only by requiring write methods only for Apply;
- update README, Project Brain, Changelog and Blueprint status;
- run all Repository gates.

## Out of scope

- implementing or exposing an Apply command;
- live table rename/create, Field/View mutation or Record write;
- Facebook, Instagram, Meta Ads, TikTok Ads or Google Ads connector implementation;
- source API calls;
- Cloudflare deployment, D1 migration, Queue message or schedule changes;
- advertisement creation, activation or spend;
- WooCommerce/Chatwoot live access;
- customer UAT or Production mutation.

## Locked safety contract

1. `npm run preview:shared-table-schema` is Read-only.
2. `--apply` or ambient `CONFIRM_WRITE=YES` must fail with `SHARED_TABLE_SCHEMA_APPLY_NOT_AUTHORIZED`.
3. Live mode is allowed only for `MKT_ENV=development` and `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`.
4. `RAW_TikTok_Creator_Videos` remains protected and receives zero planned actions.
5. Reuse candidates are eligible only when a one-record bounded check returns empty.
6. A separate target table with the same target name is a conflict, never an implicit merge.
7. Apply readiness requires zero conflicts and zero blocking manual Primary-field actions.
8. Offline `.base` mode reads schema metadata and record counts only; record cell values and Table IDs are not committed.

## Acceptance criteria

1. Exactly seven tables and 128 fields are derived from the approved CSV contract.
2. Exactly five tables are `rename_reuse_in_place` and two are `create_new`.
3. Preview plans five table renames and two table creates against the reviewed Base.
4. All five reuse candidates are verified empty.
5. `RAW_TikTok_Creator_Videos` is found once and has `plannedActions=0`.
6. Preview lists all 17 View names without writing them.
7. Offline Base export preview reports zero conflicts and blocks Apply readiness only because the export lacks authoritative Primary metadata for five reused tables.
8. Authoritative live Primary metadata replaces those five manual blockers with five safe Primary-field rename plans.
9. Generic schema Preview works with a client that exposes only read methods; Apply still rejects missing write methods.
10. Full regression, architecture, hygiene, audit and Wrangler dry-run gates pass.

## Required commands

```bash
npm ci
npm run check
node --test tests/shared/csv.test.js tests/shared/lark-base-export.test.js tests/config/lark-table-governance.test.js tests/config/shared-table-blueprint.test.js tests/config/shared-table-lark-schema.test.js tests/application/preview-shared-table-lark-schema.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

Preview commands:

```bash
# Live DEV — requires ignored local .dev.vars
npm run preview:shared-table-schema

# Offline schema-only preview from a real Lark .base export path
npm run preview:shared-table-schema -- --base-export /actual/path/to/export.base
```

## Implementation and verification result

- **Implementation status:** `PASS_FOR_MERGE_REVIEW`
- **Schema contract:** 7 tables / 128 fields derived from approved CSV files
- **View contract:** 17 Views derived from approved CSV
- **Preview safety:** Apply command absent; `--apply` and `CONFIRM_WRITE=YES` rejected
- **Protected-table enforcement:** `RAW_TikTok_Creator_Videos` found exactly once and receives zero actions
- **Offline Base preview:** 26 tables, 5 empty reuse candidates, 5 renames, 2 creates, 98 missing fields, 1 description update, 17 View creates, 0 conflicts, 5 Primary metadata blockers
- **Live DEV Preview:** passed Read-only with `readyForApplyAuthorization=true` and `requiresManualSchemaResolution=false`
- **Live reuse checks:** all 5 candidates empty; authoritative Text Primary metadata found for all 5
- **Live action plan:** 5 table renames, 2 table creates, 93 field creates, 1 field description update, 5 Primary-field renames, 17 View creates
- **Live safety result:** 0 conflicts, 0 warnings, 0 manual blockers, 0 protected actions, 0 deletes, 0 record writes
- **Focused Shared-table tests:** 22 passed, 0 failed
- **Node Unit/Integration:** 520 passed, 0 failed
- **Workers runtime:** 9 passed, 0 failed
- **Report reliability:** 70 passed, 0 failed
- **Architecture:** 140 source files, 321 local dependencies, 0 cycles
- **Repository hygiene:** passed
- **Dependency audit:** 0 vulnerabilities
- **Wrangler dry-run:** passed — 658.68 KiB / gzip 130.35 KiB
- **Previous Final Branch Verification:** run `29827613813` passed on head `1e43499eaff377d7aa9891fde1c27a4fba51bb1c`
- **Live Preview evidence:** sanitized summary committed at `docs/shared-table-blueprint-v0.12.1/live-dev-preview-summary.md`; Table IDs and record values excluded
- **Offline placeholder command:** `/path/to/export.base` returned expected `ENOENT`; not a Schema failure
- **Live DEV mutation:** none
- **External APIs:** none
- **Cloudflare/Queue/D1/Schedule:** unchanged
- **Production mutation:** none

## Next gate

Run final Branch Verification for the documentation-only evidence commits, then review and Squash Merge PR #9. After merge, Apply design/implementation remains a separate task requiring explicit authorization before any live rename, create, Field update or View creation.
