# Meta Ads 3D D1 Bind Exact Continuation v1

Date: `2026-08-05`

## Objective

Continue the failed Meta Ads 3D Report recovery exactly once after live SELECT-only evidence proved that the old
Shared Paid Ads entity hydration query exceeded the reviewed D1 100-bound-parameter ceiling.

This is a continuation of retained work, not a rerun of the failed recovery root and not a new Report admission.

## Proven root cause

Live facts for `2026-07-29` through `2026-07-31`:

```text
Ranking rows 1D                 210
Ranking rows 3D                 630
Unique Ads 1D                    77
Unique Ads 3D                   102
Pre-fix entity bindings 1D       80
Pre-fix entity bindings 3D      105
D1 reviewed binding ceiling     100
Classification                  ENTITY_BIND_LIMIT_CONFIRMED
```

The old reader reserved three fixed bindings for customer, platform and account, then appended every unique Ad ID.
1D stayed below the ceiling. 3D exceeded it deterministically. PR #513 fixed the Shared reader by chunking sorted
Ad IDs into groups of at most 97.

## Retained incident boundary

```text
Exact fixed main                2f87f7f342847a5dcd0cf794cd0a74e55ab76068
Report ID                       integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
Original requested-at           1785934718928
Failed recovery requested-at    1785938483493
Prior successful Sync Runs      2
Failed recovery Sync Runs       6
Target materialization          0
Target Lark rows                0
Active Work/Lock                0 / 0
Original configuration DLQ      terminal:e408707c9c2d383e04a3e213a7be45a0
Retry-exhaustion DLQ            dlq:2f292f08f5bdc4f12c91b68ceff71e1b
```

Both DLQs remain immutable and open until exact materialization, exact replay and preserved baseline restore pass.

## Existing Shared infrastructure reused

- exact Report Finalizer;
- Notification-preserving Report configuration window;
- reviewed Cloudflare session and Queue resolution;
- Shared Queue sender;
- Shared D1/Lark state readers and integrity checks;
- Shared Report candidate and Stable Report ID construction;
- Shared deployment stability checks;
- Shared D1 backup and exact metadata closure pattern.

No Report engine, Queue framework, D1 writer, Lark sync engine or Reliability framework is added.

## Exact execution sequence

1. Require clean exact merged `main` and exact-head Finalizer evidence.
2. Validate the retained failed-recovery attempt file.
3. Validate both retained SELECT-only inspector files.
4. Validate complete Meta Ads Coverage, zero Work/Lock, exactly two open Report DLQs and zero critical Report alerts.
5. Validate both DLQ rows, metadata and the exact original Queue payload.
6. Validate six retained failed runs, two prior successes and an empty D1/Lark target.
7. Create a fresh D1 backup.
8. Deploy and stabilize the reviewed Report-only Worker window.
9. Send the exact original Meta Ads 3D job once.
10. Verify one D1 materialization and D1/Lark integrity.
11. Send the exact same job once for replay.
12. Verify Stable Report ID, checksum and unchanged Lark/integrity evidence.
13. Restore and stabilize the preserved Notification Runtime baseline.
14. Close both retained DLQs with separate immutable closure references.
15. Write one sanitized private summary.

Polling reports failed-attempt progress and stops immediately once an exact new DLQ is observed. It never restores
the Worker while a retrying Queue message is still merely between attempts.

## Forbidden actions

- rerun `outputs/meta-ads-3d-exact-recovery-5b35861553d2`;
- rerun the prior Run All block or handoff;
- generic Queue resend or generic DLQ redrive;
- replacement Report ID, requested-at, period or source watermark;
- manual D1/Lark Report insertion;
- Provider/source refresh;
- close either retained DLQ before replay and baseline restore;
- enable Notification Admission, AI, Schedule or Production.

## Acceptance criteria

- exact fixed repository Head and exact Finalizer evidence are required;
- root-cause inspector proves `102 Ads / 105 bindings` for 3D and `77 Ads / 80 bindings` for 1D;
- both retained DLQs and their operation metadata match exactly;
- the exact original job is sent once, then replayed once;
- materialization count remains one and payload checksum remains stable;
- D1/Lark integrity and Lark Stable rows remain unchanged across replay;
- preserved Notification Runtime baseline is restored with three stable samples;
- both retained DLQs close only after all prior gates pass;
- Provider requests remain zero;
- Notification Admission, Schedule and Production remain disabled.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/report-runtime-meta-ads-3d-d1-bind-continuation.test.js
node --test tests/connectors/d1-ads-report-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
