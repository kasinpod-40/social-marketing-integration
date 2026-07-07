# 05 — Known Issues and Fixes

## Fixed: imported primary fields were wrong in several MKT tables
Some Lark tables imported from Excel used `platform` or `metric_date` as the locked primary field. This would have caused bad record names and weak upsert behavior.

Fix applied in Lark:
- Renamed/fixed primary fields to stable key fields such as `account_key`, `content_key`, `content_daily_key`, `campaign_key`, `ad_group_key`, `creative_key`, and `ads_daily_key`.
- Re-added `platform` and `metric_date` as normal fields where needed.

## Fixed: Lark Base organization was incomplete after import
The Base was organized after import:
- Sidebar folders created.
- Table icons added.
- Views with icons created.
- Field types and select options configured.

## Known risk: Native integration may create its own table
Some Lark Native Integrations may force-create their own target table or use field names that differ from our planned `RAW_*` tables.

Mitigation:
- Treat native-created tables as source raw tables if required.
- Keep naming and mapping documented in Project Brain.
- Do not build dashboards directly from raw/native tables.

## Known risk: Native integration overwrites rows
Native sync may update current rows instead of creating daily history. Mitigation: create daily snapshot tables and run snapshot jobs.

## Known risk: metric naming mismatch
Unique viewers must not be called reach unless confirmed by platform definition. Target ROAS must not be treated as actual ROAS.

## Known risk: API permission and app review delays
Production access and app review are not included in the 14-day dev estimate. Use client-owned production resources and native integrations where possible.

## Known risk: partial platform failures
One platform failure must not block other platforms. Mitigation: platform-scoped jobs, retry, DLQ, and sync logs.
