# 10 — Next Actions

## Current actionable sequence — 2026-08-17

1. Complete the current-main port of the Lark Number formatter precision fix and pass repository CI.
2. Close obsolete Draft PRs that have been superseded by current `main`; retain TikTok Ads PR #220 as deferred work.
3. Do not run Shared Dimensions Backfill Apply merely for this formatter closeout; the operator remains guarded and preview-first.
4. After `2026-08-24 08:30 Asia/Bangkok`, read the Automatic Weekly v6 result read-only and require scheduled exactly-once evidence. Do not substitute a manual/control run.
5. Keep Production provisioning/UAT as a separate customer-owned workstream.

## Explicitly deferred

```text
TIKTOK_ADS = DEFERRED_BY_USER
```

Do not merge, deploy, provision credentials, generate invitations, enable schedules or perform customer OAuth for TikTok Ads under this closeout.

## Safety boundaries

- no Worker deployment from repository cleanup
- no Queue send/replay or DLQ redrive
- no Remote D1 mutation/migration
- no Lark mutation
- no Schedule/Secret/Binding change
- no Production action
- failed historical Weekly identities remain immutable forensic evidence

Historical Next Actions before this closeout are preserved byte-for-byte at
`docs/project-brain/archive/10-next-actions-pre-closeout-2026-08-17.md`.
