# Project Brain — Meta Ads 3D Queue Activation Continuation

Date: `2026-08-05`

## Verified incident

After PR #513 corrected the exact `102 Ads / 105 bindings` D1 defect, PR #514 submitted the same byte-stable Meta Ads
3D job under a reviewed Active Worker deployment. The job was terminalized once with
`DASHBOARD_REPORT_CONFIGURATION_INVALID` before `runReliableSync`:

```text
continuation requested-at  1785943887248
DLQ                        terminal:228fecb8afc03a3339313a85fbb5c45c
main Queue attempts         1
Sync Runs                   0
materialization             0
Work / lock                 0 / 0
baseline restored           true
```

The Worker version verifier had observed the Report flags as true. The exact job and payload had previously passed the
same job guard and reached D1 six times. Therefore this incident is not a job-shape or D1-reader regression; it is a
Queue-consumer activation boundary.

## Shared reliability gap

The prior remote verifier checked:

- one Worker version at 100% deployment;
- exact execution flags;
- D1 and Queue bindings;
- required Lark mappings;
- three samples across 30 seconds.

It did not read the actual Queue consumer inventory. The main Queue allows a 30-second batch wait, so Worker deployment
status can be stable before a queued delivery observes the Report execution window.

## Locked correction

- read the official Queue consumer inventory before any Report send;
- require one exact `social-mkt-sync-worker` consumer and reviewed settings;
- use three exact deployment samples over 120 seconds only for Report execution windows;
- retain the original 30-second Notification baseline restore barrier;
- bind all three forensic DLQs in continuation v2;
- close none until first materialization, exact replay, D1/Lark integrity and baseline restore pass.

## Safety

The Repository implementation performs no Remote Worker deployment, Queue action, Provider request or D1/Lark
mutation. Notification Admission and schedules remain false. Production remains blocked.

## Prohibited reruns

Do not repeat:

- `outputs/report-live-resume-0db4c297d256`;
- `outputs/meta-ads-3d-exact-recovery-5b35861553d2`;
- `outputs/meta-ads-3d-d1-bind-continuation-d3bbaa33fb51`.

A post-merge v2 continuation must use a new exact evidence root and may run only once after its first Queue send.
