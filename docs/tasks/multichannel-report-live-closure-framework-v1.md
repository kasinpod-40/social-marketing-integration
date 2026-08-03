# Multichannel Report Live Closure Framework v1

## Status

```text
FRAMEWORK_STATUS=READY
FIRST_ADOPTER=youtube
CHANNEL_DESCRIPTORS=ALL_SUPPORTED
YOUTUBE_STATUS=READY_FOR_LIVE_AUDIT
REMOTE_WRITE_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```

The repository framework and reviewed plan-only Terminal are implemented. `READY_FOR_LIVE_AUDIT` is intentionally narrower than `READY_FOR_LIVE`: the authorized read-only YouTube assessment has not been executed in this workstream, Meta PR #421 still owns the Remote lock, and the existing shared Report closeout operator has not yet been reviewed for YouTube Organic Live execution.

## Ownership and overlap gate

The branch starts from and remains aligned with:

```text
main = fac11f0f95b56ab0944da02dcb0360d2f5c43710
behind_by = 0
```

PR #421 changed-file inventory was inspected before implementation and rechecked after the reviewed corrections. This workstream changes only new framework, binding, Terminal, test and task-document paths. It does not modify:

- PR #421 files;
- Meta connectors, use cases, operators or tests;
- Lark Native AI implementation;
- `docs/current-task.md`;
- retained Meta evidence;
- README, CHANGELOG or PROJECT_BRAIN;
- numbered migrations.

No migration is added. Existing D1 readers, `report_materializations`, Report finalizer, output-row builders, Lark writer, Coverage, Reliability/Lock/Queue/DLQ and Stable-key authorities remain authoritative.

## Shared pipeline

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

Source-channel descriptors are derived from the merged shared Report platform registry:

- `tiktok / organic`
- `youtube / organic`
- `instagram / organic`
- `facebook / organic`
- `meta_ads / paid_ads`
- `google_ads / paid_ads`
- `tiktok_ads / paid_ads`
- `woocommerce / commerce`
- `chatwoot / customer_service`

Operations and Executive aggregation are explicit derived descriptors and do not create channel-specific Report tables.

Every descriptor validates:

- registry platform/capability/dataset/formula identity;
- exact supported windows `1/3/7/30`;
- existing generic output builders;
- existing generic Lark outputs only;
- nonempty reviewed runtime flags;
- AI and schedule flags that must remain false.

Allowed existing Lark outputs are:

- `mktReportSnapshots`
- `mktReportMetricValues`
- `mktReportTopContent`
- `mktReportTopAds`

## Existing identity and Stable-key authority

The framework does not create a second Report identity system.

Report candidates come from the existing `buildReportRuntimeCloseoutCandidates`, which delegates to the existing Dashboard preset, Report period and Report ID authorities. The closure validator accepts only four exact candidates:

```text
integration_workspace:<platform>:rolling:1d
integration_workspace:<platform>:rolling:3d
integration_workspace:<platform>:rolling:7d
integration_workspace:<platform>:rolling:30d
```

Each candidate must retain:

- `period_kind=rolling_days`
- exact `window_days`
- the existing deterministic `report_id`
- the existing closeout job contract.

Stable output keys remain owned by the existing output builders:

- Metric: `<report_id>::<stable_metric_key>::<dimension_type>::<dimension_value>`
- Top Content: `<report_id>::rank:<rank>`
- Top Ad: `<report_id>::rank:<rank>`

Dimension fields remain `dimension_type`, `dimension_value` and `rank`.

## Window and missing-value contract

Shared Report presets may continue to include other windows for other workflows. This closure framework filters to and validates exactly:

```text
1, 3, 7, 30
```

The current Lark Metric closure path rejects `9`, `15` and `90` without changing the shared preset seed.

Missing-value semantics remain:

- unavailable/missing → `null` + `N/A`
- incomplete → `null` + partial metadata
- covered empty → `no_data_confirmed`
- observed zero → `0`

The framework maps these states through the existing Dashboard availability contract instead of treating `null` as zero.

## Reviewed adapter contract

A bare function returning `{ ok: true }` cannot satisfy a stage. Each adapter must declare its exact reviewed authority and return stage-specific evidence.

Plan-only bindings reuse:

- reviewed repository evidence;
- Report all-false runtime evidence;
- shared Report platform registry;
- `data_coverage_runs` status;
- `buildReportRuntimeCloseoutCandidates`;
- existing materialization actions.

Active execution additionally requires reviewed bindings for:

- existing D1 materialization persistence;
- existing `writeDashboardMaterializationToLark` writer;
- D1/Lark parity;
- same-input replay;
- zero-drift verification;
- verified all-false Safe restore;
- sanitized evidence persistence.

## YouTube first adopter

The public Terminal has two safe modes.

### Default plan

The default command performs no Remote read and emits only the next reviewed commands and safety state:

```bash
node scripts/multichannel-report-live-closure-terminal.mjs
```

### Separately authorized read-only assessment

The existing reviewed YouTube collector remains the only Remote readiness authority:

```bash
CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=RUN_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR \
MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> \
node scripts/youtube-report-remote-readiness-reviewed-terminal.mjs --execute
```

This workstream did not execute that command because no explicit read-only authorization was supplied after implementation.

### Future retained-handoff command

A caller-controlled Boolean such as `MKT_META_REMOTE_LOCK_RELEASED=true` is not accepted. Future execution requires a retained sanitized handoff that proves:

- exact clean reviewed `main` Head;
- Audit-confirmed Meta Remote lock release;
- successful reviewed YouTube readiness evidence;
- exact four-window assessment;
- exact YouTube account identity;
- reviewed shared closeout authority.

```bash
MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json> \
CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE \
node scripts/multichannel-report-live-closure-terminal.mjs \
  --platform=youtube \
  --capability=organic \
  --execute
```

Even with a valid retained handoff, the current Terminal stops with:

```text
REPORT_LIVE_CLOSURE_SHARED_OPERATOR_YOUTUBE_NOT_REVIEWED
```

This prevents a new unreviewed Live path. Audit/Integration must first review the existing shared `scripts/report-runtime-closeout-operator.mjs` for YouTube Organic rather than creating a YouTube-only execution engine.

## Sanitized evidence

The evidence sanitizer recursively traverses nested objects and arrays and removes credential or infrastructure-identity shaped fields, including authorization, token, secret, cookie, password, database/table/queue/version identifiers and raw payload fields.

Retained handoff loading rejects the whole handoff when recursive sanitization would change it.

## Reviewed corrections

The `CHANGES_REQUIRED` review was addressed by:

1. removing the new identity and Stable-key construction;
2. deriving source descriptors from the shared registry;
3. limiting outputs to existing generic Report tables/builders;
4. enforcing typed reviewed adapter authorities and stage evidence;
5. moving Safe restore and evidence into the active-operation `finally` path;
6. preserving primary plus restore error codes;
7. removing the caller-controlled Meta lock-release Boolean;
8. requiring retained sanitized exact-head handoff evidence;
9. keeping direct Live blocked until the existing shared operator is reviewed for YouTube;
10. adding recursive sanitizer and stage-failure regression coverage.

## Verification

Reviewed code Head before this documentation evidence commit:

```text
7a5b6532c36d8b9d38ea6a47edd71e2e76e6f2ee
```

Branch Verification:

```text
workflow       Branch Verification
run number     1834
run ID         30785897526
conclusion     success
```

Successful steps:

- locked dependency installation;
- syntax, architecture and repository hygiene;
- focused Meta history finalizer regression;
- focused Woo completed-state race recovery regression;
- focused Chatwoot final UAT regression;
- focused staged TikTok regression;
- Unit and Workers runtime tests;
- Report reliability regression;
- dependency audit;
- Wrangler dry run;
- verification diagnostics upload.

Focused framework coverage includes:

- all supported descriptors;
- existing candidate/Report ID/Stable-key authorities;
- exact 1/3/7/30 and rejection of 9/15/90;
- null/partial/no-data/zero semantics;
- Organic, Paid Ads, Commerce and Chatwoot plan bindings;
- no-op adapter rejection;
- D1/Lark parity, same-input replay and zero drift;
- failure at every active stage followed by Safe restore and sanitized evidence;
- combined primary/restore failure preservation;
- recursive nested sanitizer;
- retained handoff validation and direct-Live blocking.

Required command contract:

```bash
npm ci
npm run check
node --test tests/application/report-live-closure-framework.test.js
node --test tests/scripts/multichannel-report-live-closure-terminal.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository and CI execution preserved zero Provider, Remote readiness, Queue, Remote D1, Remote Lark, Worker upload/deployment, Schedule and Production actions.
