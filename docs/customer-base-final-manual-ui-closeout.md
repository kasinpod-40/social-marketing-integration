# Customer Base final manual UI closeout

This is the only remaining customer-Base closeout lane before the final read-only export verification.

No Terminal mutation is required for these UI tasks.

## Lane A — View field order

Scope:

- 32 cloned Tables
- 110 cloned Views
- latest comparison: 105 Views require reorder, 5 already exact
- protected `🎵 RAW_TikTok_Creator_Videos` is excluded and zero-write
- Width is excluded by user decision

Rules:

- reorder existing visible columns only;
- preserve visible/hidden membership;
- preserve filters;
- preserve sorts;
- preserve groups;
- preserve row height;
- preserve frozen state;
- do not rename/create/delete fields;
- do not alter records;
- do not resize columns as part of parity.

The five `🔄 MKT_Sync_Log` Views were exact in the latest comparison and are skip-by-default.

Use exact Source SHA `9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7` and its manual View manifest as the order authority.

## Lane B — Dashboard manual remainder

Source: six Dashboards / 75 total components.

Already closed: 66 documented/API-supported blocks.

Do not recreate or rerun those 66 blocks.

### 1. 💬 Customer Service & Leads

Add slicer `📅 Period`:

- table: `📊 MKT_Report_Metric_Values`
- field: `__mkt_legacy_window_days_single_select_v1`
- selection: single
- style: tiled
- default: `7`
- Source grid: x9 y2 w3 h1

### 2. 🛡️ Data Quality & Operations

Add table view `🔄 Latest Sync Runs`:

- table: `🔄 MKT_Sync_Log`
- view: `📊 Dashboard Sync Health`
- Source grid: x0 y5 w12 h4

Add table view `🚨 Recent System Alerts`:

- table: `🚨 MKT_System_Alerts`
- view: `📊 Dashboard Alerts`
- Source grid: x0 y9 w12 h4

### 3. 📊 Executive Marketing Overview

Add slicer `📅 Period`:

- table: `📊 MKT_Report_Metric_Values`
- field: `__mkt_legacy_window_days_single_select_v1`
- selection: single
- style: tiled
- default: `7`
- Source grid: x9 y2 w3 h1

### 4. 🌱 Organic Performance

Add slicer `📱 Channel`:

- table: `📊 MKT_Report_Metric_Values`
- field: `platform`
- selection: single
- style: tiled
- default: `tiktok`
- Source grid: x0 y2 w9 h1

Add slicer `📅 Period`:

- table: `📊 MKT_Report_Metric_Values`
- field: `__mkt_legacy_window_days_single_select_v1`
- selection: single
- style: tiled
- default: `7`
- Source grid: x9 y2 w3 h1

### 5. 💰 Paid Ads Performance

Add slicer `📱 Channel`:

- table: `📊 MKT_Report_Metric_Values`
- field: `platform`
- selection: single
- style: tiled
- default: `meta_ads`
- Source grid: x0 y2 w9 h1

Add slicer `📅 Period`:

- table: `📊 MKT_Report_Metric_Values`
- field: `__mkt_legacy_window_days_single_select_v1`
- selection: single
- style: tiled
- default: `7`
- Source grid: x9 y2 w3 h1

### 6. 🛒 Commerce & Conversion

Add slicer `📅 Period`:

- table: `📊 MKT_Report_Metric_Values`
- field: `__mkt_legacy_window_days_single_select_v1`
- selection: single
- style: tiled
- default: `7`
- Source grid: x9 y2 w3 h1

## Dashboard theme

Set all six migrated MKT Dashboards to Source theme:

`summerBreeze`

Do this through Lark UI. Do not retry the previously failed Theme API PATCH path.

## Final acceptance sequence

After both manual lanes are complete:

1. Export the Target Base once.
2. Run final read-only View/export parity within the agreed scope.
3. Verify no View-order mismatch remains.
4. Verify Dashboard manual components/theme visually and from the export evidence available.
5. Confirm protected TikTok remained untouched.
6. Keep Width and Advanced Permission Roles excluded.
7. Only after final PASS may PR #661 be considered for Ready/Merge, and only with explicit user authorization.
