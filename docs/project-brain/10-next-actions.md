# 10 — Next Actions

## Current actionable sequence — after repository closeout

Repository cleanup is complete. Do not reopen or merge the superseded Draft PRs.

1. After `2026-08-24 08:30 Asia/Bangkok`, read the Automatic Weekly v6 result read-only.
2. Require scheduled exactly-once evidence for the expected Weekly period, Quality Gate pass, one delivery claim/message parity, and no new alert/DLQ/active lock caused by the scheduled path.
3. Do not replay/reset/redrive retained failed Weekly identities and do not substitute a manual/control run for scheduled evidence.
4. Keep Production provisioning/UAT as a separate customer-owned workstream.

## Explicitly deferred

```text
TIKTOK_ADS = DEFERRED_BY_USER
OPEN_PR    = #220
```

Do not merge, deploy, provision credentials, generate invitations, enable schedules or perform customer OAuth for TikTok Ads until the user explicitly resumes that workstream.

## Repository state

```text
MAIN                    = c1203cd3d96be7ae9616adad08d8c6b64d8b3cfe
REPOSITORY_CLOSEOUT     = COMPLETE
OBSOLETE_PRS_CLOSED     = 11,17,66,249,595
OPEN_PRS                = 220_ONLY
REMOTE_RUNTIME_MUTATION = ZERO_FROM_CLOSEOUT
```

Historical Next Actions before this closeout are preserved byte-for-byte at
`docs/project-brain/archive/10-next-actions-pre-closeout-2026-08-17.md`.
