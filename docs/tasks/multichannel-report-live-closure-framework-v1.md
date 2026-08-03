# Multichannel Report Live Closure Framework v1

## Status

```text
FRAMEWORK_STATUS=READY
FIRST_ADOPTER=youtube
CHANNEL_DESCRIPTORS=ALL_SUPPORTED
YOUTUBE_STATUS=READY_FOR_LIVE_AUDIT
SHARED_OPERATOR_REVIEW=OPERATOR_EXTENSION_REQUIRED
EXACT_SOURCE_WATERMARK=BOUND_AND_REQUIRED
REMOTE_READ_EXECUTED=0
REMOTE_WRITE_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```

The repository framework, plan-only Terminal, exact-source-watermark collector binding and zero-Remote shared-operator compatibility review are implemented.

`READY_FOR_LIVE_AUDIT` is intentionally narrower than `READY_FOR_LIVE`:

- Meta PR #421 still owns the Remote lock;
- the authorized read-only YouTube assessment has not been executed in this workstream;
- the existing executable shared Report closeout operator still requires four bounded YouTube extensions;
- no retained Audit handoff exists yet for the current exact reviewed `main` Head.

## Ownership and overlap gate

```text
main       db7a09e6d5b2a78f4e7e25bd0a7822cbef85bdeb
behind_by  0
```

Latest `main` includes the all-channel Lark Native AI offline preview from PR #446. Its eleven added files have zero path overlap with this workstream. A two-parent combined-tree merge preserved both workstreams, and the PR diff remains limited to the Report closure files below.

PR #421 changed-file inventory was inspected before implementation and rechecked after the operator review. This workstream does not modify:

- PR #421 files;
- Meta connectors, use cases, operators or tests;
- Lark Native AI offline preview files;
- `docs/current-task.md`;
- retained Meta evidence;
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
→ 1/3/7/30 materialization plan
→ D1 persistence
→ Lark write
→ D1/Lark parity
→ Same-input replay
→ Zero-drift verification
→ Safe restore
→ Sanitized evidence
```

The closure runner is channel-neutral. Channel differences come from descriptors and reviewed adapters, not scattered channel `if/else` branches.

After any active D1/Lark/parity/replay/zero-drift attempt, Safe restore runs from `finally`. Primary and restore failures are both retained as bounded sanitized codes. Sanitized evidence is attempted after restore whether the primary operation passed or failed.

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

Allowed existing Lark outputs are limited to:

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

Each candidate retains:

- `period_kind=rolling_days`;
- exact `window_days`;
- the existing deterministic `report_id`;
- the existing closeout job contract.

Stable output keys remain owned by the existing output builders:

- Metric: `<report_id>::<stable_metric_key>::<dimension_type>::<dimension_value>`
- Top Content: `<report_id>::rank:<rank>`
- Top Ad: `<report_id>::rank:<rank>`

## Window and missing-value contract

This closure path validates exactly:

```text
1, 3, 7, 30
```

It rejects `9`, `15` and `90` without changing the shared preset seed.

Missing-value semantics remain:

- unavailable/missing → `null` + `N/A`;
- incomplete → `null` + partial metadata;
- covered empty → `no_data_confirmed`;
- observed zero → `0`.

## Exact source-watermark contract

`watermarkDate` and `sourceWatermark` are different authorities:

- `watermarkDate` is the maximum observed business date;
- `sourceWatermark` is the exact Coverage lineage used by deterministic candidate/job/replay authority.

The Terminal and shared-operator review reject readiness evidence that lacks exact `sourceWatermark`. They never substitute `watermarkDate`.

The reviewed collector now:

1. reads `source_watermark` from the exact latest completed YouTube content Coverage row;
2. normalizes it once as `sourceWatermark`;
3. uses it to build deterministic existing Report candidates;
4. projects that same value into `buildYouTubeRemoteReadinessEvidence`;
5. retains it separately from `watermarkDate` in sanitized reviewed evidence.

Regression coverage checks both the evidence shape and executable collector wiring. A missing value remains explicit `null`; no caller-controlled or date-derived watermark is accepted.

## Shared operator compatibility review

The zero-Remote review command is:

```bash
node scripts/youtube-shared-report-closeout-review.mjs
```

The review reuses the retained handoff, existing candidate builder, exact four windows, Report operator contract, Organic integrity/replay authorities and Safe restore contract. It performs zero Provider, D1, Lark, Queue, Worker or Production action.

Result:

```text
CONTRACT_COMPATIBLE=true     # when retained exact sourceWatermark is present
EXECUTABLE_READY=false
REVIEW_STATUS=OPERATOR_EXTENSION_REQUIRED
```

The executable shared operator has four bounded blockers:

1. `REPORT_RUNTIME_CLOSEOUT_YOUTUBE_TARGET_SELECTOR_UNBOUND`
   - target selector currently accepts TikTok and WooCommerce only.
2. `REPORT_RUNTIME_CLOSEOUT_YOUTUBE_D1_PREFLIGHT_UNBOUND`
   - non-WooCommerce preflight currently uses TikTok source/Coverage SQL.
3. `REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_UNBOUND`
   - executable operator does not yet consume retained exact-head lock/readiness handoff.
4. `REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_EXECUTION_UNBOUND`
   - executable operator selects one window while closure requires a bounded reviewed `1/3/7/30` action plan.

These findings prove that direct execution must remain blocked. They do not justify a YouTube-only D1 writer, Lark writer, Queue framework or finalizer.

## YouTube first adopter commands

### Default zero-Remote plan

```bash
node scripts/multichannel-report-live-closure-terminal.mjs
```

### Separately authorized read-only assessment

```bash
CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=RUN_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR \
MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs --execute
```

This command was not executed in this workstream because PR #421 still owns the Remote lock and no new explicit read-only authorization was supplied.

### Future retained-handoff execution

```bash
MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json> \
CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE \
node scripts/multichannel-report-live-closure-terminal.mjs \
  --platform=youtube \
  --capability=organic \
  --execute
```

Even with a syntactically valid retained handoff, the Terminal remains blocked until all four shared-operator extensions are implemented and reviewed.

## Sanitized evidence

The evidence sanitizer recursively traverses nested objects and arrays and removes credential or infrastructure-identity shaped fields, including authorization, token, secret, cookie, password, database/table/queue/version identifiers and raw payload fields.

Retained handoff loading rejects the whole handoff when recursive sanitization would change it.

## Review corrections completed

The prior `CHANGES_REQUIRED` review was addressed by:

1. removing new identity and Stable-key construction;
2. deriving source descriptors from the shared registry;
3. limiting outputs to existing generic Report tables/builders;
4. enforcing typed reviewed adapter authorities and stage evidence;
5. moving Safe restore and evidence into the active-operation `finally` path;
6. preserving primary plus restore error codes;
7. removing the caller-controlled Meta lock-release Boolean;
8. requiring retained recursively sanitized exact-head handoff evidence;
9. keeping direct Live blocked until the shared operator is extended for YouTube;
10. adding recursive sanitizer and every-active-stage failure coverage;
11. adding zero-Remote shared-operator compatibility review;
12. separating exact source watermark from watermark date;
13. binding the executable reviewed collector to retain exact Coverage source lineage;
14. integrating latest `main` without overlap or regression.

## Verification

Reviewed combined code Head before this documentation evidence commit:

```text
95c6c63d07676b263fc838f9a2bbbf9093100842
```

Branch Verification:

```text
workflow       Branch Verification
run number     1860
run ID         30787733776
conclusion     success
```

Successful steps:

- locked dependency installation;
- syntax, architecture and repository hygiene;
- focused Meta history finalizer regression;
- focused Woo completed-state race recovery regression;
- focused Chatwoot final UAT regression;
- focused staged TikTok regression;
- Unit and Workers runtime tests, including merged Lark Native AI offline preview tests;
- Report reliability regression;
- dependency audit;
- Wrangler dry run;
- verification diagnostics upload.

Focused framework coverage includes:

- all supported descriptors;
- existing candidate/Report ID/Stable-key authorities;
- exact `1/3/7/30` and rejection of `9/15/90`;
- null/partial/no-data/zero semantics;
- Organic, Paid Ads, Commerce and Chatwoot plan bindings;
- no-op adapter rejection;
- D1/Lark parity, same-input replay and zero drift;
- failure at every active stage followed by Safe restore and sanitized evidence;
- combined primary/restore failure preservation;
- recursive nested sanitizer;
- retained handoff validation and direct-Live blocking;
- shared operator compatibility/blocker detection;
- exact source-watermark retention, executable projection and no date substitution.

Repository and CI execution preserved zero Provider, Remote readiness, Queue, Remote D1, Remote Lark, Worker upload/deployment, Schedule and Production actions.
