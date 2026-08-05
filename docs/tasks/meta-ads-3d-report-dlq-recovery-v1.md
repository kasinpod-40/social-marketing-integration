# Meta Ads 3D Report DLQ Recovery & Queue Completion Barrier v1

Date: `2026-08-05`

## Objective

Recover the exact Meta Ads 3D Report materialization job that was admitted by reviewed Run All evidence but remained
unobserved past the previous two-minute polling window, then reached the DLQ after the executor restored the
preserved baseline Worker. Prevent the same restore-before-consumption race for later channels by extending the
existing Run All completion barrier.

## Exact incident authority

```text
Original Repository Head  0db4c297d25678b8996033e2b0fdc29aae886c03
Platform                  meta_ads
Capability                paid_ads
Window                    3D
Period                    2026-07-29 through 2026-07-31
Source watermark          2026-07-31
Requested-at              1785934718928
Report setting            integration_workspace:meta_ads:rolling:3d
Report ID                  integration_workspace:meta_ads:rolling:3d:chemistry_k:rolling_days:2026-07-29:2026-07-31:meta-ads-v1
Job SHA-256                cb25578b3e5f6034425ae10772adf1a85efc20634dcdc7470377bf143340102d
DLQ                        terminal:e408707c9c2d383e04a3e213a7be45a0
Message                    e408707c9c2d383e04a3e213a7be45a0
Error                      DASHBOARD_REPORT_CONFIGURATION_INVALID
Retry count                4
Main Queue attempts        4
Existing successful runs   2
Target materialization     0
Active Work/Lock           0 / 0
```

The retained operation metadata uses the historical work key
`tiktok:e408707c9c2d383e04a3e213a7be45a0`; this exact value is forensic identity and must not be renamed or
normalized during recovery.

## Root cause

The shared executor submitted Meta Ads 1D first/replay successfully. It then submitted Meta Ads 3D first delivery and
waited 24 polls at five seconds. No new successful run was observed before the bounded timeout. The executor restored
the preserved Notification Runtime baseline in `finally`; the delayed Queue job then reached a Worker without the
reviewed D1-primary Report flags, retried four times and entered the DLQ.

## Shared correction

The existing Run All terminal now supplies `MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS=120` to each reviewed channel
child unless an explicit reviewed override is present. At the existing five-second interval this keeps the Active
Report window available for up to ten minutes while preserving bounded execution and automatic restore.

No Queue framework, Worker framework or Report engine is added.

## Exact recovery sequence

1. Require clean exact current `main == origin/main`.
2. Require current-head Report Runtime Finalizer evidence.
3. Require the original incident Head to be an ancestor.
4. Load the exact local `meta_ads-3d-send-first.attempt.json` evidence.
5. Regenerate and hash the exact original Queue job.
6. Read the exact DLQ and operation metadata.
7. Require complete Meta Ads source Coverage and validated Ads facts.
8. Require exactly two prior successful Meta Ads Report runs, zero active Work/Lock and an empty 3D target in D1/Lark.
9. Create a fresh private D1 backup.
10. Deploy and verify the reviewed Active Report Worker across three stable samples.
11. Submit the exact original job once and prove one D1/Lark materialization.
12. Submit the exact same job once and prove Stable ID, checksum and Lark/integrity replay.
13. Restore and verify the preserved Notification Runtime baseline.
14. Close only the exact DLQ and operation metadata under an immutable recovery reference.
15. Retain the forensic DLQ row; never delete it.

## Safety

```text
Generic Run All rerun          forbidden
Generic DLQ redrive            forbidden
Replacement Report identity    0
Provider request               0
Manual D1/Lark repair          0
Notification Admission         false
Schedule                       false
Production                     BLOCKED
```

## Acceptance criteria

- Both Facebook 1D and Meta Ads 3D incident fixtures pass the shared validators.
- The Meta Ads candidate reproduces the exact job SHA-256.
- Operation metadata checks the exact historical work key, four Queue attempts and zero DLQ delivery attempts.
- Recovery starts only from the exact empty 3D target with two prior successful Meta Ads runs.
- Exact closure SQL is bound to the incident DLQ, message, error, retry count, work key and attempt counts.
- Run All exposes the 120-poll completion barrier in plan and execution summaries.
- Full Repository, Workers runtime and Report reliability gates pass.
