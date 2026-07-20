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


## Lark Number field `WrongRequestBody` (v0.8.1 Apply)

- Symptom: `1254001 WrongRequestBody` on `decimal_places` with `appliedActionCount=0`.
- Root cause: Report Schema used spreadsheet patterns (`#,##0`, `#,##0.0000`) instead of Lark OpenAPI formatter enums.
- Fix in v0.8.2: use `1,000` for grouped integers and `0.0000` for four decimal places; normalize legacy aliases in the shared Field contract.
- Recovery: upgrade, Preview, then Apply again. No rollback is required when applied action count is zero.


## Lark View PATCH `WrongRequestBody` (v0.9.0–v0.9.4)

- Symptom: every live Apply failed on the first existing View with Lark `1254001 WrongRequestBody`; `appliedActionCount=0` each time.
- v0.9.1–v0.9.3 changed value encoding, `field_type`, and Primary hidden-field handling one hypothesis at a time. Because the tenant continued rejecting the first combined PATCH, none of those hypotheses is considered a confirmed standalone root cause.
- Safe evidence: `details.viewMutationBody` exposes the exact non-secret outgoing body.
- Confirmed root cause in v0.9.5: `field_type` and `condition_omitted` are response-only and must not be echoed into Update View; Checkbox must be encoded as boolean `[true]`, not string `["true"]`.
- Verification fix: this tenant's List Views response omits `property`, so the installer uses Get View before comparing Filter state.
- Live recovery completed: two existing Views were updated, four missing Views were created, and Final Preview reports zero actions/conflicts.
- Limitation: Hidden-field/API behavior may vary by tenant; presentation settings are intentionally kept outside the blocking automation path.

## Fixed: YouTube Hyperlink `field validation failed` during Schema Apply

- Symptom: Live Apply created `RAW_YouTube_Channels` then failed creating `RAW_YouTube_Videos` with Lark `99992402 field validation failed`; `appliedActionCount=1`.
- Confirmed root cause: the derived YouTube schema used `ui_type=URL`, while Lark OpenAPI requires the case-sensitive enum `Url` for type 15 Hyperlink fields.
- Fix: map type 15 to `Url` and cover every derived YouTube Hyperlink field with a regression assertion.
- Recovery: idempotent Apply resolved the existing Channels table, created Videos and Analytics, and Final Preview returned zero actions/conflicts/warnings/manual actions.

## Fixed: YouTube RAW table presentation differed from the existing Base convention

- Symptom: the three newly applied tables had no emoji prefix, appeared outside `🧪 Raw Integration Tables`, and their Field info was English while the existing Base uses Thai descriptions.
- Fix: use emoji-prefixed create names with backward-compatible aliases, maintain Thai presentation descriptions separately from the English Blueprint semantics, and detect description drift in Preview/Apply.
- Update safety: Lark Field update is a full update, so the installer retains existing field properties and Select option IDs while changing managed descriptions.
- Live verification: 42 Field updates applied successfully, all three tables were renamed/moved in the UI, a Thai tooltip was visually verified, and the final read-only Preview returned zero actions/conflicts/warnings/manual actions.

## Fixed: Dead-letter Redrive states violated the legacy SQLite CHECK

- Symptom: Controlled Admin Redrive retried with `D1_DEAD_LETTER_REDRIVE_PREPARE_FAILED`; target incident remained `open` and unreserved.
- Confirmed root cause: migration 0002 restricted `dead_letter_jobs.status` to `open/replayed/resolved/discarded`, while migration 0005 attempted `redrive_pending/redriven` without rebuilding that CHECK constraint.
- Fix: migration 0006 rebuilds only `dead_letter_jobs`, copies every row behind an equal-count guard, preserves all columns/indexes and permits both durable Redrive states.
- Recovery rule: keep Schedule/Analytics/Redrive off, drain Queue, apply 0006, verify row count/indexes/status mutation, then rerun one controlled incident before enabling schedules.
