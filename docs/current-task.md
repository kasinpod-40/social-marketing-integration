# Current Task — Meta Organic + Meta Ads Blueprint & DEV Access Preflight v0.12.0

## Task metadata

- **Status:** `blueprint_draft_ready_for_review`
- **Source baseline:** `d7b28c99f3ee435f45cc2d637bbe8fddfaf1179d`
- **Working release:** `v0.12.0-meta-blueprint-access-preflight`
- **Environment:** developer-owned DEV profile `dev_ft_pumkin`
- **Production ownership:** customer-owned resources only
- **Implementation gate:** `blocked_until_user_approves_blueprint_and_source_contract`
- **Last updated:** `2026-07-20`

## Previous task closeout

- TikTok DEV durable resume, guarded deploy, scheduled smoke and final D1 health passed on `d7b28c9`.
- Final TikTok active work/phase/unit/lock/open DLQ/open alert = `0/0/0/0/0/0`.
- YouTube remains `dev_ready`; customer-owned 837-video Live UAT remains a Production blocker.
- Production remains disabled.

## Security prerequisite

YouTube API/OAuth credentials visible in a previous screenshot must be rotated before the next external UAT or deploy. Update only local ignored configuration and the Cloudflare secret store. Offline Blueprint work may continue, but do not use the old credentials for external calls.

## Objective

Design Facebook Organic, Instagram Organic and Meta Ads so a new customer changes only profile values, non-secret IDs, protected credentials, Lark mappings, permissions and schedules. Customer-specific source branches are forbidden. Runtime scope is read-only reporting.

## Delivered draft artifacts

Created and visually/formula checked in the working environment:

- `Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0.xlsx`
- `Social_MKT_Data_Hub_Meta_Lark_Import_v0.12.0.xlsx`

Repository source contract:

- `docs/meta-blueprint-v0.12.0.md`

The Excel files are review/provisioning artifacts and are not committed as binaries by this connector.

## Table inventory

### Facebook Organic

1. `RAW_Meta_Pages`
2. `RAW_FB_Page_Insights_Daily`
3. `RAW_FB_Posts`
4. `RAW_FB_Post_Insights_Daily`

### Instagram Organic

5. `RAW_IG_Accounts`
6. `RAW_IG_Account_Insights_Daily`
7. `RAW_IG_Media`
8. `RAW_IG_Media_Insights_Daily`

### Meta Ads

9. `RAW_Meta_Ad_Accounts`
10. `RAW_Meta_Campaigns`
11. `RAW_Meta_Ad_Sets`
12. `RAW_Meta_Ads`
13. `RAW_Meta_Ad_Creatives`
14. `RAW_Meta_Ads_Insights_Daily`

### Canonical proposal

- `MKT_Accounts_Daily` for cross-platform account/page daily snapshots. It must not be applied before explicit approval.

The Blueprint contains 371 field contracts across the 14 RAW tables.

## Core draft contracts

- External IDs that look numeric remain Text.
- Organic entity daily key is `{entity_key}:{source_metric_date}`.
- Ads entity key is `meta_ads:{ad_account_id}:{entity_type}:{external_entity_id}`.
- Canonical Ads daily key is `{entity_key}:{source_metric_date}`.
- Raw Ads breakdown key also includes `{breakdown_key}`.
- Unsupported or empty metrics are `null`, not zero.
- Post/Media cumulative metrics are stored as snapshots, not fabricated daily deltas.
- Reconciliation retains missing/private entities and records warning state; it does not destructively delete rows.
- Meta Ad Set maps to canonical Ad Group.
- Ad and Creative IDs/keys remain separate.
- Only aggregate Ads rows map to `MKT_Ads_Daily`; placement/device breakdown rows remain RAW-only.
- Ads daily date uses the Ad Account timezone.
- Decimal money values parse directly to integer micros; `1 unit = 1,000,000 micros`.
- Conversion counts/values use an explicitly approved action type; never sum every action.
- `target_roas` never maps to `actual_roas`.

## Ownership contract

DEV uses developer-owned App, Business assets, Page, Professional Instagram account, test Ad Account, Cloudflare and Lark. Production must use customer-owned resources with the developer invited using least privilege.

## Large-account targets

- Facebook: at least 5,000 posts
- Instagram: at least 2,000 media/posts
- Meta Ads: a large async Insights fixture proving bounded polling/page/chunk resume

Every flow requires full backfill, incremental sync, periodic reconciliation, bounded pagination and memory, durable resume, stable-key idempotency, completeness accounting, typed retry and customer-owned Live UAT.

## Out of scope until approval

- Connector implementation
- Worker routes or Queue producers
- Lark Apply or record writes
- Meta token/app-review operations
- Cloudflare deploy or schedule enablement
- Production changes
- Ads write operations

## User review gate

The user must approve:

1. 14 RAW tables and 371 field contracts
2. `MKT_Accounts_Daily`
3. Organic daily vs lifetime snapshot semantics
4. Ads aggregate vs breakdown handling
5. Integer-micros money handling
6. Conversion and attribution policy
7. Config-only customer onboarding
8. DEV/Production ownership and access checklist
9. Large-account UAT gates

After approval, change status to `approved_for_implementation`.

## Planned releases after approval

- `v0.12.1` — Meta transport hardening, single-page pagination and identity/access preflight
- `v0.12.2` — Facebook + Instagram Organic schema/runtime/reconciliation/UAT
- `v0.12.3` — Meta Ads schema/runtime/attribution/reconciliation/UAT

## Implementation result

`not_started — blueprint/source-contract review only`

No connector code, Lark mutation, external Meta API call, Queue job, D1 migration, Worker deploy, schedule change or Production mutation was performed.