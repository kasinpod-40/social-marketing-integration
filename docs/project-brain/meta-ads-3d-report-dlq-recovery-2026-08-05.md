# Project Brain — Meta Ads 3D Report DLQ Recovery

Date: `2026-08-05`

## Locked incident truth

The reviewed Run All on `main@0db4c297d25678b8996033e2b0fdc29aae886c03` completed prior channels and
Meta Ads 1D first/replay, then stopped while waiting for Meta Ads 3D first delivery. The 3D job was not observed within
the old 24-by-five-second polling window. The executor restored the preserved Notification Runtime baseline. The
delayed job was then rejected by the baseline Worker with `DASHBOARD_REPORT_CONFIGURATION_INVALID`, retried four
times and entered exactly one open Report DLQ.

```text
DLQ             terminal:e408707c9c2d383e04a3e213a7be45a0
Message ID      e408707c9c2d383e04a3e213a7be45a0
Requested-at    1785934718928
Window          3D
Job SHA-256     cb25578b3e5f6034425ae10772adf1a85efc20634dcdc7470377bf143340102d
Materialization 0
Prior successes 2
Work/Lock       0 / 0
Baseline        restored active Notification Runtime
```

The historical operation work key begins with `tiktok:` even though this is Meta Ads. That value is retained
forensic metadata and is not evidence of a TikTok job. Recovery must match it exactly and must not rewrite it.

## Root-cause decision

This incident is a Queue completion-window race. It is not a Meta Provider, Coverage, source fact, Stable Report ID,
D1 materializer or Lark writer defect.

The old success-only wait permitted the Active Worker to be restored before a delayed admitted message reached a
terminal success or DLQ outcome. A deployment-stability barrier alone does not protect the period after Queue
admission.

## Locked correction

```text
Run All child
→ reviewed Active Worker
→ stable deployment samples
→ Queue delivery
→ up to 120 completion polls
→ D1/Lark success and exact replay
→ preserved baseline restore
```

The 120-poll value remains bounded and can be overridden only through the existing explicit environment contract.
Normal fast completions do not wait the full budget.

## Exact recovery authority

The existing configuration-DLQ recovery implementation is generalized through immutable incident definitions. The
completed Facebook 1D incident remains the backward-compatible default. Meta Ads 3D is selected only by exact key:

```text
MKT_REPORT_RUNTIME_CONFIG_DLQ_INCIDENT=meta_ads_3d_20260731
```

It requires exact confirmation:

```text
RECOVER_EXACT_META_ADS_3D_REPORT_CONFIG_DLQ
```

Recovery may send exactly two Queue messages after merge and exact-head Finalizer:

1. the exact original 3D job once;
2. the exact same job once for idempotency proof.

Only after D1/Lark completion, replay parity and preserved baseline restore may the exact DLQ and metadata be marked
complete. The forensic row is retained.

## Forbidden actions

- rerun the failed Run All evidence root;
- reuse its retained handoff;
- generic DLQ redrive or deletion;
- send another Meta Ads 1D job;
- change the 3D requested-at, report ID or payload;
- manually edit D1/Lark Report rows;
- refresh Provider data as a substitute for recovery;
- enable Notification Admission, Schedule or Production.

## Remaining Dashboard work

`__mkt_legacy_display_name_single_select_v2` is still a separate Dashboard compatibility defect. Materialization
completion does not automatically repair that field. After all seven ready channels and 28 windows are closed, the
Shared Lark Metric writer/backfill must populate the compatibility display field without creating duplicate Report
rows or rerunning Provider ingestion.
