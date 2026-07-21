# Offline Shared-table Schema Preview — Current DEV Base Export

Source: user-provided `Social MKT Data Hub(6).base`, inspected locally and not committed.

The preview adapter reads only table/field/view metadata and record counts. It does not expose cell values and does not perform any network or write operation.

## Result

- Current unique tables: 26
- Tables in Shared-table scope: 7
- Empty Planned Raw tables eligible for In-place reuse: 5
- Planned table renames: 5
- Planned new tables: 2
- Planned missing Fields on reused tables: 98
- Planned existing Field metadata update: 1 (`status` description)
- Planned Views: 17
- Protected TikTok Native actions: 0
- Delete actions: 0
- Record writes: 0
- Conflicts: 0

## Blocking evidence

The export does not provide authoritative Primary-field metadata for the five reused tables. Preview therefore retains five `PRIMARY_FIELD_REVIEW_REQUIRED` blockers and reports `readyForApplyAuthorization=false`.

The live DEV Read-only Preview must confirm exactly one Text Primary field in each reuse table. When confirmed, the planner can replace each manual blocker with a safe Primary-field rename plan while preserving the Table ID.

No Apply command exists in this task.
