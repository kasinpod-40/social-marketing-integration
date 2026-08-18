# Customer Base View Manual Parity Evidence — 2026-08-18

## Authority

This evidence is derived from the user-run local-only operator on the exact approved Source export.

```text
operator                    customer_base_view_manual_parity_operator_v1
manifest                    customer_base_view_manual_parity_manifest_v1
manifest file               customer-base-view-manual-parity.json
manifest SHA-256            7dabe74dd30291623e1620127f49f31fb2bb5d8131b36fcffe1884b5b089dc10
manifest bytes              310264
source export SHA-256       c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
clone scope                 32 Tables / 705 Fields / 33,488 Records / 110 Views
remote requests             0
remote mutations            0
Target read/write           none
Customer Apply              disabled
```

The manifest is ID-redacted. Table/View/Field references are expressed by current names and every Source Field reference was resolved before output.

## Manual View ownership

The manifest originally reports represented layout metadata for all 110 clone Views. Manual execution must not repeat dimensions already owned by the automatic parity path.

### Automatic-owned — do not perform manually

- hidden fields: 11 Views / 85 hidden-field assignments represented in the manifest; handled by the shared View hidden-fields mutation and canonical verifier;
- filters: 78 Views from the approved clone-scope inventory; handled by the shared View filter mutation and canonical verifier;
- hierarchy: 1 View; handled by the documented `hierarchy_config.field_id` phase and GET readback.

### Manual-owned — exact checklist authority

```text
field order Views            110
sort Views                    41
group Views                    4
column-width Views            70
column-width assignments     898
row-height Views             110
frozen-column Views          110
```

`colInfos.hidden` is not a manual action. A `colInfos.width = null` entry is also not a manual width action; it represents no explicit custom width. Only non-null widths are manual-owned.

Across the 898 explicit width assignments:

- 879 assignments are width `180`;
- 19 assignments use a non-180 custom width.

All 110 Views have:

- `rowHeightLevel = 1`;
- `frozenColCount = 1`.

Only `⚙️ MKT_Report_Settings` has more than one field-order template across its Views. Every other clone Table uses one field-order template shared by all its Views, although the setting remains per-View in the UI.

## Sort profiles

The 41 sorted Views collapse to eight exact profiles:

```text
metric_date DESC          18 Views
generated_at DESC         13 Views
rank ASC                   5 Views
last_order_at DESC         1 View
last_activity_at DESC      1 View
rank DESC                  1 View
source_created_at DESC     1 View
source_modified_at DESC    1 View
```

## Group profiles

All four grouped Views use one exact profile:

```text
platform DESC
```

The four Views are:

- `🏆 MKT_Report_Top_Content` → `🏆 Top Content`
- `📊 MKT_Report_Metric_Values` → `📊 Client Metrics`
- `📊 MKT_Report_Metric_Values` → `🧭 Dashboard Metrics`
- `📣 MKT_Ads_Campaigns` → `🔵 Meta Ads Campaigns`

## Non-180 custom width assignments

These are the only width assignments that differ from the common width `180`:

- `⚙️ MKT_Report_Settings` → `⛔ Disabled Reports` → `report_setting_key = 212`
- `⚙️ MKT_Report_Settings` → `✅ Enabled Reports` → `report_setting_key = 218`
- `🏆 MKT_Report_Top_Content` → `🏆 Daily Top Content` → `report_setting_key = 239`
- `📊 MKT_Report_Metric_Values` → `📊 Client Metrics` → `__mkt_legacy_display_name_single_select_v2 = 337`
- `📊 MKT_Report_Metric_Values` → `📊 Client Metrics` → `metric_key = 258`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `applies_to = 104`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `confidence = 116`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `match_type = 114`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `output_value = 130`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `priority = 87`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `rule_key = 215`
- `📚 MKT_Classification_Dictionary` → `📋 All Classification` → `target_field = 145`
- `🧠 MKT_AI_Report_Runs` → `🧪 Preview Runs` → `insight_summary = 257`
- `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts` → `alert_id = 330`
- `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts` → `alert_message = 344`
- `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts` → `platform = 257`
- `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts` → `severity = 243`
- `🚨 MKT_System_Alerts` → `📊 Dashboard Alerts` → `status = 177`
- `🚨 MKT_System_Alerts` → `🚨 Open Alerts` → `alert_id = 225`

The exact 879 width-180 assignments and every per-View field order remain in the retained manifest and are not duplicated into this summary document.

## Execution procedure

Manual View layout work is **post-Apply only**. Do not create or edit customer Views before the controlled clone has created the 32 migration-owned Tables.

For every manifest View:

1. confirm the exact Table and View name;
2. set field order exactly as `manual.fieldOrder`;
3. when `manual.sortInfo` exists, set the exact sort field/direction;
4. when `manual.group` exists, set the exact group field/direction;
5. for `manual.colInfos`, set only entries with a non-null `width`; do not manually repeat hidden state;
6. set row height to level `1`;
7. freeze the first column (`frozenColCount = 1`).

Hidden fields, filters and hierarchy remain automatic-owned and must be verified through their existing readback/canonical paths.

## Verification contract

Full parity cannot be declared from manual completion claims alone.

After controlled Apply and manual View layout completion:

- canonical GET-only verification must pass for Table/Field/Record/Relation/Formula/View name/type/public/hidden/filter;
- documented hierarchy GET readback must pass;
- the exact manifest remains the authority for field order, sort, group, non-null column widths, row height and frozen columns;
- a post-configuration customer `.base` export should be compared locally by Table/View/Field names for these manual-owned dimensions before the View-layout blocker is closed;
- protected TikTok and all unrelated pre-existing customer Tables remain outside this comparison.

No undocumented OpenAPI View payload is authorized by this evidence.
