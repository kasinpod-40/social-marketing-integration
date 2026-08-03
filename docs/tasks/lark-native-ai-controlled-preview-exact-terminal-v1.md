# Lark Native AI Controlled Preview Exact Terminal v1

## Objective

Provide one reviewed Terminal entrypoint that automatically reads the existing validated TikTok Organic Report outputs for `1D / 3D / 7D / 30D`, builds the all-channel Controlled Preview authority, applies at most 40 Preview Records to `🧠 MKT_AI_Report_Runs`, and performs a separate same-input replay that must converge to `40 no_op / 0 writes`.

The user does not prepare JSON, enter a SHA, construct approval evidence, locate retained files, switch Branch manually or paste a heredoc.

## Exact user command

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration && git fetch --quiet origin main && git switch main && git pull --ff-only origin main && CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL=RUN_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL node scripts/lark-native-ai-controlled-preview-exact-terminal.mjs --execute
```

The command contains no placeholder. It switches to `main`, updates by fast-forward only, then runs the installed exact operator from the user's locked repository path. Dirty work, a diverged local `main` or a non-fast-forward condition stops before any Lark request.

## Visible Lark result

```text
TikTok Organic Golden Dataset × 1D/3D/7D/30D = 4 rows
Other eight business channels × 1D/3D/7D/30D = 32 truthful status rows
Executive                     × 1D/3D/7D/30D = 4 rows
Total                                                  40 rows
```

Only TikTok Report values already validated in `MKT_Report_Snapshots` and `MKT_Report_Metric_Values` are admitted in this first proof. Other channels remain `source_pending` or `unavailable`; the operator does not infer values, reuse an unaligned period or convert missing data to zero.

## Local preflight before any Remote read

The command and operator jointly ensure:

- repository path is exact;
- `git fetch origin main` succeeds;
- local Branch switches to `main`;
- local `main` updates by fast-forward only;
- Node.js 22 or newer;
- clean working tree;
- local Head exactly equals a freshly fetched `origin/main`;
- `wrangler.sync.jsonc` loads and targets `social-mkt-sync-worker`;
- `workers_dev=false`;
- `MKT_ENV=development`;
- `MKT_CUSTOMER_PROFILE=integration_workspace`;
- every `MKT_*_ENABLED` flag is false;
- Lark App ID, App Secret and Base token exist;
- Report Snapshot and Metric table mappings exist;
- `.dev.vars`, when present, is a regular non-symlink file.

A regular `.dev.vars` with overly broad permissions is automatically tightened to `0600` before reading. A missing `.dev.vars` is allowed when the complete credentials are already present in process Environment. A symlink or non-file remains blocked.

## Exact execution sequence

```text
fast-forward local main
→ explicit sequential Terminal confirmation
→ Node and exact-main preflight
→ local config/credential/mapping preflight
→ harden .dev.vars to 0600 when needed
→ acquire private exclusive local lock
→ create a new immutable attempt directory
→ read one cached Lark Table inventory
→ read AI fields and six Views through a read-only allowlist
→ require AI schema zero drift and exact View filters 6/6
→ read TikTok Report Snapshots for exact setting keys 1D/3D/7D/30D
→ select one unique latest snapshot per window, no older than seven days
→ read Metric rows for those four exact report_id values
→ reject missing/duplicate/conflicting Report evidence
→ preserve Shared Report scope as source_metric_scope
→ map summary-dimension Report metrics to AI metric_scope=summary
→ reject stale values that contradict availability
→ build and checksum the retained real-data source package automatically
→ build four exact Head-bound readiness plans
→ run bounded first-pass create/update
→ require fresh zero-drift read-back
→ run a separate same-input replay
→ require 40 no-op / 0 writes
→ write private summary
→ release the local lock
```

## Report-to-AI taxonomy adapter

Shared Report and Lark Native AI use `metric_scope` for different questions:

```text
Shared Report: period_delta / current_total / data_quality
Lark Native AI: summary versus dimensioned evidence
```

The adapter never changes numeric values. It retains the original Report scope in `source_metric_scope`, maps only `dimension_type=summary` rows to AI `metric_scope=summary`, and recomputes the package checksum afterward.

Availability is mapped fail-closed:

```text
available            → available
baseline_incomplete  → baseline_incomplete
coverage_incomplete  → coverage_incomplete
source_unavailable   → not_available
not_observed         → not_available
```

An `available` row without a current value and a non-available row with a stale current value are both rejected before Lark write.

## Source read-only allowlist

Before any AI-table write, the parent operator permits only:

- tenant token;
- one cached List Tables inventory;
- List Fields for the AI table;
- List/Get the six AI Views;
- Search Report Snapshots by four exact `report_setting_key` values;
- Search Report Metric rows by four exact `report_id` values.

No Record create/update/delete is reachable from the source collector. Any other path or method is blocked before fetch.

## Write boundary

The existing merged Live Pilot remains the sole writer. Its child Environment is fixed regardless of local overrides:

```text
LARK_MAX_ATTEMPTS=1
LARK_MAX_PAGES=1
LARK_MAX_FILTER_CONDITIONS=50
LARK_REQUEST_TIMEOUT_MS=30000
LARK_MIN_REQUEST_INTERVAL_MS=150
```

The first pass permits only stable-key reads and at most 40 create/update writes to `🧠 MKT_AI_Report_Runs`. Delete, Schema, View, AI, Automation, notification, D1, Queue, Worker, Provider, Schedule and Production actions remain forbidden.

A failed or ambiguous write is never retried automatically. A new explicit run starts by searching the Stable keys again.

## Sequential Terminal authority

PR closure is not used as the runtime mutex. The user explicitly runs this command only after the preceding Meta/Chatwoot Terminal command has ended and does not run both commands simultaneously.

This exact operator additionally requires:

- one exclusive local exact-terminal lock;
- all local Integration Workspace execution flags false;
- an isolated mutation surface limited to records in `🧠 MKT_AI_Report_Runs`;
- no Worker, D1, Queue, Provider, Schedule or Production action.

The retained source package records this as `explicit_sequential_lark_only_handoff`; it does not claim that the source collector observed or changed a Worker deployment.

## Attempt evidence

Every execution creates a new private `0700` directory under:

```text
outputs/lark-native-ai-controlled-preview/exact-terminal/
```

Files use mode `0600` and are never overwritten:

```text
00-retained-real-report-source.json
live-pilot-input.json
01-first-pass.json
02-same-input-replay.json
summary.json
```

A stopped run writes `failure-summary.json` after the attempt directory exists.

The exclusive lock is:

```text
outputs/lark-native-ai-controlled-preview/exact-terminal/.exact-terminal.lock
```

A pre-existing lock is not silently deleted because an earlier process may still be active or may have an ambiguous write outcome. The operator stops so the prior process/evidence can be inspected before an explicit new run.

## Expected success

First pass:

```text
mode     applied_and_verified with 1..40 writes
or       already_zero_drift   with 0 writes
readback zero_drift
```

Independent replay:

```text
mode                 already_zero_drift
verification.status  zero_drift
verification.counts  write=0 / noOp=40 / delete=0
writes.total          0
```

## Important failure codes

```text
..._LOCAL_PREFLIGHT_BLOCKED                all local blockers are returned together
..._MAIN_NOT_CURRENT                       local main differs from fetched origin/main
..._LOCK_EXISTS                            a prior exact-terminal process/lock remains
..._SOURCE_READ_REQUEST_BLOCKED            collector attempted a non-read path
..._SOURCE_READ_LIMIT_EXCEEDED             read footprint exceeded the reviewed bound
..._SOURCE_SCHEMA_NOT_ZERO_DRIFT           AI table fields/options/views are not ready
..._SOURCE_VIEW_FILTER_DRIFT               six required Views are not exact
..._SOURCE_TABLE_MAPPING_INVALID           configured Report Table ID is not in the Base
..._SOURCE_TIKTOK_REPORT_MISSING           an exact 1D/3D/7D/30D Report is missing
..._SOURCE_TIKTOK_REPORT_AMBIGUOUS         latest identity is duplicated
..._SOURCE_TIKTOK_REPORT_STALE             selected Report is older than seven days
..._SOURCE_METRICS_MISSING                 a selected Report has no Metric rows
..._SOURCE_METRIC_DUPLICATE                report_metric_key is duplicated
..._SOURCE_METRIC_AVAILABILITY_UNSUPPORTED Report availability cannot map to AI
..._SOURCE_METRIC_VALUE_MISSING            available metric has no current value
..._SOURCE_METRIC_STALE_VALUE              unavailable metric retains a stale value
..._READINESS_NOT_READY                    one generated readiness plan failed closed
..._CHILD_FAILED                           Live Pilot stopped; no automatic retry occurred
..._FIRST_PASS_INVALID                     first pass exceeded/misreported its boundary
..._REPLAY_INVALID                         replay was not 40 no-op / zero writes
```

## Recurring failure classes explicitly prevented

- no heredoc, shell quoting or pasted JSON;
- no caller-entered SHA or approval timestamp;
- no guessed retained-evidence path;
- no hidden prerequisite source file;
- no manual Branch switching or pull step;
- no stale local main;
- no failure solely because regular `.dev.vars` started with broad permissions;
- no missing Table mapping discovered after write starts;
- no Report/AI metric-scope mismatch;
- no stale numeric value accepted under unavailable status;
- no hidden Lark retry/page/filter override;
- no overwrite of prior attempt evidence;
- no automatic retry after partial/unknown write;
- no declared success without an independent same-input replay;
- no Fixture, dummy, placeholder or sample data written for demonstration.

## Current implementation status

Repository implementation and CI perform zero Remote request. Live Lark reads/writes occur only when the user runs the exact command after merge.
