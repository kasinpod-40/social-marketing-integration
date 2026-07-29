# Organic Dashboard Window Repair Operator v1

Status: `IMPLEMENTED_REVIEW_PENDING`

## Goal

Repair the deterministic TikTok Organic 3D and 7D Dashboard materializations after the
rolling-window baseline-integrity fix, and create exact 1D and 30D materializations for the same
latest completed source period.

## Controlled sequence

```text
3D refresh -> 7D refresh -> 1D fresh -> 30D fresh
```

The wrapper first runs the Report Schema/Settings finalizer so the canonical 58 Report Settings,
including 1D, are present before any materialization is admitted.

## One command after merge

```bash
CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR=EXECUTE_REPORT_RUNTIME_WINDOW_REPAIR node scripts/report-runtime-window-repair.mjs --execute
```

Run only from a clean local `main` checkout equal to `origin/main`, with the reviewed DEV secrets,
Cloudflare authentication and Lark mappings available.

## Refresh contract

- Refresh is approved only for exact 3D and 7D deterministic identities.
- The D1 materialization must already exist exactly once.
- The Lark Snapshot must exist exactly once and its Metric rows must be present.
- Regeneration uses the normal Queue job and shared Report/Lark upsert path.
- The `report_id`, `report_metric_key` and `report_content_key` stable identities are retained.
- No D1 row or Lark record is manually deleted or edited.
- The prior payload checksum must be replaced while the D1 materialization row count remains one.

## Fresh contract

- Exact 1D and 30D identities must be absent from both D1 and Lark before execution.
- Each materialization must transition from zero to exactly one deterministic D1 row.
- Replay of the exact same Queue job must keep the payload checksum and all Lark stable-key rows
  unchanged.

## KPI-integrity readback

For every window the operator parses the persisted D1 payload, reads the exact Lark Metric rows and
requires the metric-key set and current values to match. When baseline coverage is below `1`, all
six aggregate period KPIs must remain null:

```text
period_views
period_likes
period_comments
period_shares
period_engagement
period_engagement_rate
```

This prevents a numeric partial subset from reappearing as a customer KPI.

## Runtime safety

- DEV / Integration Workspace only.
- Connector flags remain false; no provider API call is made.
- AI and Report schedules remain false.
- One D1 export backup is created before every window.
- Each window receives an isolated evidence directory.
- Every active Report-only Worker deployment is restored to an all-false version in `finally`.
- Any failed prestate, duplicate, missing identity, pending migration, DLQ item, lock, checksum drift,
  D1/Lark mismatch or restore failure blocks the workflow.
- Production remains blocked.

## Evidence

Default root:

```text
outputs/report-runtime-window-repair/
```

The final sanitized summary is:

```text
outputs/report-runtime-window-repair/report-runtime-window-repair-summary.json
```
