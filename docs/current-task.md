# Current Task — Ads Schema DEV Closeout v0.13.0

## Status

- **Task status:** `closed_automated_schema_pass_manual_ui_handoff`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Merged implementation:** `PR #10`
- **Merged baseline:** `abe2fc3fdbfc81c7c3b2480210ab3762cc42e2e6`
- **Live Lark mutation:** `completed_and_verified`
- **Meta schema:** `apply_pass_zero_drift_pass`
- **Canonical Ads v2 migration:** `pass_zero_drift_pass`
- **Google Ads automated schema:** `pass_zero_drift_pass`
- **Manual Lark UI:** `4_formulas_and_17_view_filters_pending`
- **Connector implementation:** `not_started`
- **Cloudflare/Queue/D1/Schedule:** `unchanged_for_this_task`
- **Production mutation:** `none`
- **Last updated:** `2026-07-22`

งาน Guarded Shared-table Apply และส่วนขยาย Ads/Google Ads Schema ถูก Apply ลง Lark DEV จริงแล้วและตรวจกลับด้วย Live Preview และ `.base` export. งานอัตโนมัติของ Scope นี้ปิดแล้ว; งานที่เหลือเป็น Manual UI handoff และ Connector/Access scope แยกต่างหาก.

## Objective completed

ปิด Data-model-first และ Lark Schema foundation สำหรับ Organic/Ads แบบ Shared-table โดย:

- รักษา `RAW_TikTok_Creator_Videos` เป็น Lark Native protected read-only source;
- Reuse Planned Raw tables ตาม Shared-table contract โดยไม่ลบ Record;
- Apply Meta Ads extensions และ Canonical Ads v2 แบบไม่สร้าง Canonical core ซ้ำ;
- เพิ่ม Google Ads RAW/Canonical extensions, Relations และ View shells;
- รองรับ Partial resume และตรวจ Zero drift หลัง Apply;
- ไม่เขียน Business Record, ไม่เรียก Platform source API, ไม่ Deploy Worker และไม่เปิด Schedule ในงาน Schema นี้.

## Verified live result

Latest audited export: `Social MKT Data Hub(8).base`

- Base revision: `51`
- Physical tables: `42`
- Duplicate table names: `0`
- Google RAW tables: `13/13`
- Google RAW fields: `208/208`
- `MKT_Ads_AssetGroups`: `PASS`
- Canonical Ads v2 core: `63/63`
- Google Ads Relations: `12/12`
- Google Ads View shells: `19/19`
- Automated schema issues: `0`
- New Google tables containing Records: `0`
- Remaining schema actions: `0`
- Remaining View-shell actions: `0`
- Blockers/warnings: `0/0`
- Record writes/deletes: `0/0`

## Manual UI handoff

OpenAPI-supported work is complete. The following Lark UI work remains and is deliberately not treated as an automated schema failure:

### Formula expressions — 4

1. `MKT_Ads_Campaigns.budget`
   - `IF({budget_micros}=BLANK(), BLANK(), {budget_micros}/1000000)`
   - format `0.00`
2. `MKT_Ads_Daily.all_conversion_value`
   - `IF({all_conversion_value_micros}=BLANK(), BLANK(), {all_conversion_value_micros}/1000000)`
   - format `0.00`
3. `MKT_Ads_Daily.cost_per_conversion`
   - `IF(OR({conversions}=BLANK(),{conversions}=0,{spend}=BLANK()),BLANK(),{spend}/{conversions})`
   - format `0.00`
4. `MKT_Ads_Daily.conversion_rate`
   - `IF(OR({clicks}=BLANK(),{clicks}=0,{conversions}=BLANK()),BLANK(),{conversions}/{clicks})`
   - format `0.00%`

### View filters

- Contract View shells exist `19/19`.
- Filters verified from the latest `.base` export: `2/19`.
- Filters still pending in Lark UI: `17/19`.
- The two verified Views are:
  - `MKT_Ads_Accounts` → `Google Ads Accounts` with `platform = google_ads`;
  - `MKT_Ads_Campaigns` → `YouTube Ads Campaigns` with `platform = google_ads` and `ad_channel = youtube_ads`.

After completing the 4 Formula expressions and 17 View filters, export the Base again and perform a final offline audit. Do not rerun Apply merely to clear manual UI actions.

## Live apply history

- PR #10 was Squash Merged into `main` at commit `abe2fc3fdbfc81c7c3b2480210ab3762cc42e2e6`.
- Meta schema Apply passed and returned zero drift.
- Canonical Ads v2 migration passed and returned `63/63` zero drift.
- Google Ads executor resumed safely across partial stages.
- Final executor version: `0.13.0-rc5.1`.
- Final automated status: `SCHEMA_APPLY_MANUAL_UI_REQUIRED`.
- All 16 missing Google Ads View shells were created; final verification returned `viewActions=0`.
- No rollback or destructive cleanup is required.

## Scope explicitly not completed here

- Google Ads data extraction/normalization connector;
- Google Ads customer account selectable-access/UAT;
- TikTok Ads connector or production access;
- Facebook/Instagram Organic connectors despite completed access preflight;
- Meta Ads data connector despite valid no-data access preflight;
- WooCommerce and Chatwoot connectors;
- Multi-channel AI summary/notification completion;
- customer-real UAT rollout and customer-owned Production deployment.

## Progress model

Percentages are milestone estimates, not code coverage:

- Ads/Google Lark data model and automated schema: `95%` — only Manual UI remains.
- Google Ads channel end-to-end: `35%` — schema complete; access/UAT, connector, reliability and schedule remain.
- MKT DEV MVP across all planned channels: approximately `58%`.
- Chemistry K Production readiness: approximately `25%` because customer-owned UAT/Production rollout and several connectors remain.

Detailed channel percentages and weighting are recorded in `docs/project-brain/mkt-progress-v0.13.0.md`.

## Next gate

1. Complete and re-export the 4 Formula expressions and 17 remaining View filters.
2. Confirm Google Ads customer account link/selectability and run read-only live UAT.
3. Approve a separate Google Ads Connector task before any Worker/Queue/D1/Schedule implementation.
4. Keep every new connector and Production schedule disabled by default until its own access, identity, source-contract and reliability gates pass.

## Definition of done for this closed task

- [x] PR #10 merged.
- [x] Shared-table guarded Apply executed in developer-owned DEV.
- [x] Meta schema Apply and zero-drift verification passed.
- [x] Canonical Ads v2 migration and `63/63` verification passed.
- [x] Google Ads 13 RAW tables / 208 fields / 12 Relations / 19 View shells verified.
- [x] Zero destructive actions and zero Business Record writes verified.
- [x] Latest `.base` export audited with zero schema issues.
- [x] Manual UI work separated into an explicit handoff.
- [x] Modular Project Brain progress baseline prepared.
