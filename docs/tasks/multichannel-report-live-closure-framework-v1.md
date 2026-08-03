# Multichannel Report Live Closure Framework v1

## Status

```text
FRAMEWORK_STATUS=READY
FIRST_ADOPTER=youtube
CHANNEL_DESCRIPTORS=ALL_SUPPORTED
YOUTUBE_STATUS=READY_FOR_LIVE_AUDIT
SHARED_OPERATOR_REVIEW=REVIEWED_EXTENSION_BOUND
EXACT_SOURCE_WATERMARK=BOUND_AND_REQUIRED
META_REMOTE_LOCK_GATE=RETAINED_EVIDENCE_REQUIRED
REMOTE_READ_EXECUTED=0
REMOTE_WRITE_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```

The repository framework, plan-only Terminal, exact-source-watermark collector binding, retained exact-head handoff contract and reviewed exact `1/3/7/30` execution extension are implemented.

`READY_FOR_LIVE_AUDIT` is intentionally narrower than `READY_FOR_LIVE`:

- the reviewed YouTube Remote readiness assessment has not run;
- PR #421 still owns Meta Live/Remote mutation;
- no retained Meta lock-release evidence exists yet;
- no retained Audit handoff exists for the current exact reviewed `main` Head;
- no Live execution authorization has been supplied;
- no Provider, Queue, Remote D1, Remote Lark, Worker deployment, Schedule or Production action has occurred.

## Ownership and overlap gate

```text
main       48cb63c70b95f306a5a101a68a4706d010762e68
behind_by  0
```

Latest `main` includes the all-channel Lark Native AI controlled-preview executor from PR #449. Its seven files have zero path overlap with this workstream and are preserved in the combined tree.

PR #421 changed-file inventory was inspected before implementation and rechecked during the operator and lock-gate work. This workstream does not modify:

- PR #421 files;
- Meta connectors, use cases, operators or retained evidence;
- Lark Native AI implementation files;
- `docs/current-task.md`;
- README, CHANGELOG or PROJECT_BRAIN;
- numbered migrations.

No migration is added. Existing Report registry, candidate builder, deterministic Report IDs, output-row builders, D1 readers, `report_materializations`, Report finalizer, Lark writer, Coverage, Reliability/Lock/Queue/DLQ and Safe restore authorities remain authoritative.

## Shared closure pipeline

```text
Repository gate
→ Runtime/Safe-state gate
→ Source readiness
→ Coverage validation
→ Report identity planning
→ Exact 1/3/7/30 materialization plan
→ D1 persistence
→ Lark write
→ D1/Lark parity
→ Same-input replay
→ Zero-drift verification
→ Safe restore from finally
→ Sanitized evidence
```

The closure runner is channel-neutral. Channel differences come from descriptors and reviewed adapters, not duplicated Report engines.

After any active D1/Lark/parity/replay/zero-drift attempt, Safe restore runs from `finally`. Primary and restore failures are both retained as bounded sanitized codes.

## Descriptor authority

Source descriptors are derived from the merged shared Report platform registry:

- `tiktok / organic`
- `youtube / organic`
- `instagram / organic`
- `facebook / organic`
- `meta_ads / paid_ads`
- `google_ads / paid_ads`
- `tiktok_ads / paid_ads`
- `woocommerce / commerce`
- `chatwoot / customer_service`

Operations and Executive aggregation remain explicit derived descriptors and do not create channel-specific Report tables.

Allowed existing Lark outputs remain limited to:

- `mktReportSnapshots`
- `mktReportMetricValues`
- `mktReportTopContent`
- `mktReportTopAds`

## Existing identity and Stable-key authority

The framework does not create a second Report identity system.

Report candidates come from `buildReportRuntimeCloseoutCandidates`, which delegates to the existing Dashboard preset, Report period and Report ID authorities. The closure validator accepts only:

```text
integration_workspace:<platform>:rolling:1d
integration_workspace:<platform>:rolling:3d
integration_workspace:<platform>:rolling:7d
integration_workspace:<platform>:rolling:30d
```

Each candidate retains the existing deterministic `report_id`, exact `window_days`, `period_kind=rolling_days` and existing closeout job contract.

Stable output keys remain owned by the existing output builders.

## Window and missing-value contract

This closure path validates exactly:

```text
1, 3, 7, 30
```

It rejects `9`, `15` and `90` without changing the shared preset seed.

Missing-value semantics remain:

- unavailable or missing → `null` + `N/A`;
- incomplete → `null` + partial metadata;
- covered empty → `no_data_confirmed`;
- observed zero → `0`.

## Exact source-watermark contract

`watermarkDate` and `sourceWatermark` are separate authorities:

- `watermarkDate` is the maximum observed business date;
- `sourceWatermark` is the exact Coverage lineage used by deterministic candidate, job and replay authority.

The Terminal and shared-operator review reject readiness evidence without exact `sourceWatermark`. They never substitute `watermarkDate`.

The reviewed collector reads `source_watermark` from the exact latest completed YouTube content Coverage row, projects it into reviewed readiness evidence and retains it separately from `watermarkDate`.

## Reviewed shared-operator bindings

The four bounded blockers identified by the zero-Remote compatibility review are implemented repository-side:

1. **YouTube target selector**
   - resolves the exact reviewed Chemistry K YouTube identity;
   - rejects caller-controlled fallback identities.
2. **YouTube Organic D1 preflight**
   - reads the existing YouTube normalized, daily and Coverage authorities;
   - preserves missing, partial, covered-empty and observed-zero semantics.
3. **Retained exact-head handoff**
   - requires recursively sanitized retained evidence;
   - binds repository Head, reviewed readiness, identity and exact source watermark.
4. **Exact reviewed multiwindow execution**
   - executes only the bounded `1/3/7/30` plan;
   - performs per-window D1/Lark parity and same-input replay checks;
   - performs one unconditional all-false restore from `finally` after the bounded sequence.

The canonical legacy operator remains the original shared TikTok/WooCommerce implementation at:

```text
scripts/report-runtime-closeout-operator.mjs
```

Its original blob and source contracts are preserved. The temporary duplicate legacy file was removed.

YouTube execution is isolated behind the reviewed extension:

```text
scripts/report-runtime-closeout-reviewed-multiwindow.mjs
```

The Multichannel Terminal delegates YouTube only to that reviewed entrypoint. It does not route YouTube through or alter the canonical TikTok/WooCommerce operator.

## Retained Meta Remote lock-release gate

The public YouTube readiness terminal now requires a private retained file through:

```text
MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE
```

The exact execution order is:

```text
explicit confirmation
→ clean exact-main repository preflight
→ retained Meta lock-release evidence preflight
→ internal SELECT-only YouTube collector
→ reviewed readiness assessment
→ private mode-0600 readiness evidence
```

The retained file must prove contract `meta_remote_lock_release_audit_v1`, exact audited Head, sanitized evidence, all execution flags false, Preview URLs disabled, Schedule disabled, Production blocked and zero active Work/Lock/uncertain Queue state.

A caller-controlled Boolean such as `MKT_META_REMOTE_LOCK_RELEASED=true` is ignored and cannot authorize Remote read. Missing or invalid retained evidence stops before the internal collector process is spawned.

## YouTube first adopter commands

### Default zero-Remote plan

```bash
node scripts/multichannel-report-live-closure-terminal.mjs
```

### Future separately authorized read-only assessment

```bash
CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=RUN_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR \
MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE=<retained-lock-release-evidence.json> \
node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs --execute
```

This command has not been executed in this workstream.

### Future retained-handoff execution

```bash
MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json> \
CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE \
node scripts/multichannel-report-live-closure-terminal.mjs \
  --platform=youtube \
  --capability=organic \
  --execute
```

The Terminal remains fail-closed without an exact reviewed retained handoff and explicit execution confirmation. Repository readiness does not authorize Live execution.

## Sanitized evidence

The evidence sanitizer recursively traverses nested objects and arrays and removes credential or infrastructure-identity shaped fields, including authorization, token, secret, cookie, password, database/table/queue/version identifiers and raw payload fields.

Retained handoff and lock-release loading reject the whole evidence object when recursive sanitization would change it.

## Verification

Exact repository Head:

```text
eed6bef4dd32aa8838de324cc9b0022b96b18c6d
```

Branch Verification:

```text
workflow       Branch Verification
run number     1905
run ID         30795487643
conclusion     success
```

Successful steps:

- locked dependency installation;
- syntax, architecture and repository hygiene;
- focused Meta history finalizer regression;
- focused Woo completed-state race recovery regression;
- focused Chatwoot final UAT regression;
- focused staged TikTok regression;
- full Unit and Workers runtime tests;
- Report reliability regression;
- dependency audit;
- Wrangler dry run;
- verification diagnostics upload.

Focused framework coverage includes:

- all supported descriptors;
- exact `1/3/7/30` and rejection of `9/15/90`;
- null, partial, covered-empty and observed-zero semantics;
- exact source-watermark retention;
- YouTube target and D1 preflight bindings;
- retained exact-head handoff validation;
- exact multiwindow planning and execution wiring;
- per-window parity and same-input replay;
- unconditional Safe restore from `finally`;
- recursive nested sanitizer;
- canonical TikTok/WooCommerce source-contract preservation;
- separate YouTube reviewed-entrypoint delegation;
- retained Meta lock-release evidence admission;
- caller Boolean bypass rejection;
- pre-spawn lock-gate ordering;
- merged latest-main Lark Native AI controlled-preview executor regressions.

Repository and CI execution preserved zero Provider, Remote readiness, Queue, Remote D1, Remote Lark, Worker upload/deployment, Schedule and Production actions.
