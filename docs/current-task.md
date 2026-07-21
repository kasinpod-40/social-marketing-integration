# Current Task — Shared-table Architecture Revision v0.12.1

## Status

- **Task status:** `local_gates_passed_pending_remote_ci`
- **Accepted baseline:** `ae13440f52f9647c18bf26a75c4e4e6f4c1f18e9`
- **Merged review:** `PR #7`
- **Working branch:** `work/meta-dev-schema-foundation`
- **Pull request:** `PR #8` — scope is being replaced before merge
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Live Lark mutation:** `not_authorized_not_run`
- **Connector implementation:** `blocked_until_revised_schema_verified`
- **Last updated:** `2026-07-21`

The user rejected endpoint-per-table growth and reconfirmed the original architecture: use shared tables across platforms and separate channel/entity presentation with Lark Views. The user also locked `RAW_TikTok_Creator_Videos` as an externally managed Lark Native TikTok source that our system must never mutate.

## Evidence reviewed

The user-provided `Social MKT Data Hub(6).base` export was inspected locally without committing the file or record values:

- 26 unique tables
- 4,641 records
- 352 fields
- 81 views
- one repeated export block for `MKT_Report_Top_Content`, not a duplicate physical table
- five unused Planned Raw tables with zero records

Sanitized schema-only evidence is recorded under `docs/shared-table-blueprint-v0.12.1/`.

## Locked architecture

### Protected external source

`RAW_TikTok_Creator_Videos`:

- owned and written by Lark Native TikTok for Creator;
- read-only to our connector;
- no rename/delete/field mutation/record write from our installer or Worker;
- normalized downstream into shared Canonical tables only.

### Shared Raw tables

Meta Organic uses three tables:

1. `RAW_Meta_Organic_Accounts`
2. `RAW_Meta_Organic_Content`
3. `RAW_Meta_Organic_Metrics`

All paid platforms use two tables:

4. `RAW_Ads_Entities`
5. `RAW_Ads_Daily`

`platform`, `entity_type`, `ad_channel` and Views separate Facebook, Instagram, Meta Ads, TikTok Ads and Google Ads.

### In-place reuse

Five current zero-record Planned Raw tables are renamed/reused in place, preserving their Table IDs. This adds no Raw table.

### New tables allowed

Only two new tables have distinct missing grains:

1. `MKT_Account_Daily` — Account×Date
2. `MKT_Ads_Ads` — Ad identity separate from Creative

Expected final unique table count: **28**, not 41.

## In scope

- supersede the v0.12.0 physical layout before it is applied;
- create the revised Shared-table source contract, fields, migration map and View plan;
- record a sanitized inventory/duplicate review from the current Base export;
- replace stale planned Raw environment mappings with five shared logical mappings;
- add fail-closed protected-table governance to the generic schema planner;
- add a schema-only `.base` analyzer that excludes record values and redacts Table IDs by default;
- update Project Brain, README and Changelog;
- run full Repository gates and remote PR merge-ref CI.

## Out of scope

- live Lark table rename, create, field change or record write;
- Meta/Facebook/Instagram/TikTok Ads/Google Ads connector implementation;
- source API calls;
- Cloudflare deploy, D1 migration, Queue message or schedule changes;
- advertisement creation, activation or spend;
- WooCommerce/Chatwoot live access;
- customer UAT or Production mutation.

## Acceptance criteria

1. `RAW_TikTok_Creator_Videos` is enforced as protected before any schema planner live read/write.
2. The old 14-table Meta physical layout cannot be considered approved for apply.
3. Exactly five existing zero-record Planned Raw tables are designated for In-place reuse.
4. The revised Raw model contains three Meta Organic tables and two cross-platform Ads tables.
5. Only `MKT_Account_Daily` and `MKT_Ads_Ads` increase the table count.
6. Current Base inventory totals remain 26/4,641/352/81 in the sanitized contract.
7. Duplicate review distinguishes Raw/Canonical/Report grain from true duplication.
8. Existing TikTok Native and YouTube operational tables are retained without schema mutation.
9. Safe config examples contain shared logical mappings only and no live IDs/secrets.
10. Full tests, architecture, hygiene, audit and Wrangler dry-run pass.

## Required gates

```bash
npm ci
npm run check
node --test tests/shared/csv.test.js tests/shared/lark-base-export.test.js tests/config/lark-table-governance.test.js tests/config/shared-table-blueprint.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Implementation result

- **Implementation status:** `local_gates_passed_pending_remote_ci`
- **Architecture contract:** revised Shared-table contract complete
- **Protected-table enforcement:** complete; planner rejects protected targets before the first Lark client call
- **Base export analyzer:** complete; schema-only, record values excluded, Table IDs redacted by default
- **Focused Shared-table/CSV/Base/protection tests:** 12 passed, 0 failed
- **Node Unit/Integration:** 510 passed, 0 failed
- **Workers runtime:** 9 passed, 0 failed
- **Report reliability:** 70 passed, 0 failed
- **Architecture:** 137 source files, 307 local dependencies, 0 cycles
- **Repository hygiene:** passed
- **Dependency audit:** 0 vulnerabilities
- **Wrangler dry-run:** passed — 658.68 KiB / gzip 130.35 KiB
- **Current Base schema evidence:** 26 tables / 4,641 records / 352 fields / 81 views
- **Revised table plan:** reuse 5 empty Planned Raw tables, create 2 new Canonical tables, expected final total 28
- **Live DEV schema:** not changed
- **External APIs:** not called
- **Customer data values:** not inspected or committed
- **Production mutation:** none

## Next gate

After source and CI review, perform a read-only live inventory only. A separate explicit authorization is required before renaming the five empty tables or creating the two new Canonical tables.
