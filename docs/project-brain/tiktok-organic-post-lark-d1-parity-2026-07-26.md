# TikTok Organic Post-Lark Daily Pipeline & Report D1 Parity — 2026-07-26

## Status

```text
IMPLEMENTATION_STATUS                 = IMPLEMENTATION_COMPLETE_REVIEW_PENDING
BASE_COMMIT                          = e9275b6fbd4c28cf0290434cc4a449373e2e2bf9
BRANCH                               = agent/tiktok-organic-post-lark-d1-parity
DRAFT_PR                             = #65
CODE_VERIFIED_HEAD                   = e3c00b93ea95b4a4e564f09cafacc40954b30593
BRANCH_VERIFICATION                  = #517 PASS
REMOTE_MIGRATION                     = NOT_APPLIED
WORKER_DEPLOYMENT                    = NOT_RUN
QUEUE_SEND                           = NOT_RUN
LARK_MUTATION                        = NONE
REMOTE_D1_MUTATION                   = NONE
SCHEDULES                            = DISABLED
LIVE_UAT                             = NOT_RUN
PRODUCTION                           = BLOCKED
```

## Problem closed by this implementation

TikTok Organic already uses the protected Lark Native connector. The missing production-like layer was
not another Source connector; it was deterministic post-Lark admission, a D1 historical Report reader
and a parity-controlled Report cutover.

The pre-implementation blockers were:

- Primary Cron could emit a TikTok Business sync every five minutes without proving that the protected
  Lark Native RAW source had completed a new generation;
- the active TikTok Report reader used `MKT_Content` and `MKT_Content_Daily` directly and capped Content
  at 800 identities;
- D1 Report flags existed but were not connected to the active handler;
- scheduled TikTok Snapshot date used the current local day while Daily Report used the previous
  completed day;
- Report generation could be time-driven independently from the corresponding processing Coverage.

## Implemented architecture

```text
Lark Native TikTok sync approximately 07:00
→ guarded read-only RAW probe
→ two identical bounded probes / stable source watermark
→ durable same-watermark admission
→ existing Durable source staging
→ exact staged-watermark fence
→ full-unit preflight
→ existing D1 Observation / State / Coverage hooks
→ existing Canonical Lark writer
→ completed Coverage re-read
→ idempotent report request
→ Lark-primary + D1-shadow or D1-primary Report calculation
→ bounded Lark metadata hydration for top Content only
→ existing Lark Report output writer
→ optional deterministic D1 materialization
```

No second TikTok source connector, metric engine, Queue framework, D1 writer, Lark sync engine or
Reliability stack was created.

## Date contract

The Lark Native sync at approximately 07:00 Asia/Bangkok is treated as the first trusted cumulative
snapshot after the preceding calendar day completed. Scheduled TikTok processing therefore uses:

```text
metricDate = local scheduled date - 1 day
```

Daily Report uses the same date as `periodEnd`. This prevents the new 07:00 Snapshot from being
excluded by a previous-day Report boundary.

## RAW watermark and admission

The compact watermark contains only approved non-secret identities and hashes:

```text
account key
source handle
record count
maximum source modified instant
sorted source record ID / external content ID / source hash states
```

It does not store Caption or RAW payload evidence.

Admission rules:

- source handle must match Chemistry K exactly;
- bounded pagination must complete without repeated cursors;
- duplicate source record/content identities and invalid Stable-key inputs fail closed;
- two probes must return the same watermark, count and maximum modified instant;
- Admission identity is account + source watermark + Snapshot metric date;
- same-watermark active/completed Admission is a no-op;
- Queue retry retains the original generation and Work key;
- the Durable staged source is hashed again before the first Business write;
- staged/admitted watermark mismatch is Permanent and fail-closed.

Additive Migration `0016_tiktok_post_lark_pipeline.sql` defines durable
`tiktok_source_admissions`. The migration is present in source only and has not been applied remotely.

## Read-only audit

A GET-only operator route is defined at:

```text
/operator/tiktok/post-lark-audit
```

It requires:

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=true
Bearer MKT_CONNECTION_OPERATOR_TOKEN
Integration Workspace runtime
```

The flag defaults to false, causing the route to return `404`. The route has no Queue or write
capability. It audits compact counts, Stable keys and cross-layer gaps for:

- `RAW_TikTok_Creator_Videos`;
- D1 State / Observation / Coverage / Coverage entities;
- `MKT_Content`;
- `MKT_Content_Daily`.

## D1 Report source

The D1 reader supports more than 800 Content identities and reads:

- current Content identity/metadata state;
- latest cumulative Observation at period end;
- latest Observation at comparison end;
- latest baseline before the earliest current/compare start;
- latest completed Coverage run;
- per-entity Coverage status.

It preserves missing metric `null`, observed zero, negative correction and deterministic ordering.
D1 remains the historical metric authority. Lark `MKT_Content` is used only as a bounded metadata
cache for top-ranked Caption/URL/thumbnail hydration.

## Report modes

```text
D1 flags all false            existing Lark-only behavior
shadow=true                   Lark output authoritative; D1 comparison diagnostic
read=true                     D1 metric/history primary
read=true + shadow=true       D1 cutover blocked on any parity mismatch
```

Parity covers both current and comparison windows, including identities, integer metrics, Data
status, baseline Coverage, source Snapshot count and top-content rank. Floating metrics use an
explicit bounded tolerance.

D1 primary also requires:

- Coverage status `complete`;
- zero failed rows;
- zero current Content identities missing an observed Coverage entity.

## Post-processing Report admission

When the post-process flag is enabled, a Daily Report request is created only after processing
success and a fresh durable Coverage re-read proves:

- complete status;
- expected and observed counts match;
- failed rows are zero;
- Coverage source watermark equals the admitted RAW watermark.

The Report request key includes Customer/Profile/Account/Report type/Period/Formula version/Watermark.
Processing retry and completion replay are idempotent.

The scheduler rejects simultaneous use of post-processing Report admission and the independent Daily
Report schedule, preventing duplicate Daily producers.

## Default-false controls

```text
MKT_TIKTOK_AUDIT_HTTP_ENABLED=false
MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=false
MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED=false
MKT_REPORT_D1_SHADOW_READ_ENABLED=false
MKT_REPORT_D1_READ_ENABLED=false
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED=false
MKT_SCHEDULE_TIKTOK_ENABLED=false
MKT_SCHEDULE_DAILY_REPORT_ENABLED=false
MKT_LARK_DAILY_RETENTION_ENABLED=false
```

## Repository verification

Branch Verification run `#517` passed on code head
`e3c00b93ea95b4a4e564f09cafacc40954b30593`:

```text
Locked dependency install             PASS
Syntax / architecture / hygiene       PASS
Focused staged TikTok                  4 / 4 PASS
Node Unit / Integration                868 / 868 PASS
Workers runtime                        9 / 9 PASS
Report reliability                     91 / 91 PASS
Dependency audit                       0 vulnerabilities
Wrangler dry-run                       PASS / no deployment
```

During review, stale scheduler fixtures were corrected to assert the new watermark-probe producer and
the previous-completed-day metric contract instead of the removed blind scheduled Sync behavior.

## Safety result

This branch performs Repository implementation only. It does not authorize or perform:

- Remote Migration or D1 backup;
- Worker deployment;
- Queue send;
- DLQ redrive/delete;
- Lark mutation;
- Remote D1 Business mutation;
- Schedule enablement;
- Recovery;
- Retention/delete;
- LIVE UAT;
- Production change.

A separately approved rollout must begin with the guarded read-only audit, then a bounded Manual
watermark admission, D1/Canonical/Coverage reconciliation, Shadow parity and exact same-watermark
rerun before any schedule proposal.
