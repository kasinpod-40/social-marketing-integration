# Guarded Shared-table Schema Apply v0.12.3

## Purpose

PR #10 implements the mutation layer only after the Shared-table contract and live DEV Read-only plan passed. It does not run the live Apply during development or review.

## Guard chain

A live run requires the dedicated Apply script plus both confirmations:

```bash
CONFIRM_WRITE=YES CONFIRM_SHARED_TABLE_SCHEMA=YES npm run setup:shared-table-schema:apply
```

The command also requires the runtime to resolve to developer-owned `development` / `dev_ft_pumkin`. UAT and Production fail before mutation.

Before the first write, the command regenerates the complete Preview and requires:

- zero conflicts, warnings and manual blockers;
- all five reuse candidates resolved and still empty when rename is needed;
- protected `RAW_TikTok_Creator_Videos` found exactly once with zero actions;
- only approved Table, Field and View actions;
- no delete or Record operation.

## Mutation order and recovery

Actions run sequentially:

1. rename five reusable empty tables in place;
2. rename their Primary Text fields in place;
3. create/update approved Fields;
4. create the two missing Canonical tables;
5. create/configure approved Views through the existing live-verified View resolver;
6. rerun Schema and View planning and require zero drift.

Every confirmed step is reported. If a later call fails, rerunning the same command reconciles current names, Field IDs, Table IDs and View properties rather than repeating completed creates.

## Physical scope

Reuse in place, preserving Table IDs:

- `RAW_TikTok_Business_Campaigns` → `RAW_Meta_Organic_Accounts`
- `RAW_TikTok_Business_AdGroups` → `RAW_Meta_Organic_Content`
- `RAW_TikTok_Business_Ads` → `RAW_Meta_Organic_Metrics`
- `RAW_Google_Campaigns` → `RAW_Ads_Entities`
- `RAW_Google_Customer_Lists` → `RAW_Ads_Daily`

Create only:

- `MKT_Account_Daily`
- `MKT_Ads_Ads`

## Lark contract

Table rename uses Lark Base v3:

```text
PATCH /open-apis/base/v3/bases/:base_token/tables/:table_id
{"name":"<new name>"}
```

The Lark app must have `base:table:update`. Existing Field and View write permissions used by prior installers are also required.

## Explicit exclusions

The Apply has no code path to delete Tables/Fields/Views/Records, write Business records, modify the Native TikTok source, call Social/Ads APIs, deploy Cloudflare, mutate D1/Queue/Schedules or create/activate/spend on advertisements.

Real Table IDs and live output must stay in ignored local configuration and must not be committed.
