# Lark Dashboard Display V2 Compatibility Recovery v1

## Status

```text
TASK_STATUS                         IMPLEMENTATION_IN_REVIEW
CONTRACT_VERSION                    lark_dashboard_display_v2_compatibility_v1
TARGET_TABLE                        📊 MKT_Report_Metric_Values
TARGET_FIELD_ID                     fldHNUhCfl
TARGET_FIELD_NAME                   __mkt_legacy_display_name_single_select_v2
REMOTE_ACTION_DURING_IMPLEMENTATION 0
PRODUCTION                          BLOCKED
```

`docs/current-task.md` remains owned by the Meta workstream and is not modified by this hotfix.

## Correction of the previous closeout

The earlier Compatibility Freeze closeout proved only the Window Select dimension:

```text
fldMlTUP3Z / __mkt_legacy_window_days_single_select_v1
28 Record cells updated
pending window updates 0
```

That operation did not populate the Display V2 field used by the 17 Organic Statistics filters.
The Dashboard therefore remained blank even though the Window Slicer compatibility field had converged.
The previous statement that the Dashboard compatibility scope was fully closed was incorrect and is
superseded by this task.

## Audited live boundary

The Integration Workspace Base export and screenshot establish:

```text
Report Metric records                         86
Dashboard performance records                 68
Organic Dashboard matrix                      17 metrics x 4 windows
Windows                                       1 / 3 / 7 / 30
Baseline-incomplete current_value=null rows   24
Display V2 already correct                    18
Display V2 blank                              48
Reviewed semantic alias corrections            2
Required Display V2 Record updates            50
```

The two reviewed alias corrections are the 3-day and 7-day rows for:

```text
tiktok:baseline_coverage_rate
current V2  Baseline coverage
required V2 Baseline Coverage Rate
```

`Baseline coverage` remains the correct Dashboard label for:

```text
tiktok:baseline_covered_content_count
```

## Exact compatibility mapping

```text
tiktok:period_views                         Views
tiktok:period_likes                         Likes
tiktok:period_comments                      Comments
tiktok:period_shares                        Shares
tiktok:period_engagement                    Engagement
tiktok:period_engagement_rate               Engagement rate
tiktok:latest_total_views                   Latest total views
tiktok:latest_total_likes                   Latest total likes
tiktok:latest_total_comments                Latest total comments
tiktok:latest_total_shares                  Latest total shares
tiktok:latest_total_engagement              Latest total engagement
tiktok:latest_engagement_rate               Latest engagement rate
tiktok:new_content_count                    New content
tiktok:tracked_content_count                Tracked content
tiktok:baseline_covered_content_count       Baseline coverage
tiktok:baseline_missing_content_count       Baseline Missing Content
tiktok:baseline_coverage_rate               Baseline Coverage Rate
```

## Repository correction

1. Add one shared compatibility mapping owned by Config.
2. Extend the permanent Metric row writer so future Integration Workspace TikTok Organic Dashboard
   materializations write Display V2 automatically.
3. Restrict permanent Legacy compatibility to:

```text
customer_profile  integration_workspace
account_id        chemistry_k
platform          tiktok
capability        organic
report_type       dashboard_performance_report
```

4. Add a guarded Record-only operator for the existing 50-row gap.
5. Preserve the retired Dashboard PATCH tombstones.

## Live Record-only contract

The operator may update only:

```text
fldHNUhCfl / __mkt_legacy_display_name_single_select_v2
```

It must:

- resolve exact physical Field IDs, names and types;
- verify all reviewed V2 options already exist;
- require 86 total records and the exact 68-row 17x4 Dashboard matrix;
- require all 68 preserved Window Select values to agree with Number `window_days`;
- require exactly 24 `current_value=null` rows;
- accept only the exact pre-apply state `48 blank + 2 reviewed aliases`;
- reject every other populated disagreement;
- back up reviewed values before writing;
- use Public Bitable Record batch update only;
- read all records again after writing;
- require all 68 V2 cells converged, pending 0 and conflicts 0;
- compare a SHA-256 fingerprint of every Record field except V2 before and after.

## Forbidden mutations

```text
Dashboard Block PATCH          0
Dashboard layout mutation      0
Field create/update/delete     0
current_value mutation         0
Record create/delete           0
D1 mutation                    0
Worker deployment              0
Queue send                     0
Schedule mutation              0
Production                     BLOCKED
```

The 24 baseline-incomplete rows remain `current_value=null`. The task does not fabricate zeroes or values.

## Commands after merge

Read-only preview:

```bash
node scripts/lark-dashboard-display-v2-compatibility-backfill.mjs
```

Live execution requires both exact clean `main` and:

```text
CONFIRM_LARK_DASHBOARD_DISPLAY_V2_BACKFILL=
BACKFILL_DISPLAY_V2_WITHOUT_DASHBOARD_FIELD_OR_VALUE_MUTATION
```

No Live execution is authorized until the exact post-merge preview is reviewed and confirms:

```text
recordCount                       86
dashboardRecordCount              68
baselineIncompleteNullRecordCount 24
populatedDisplayV2Count           20
convergedDisplayV2Count           18
missingValueUpdateCount           48
reviewedAliasCorrectionCount       2
pendingRecordUpdateCount          50
displayV2ConflictCount             0
remoteMutationCount                0
```

## Acceptance criteria

```text
Shared mapping has exactly 17 unique Metric keys/labels     yes
Special baseline labels remain distinct                     yes
Permanent writer prevents recurrence                        yes
Permanent writer is Integration Workspace-only              yes
Initial planner reproduces 86/68/24 and 48+2=50             yes
Every planned write contains only Display V2                yes
Unexpected populated values fail closed                     yes
Missing/duplicate metric-window matrix fails closed         yes
Shared batch callback uses chunk/chunks/rows                 yes
Full repository gates pass                                  required
Remote action during implementation                         0
```
