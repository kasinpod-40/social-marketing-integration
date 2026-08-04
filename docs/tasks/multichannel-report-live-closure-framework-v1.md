# Multichannel Report Live Closure Framework v1

## Status

```text
FRAMEWORK_STATUS=READY_FOR_CI
READY_CHANNELS=facebook,instagram,youtube,woocommerce,chatwoot
WINDOWS=1,3,7,30
REMOTE_READ_EXECUTED=0
REMOTE_WRITE_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```

This workstream closes the Repository gap between existing normalized/Daily facts and the existing Central Report runtime. It does not create a second Report engine.

Ready-channel scope:

- Facebook Organic
- Instagram Organic
- YouTube Organic
- WooCommerce Commerce
- Chatwoot Customer Service

TikTok Organic already has the canonical Report closeout route. Paid Ads remain outside this Live execution set until their own exact readiness evidence is retained.

## Existing shared authorities

The Worker already registers D1 Report adapters for all five channels and executes them through:

```text
buildDashboardPresetJob
→ generateDashboardReportMaterialization
→ report_materializations
→ writeDashboardMaterializationToLark
```

The framework reuses:

- `D1OrganicReportSource` for Facebook, Instagram and YouTube;
- `D1WooCommerceReportSource` and the existing Commerce generator;
- `D1ChatwootReportSource` and the existing Customer Service generator;
- existing Report settings, periods, deterministic `report_id` and output Stable keys;
- existing Queue, lock, DLQ, sync log, D1 persistence and Lark writer;
- existing all-false Worker restoration.

No channel-specific Report database, Dashboard engine, D1 writer, Lark sync engine, Reliability engine or Queue framework is introduced.

## Shared closure pipeline

```text
Repository/finalizer gate
→ Remote Worker all-false read-only gate
→ Source/Coverage readiness
→ D1/Lark 1D/3D/7D/30D prestate
→ exact action per window
→ one report-only Worker window
→ D1 materialization
→ Lark write
→ D1/Lark metric parity
→ same-input replay
→ zero-drift verification
→ all-false restore from finally
→ sanitized retained evidence
```

Allowed actions per window:

- no D1 and no Lark rows → `create_materialization`;
- one D1 row with complete exact Lark parity → `reuse_or_idempotent_verify`;
- one D1 row with repairable missing/stale Lark state → `refresh_or_repair_materialization`;
- duplicate D1 identity, duplicate Snapshot, duplicate metric key or orphan Lark rows → blocked.

Repair preserves one Stable D1 materialization identity. The payload checksum may remain unchanged when only Lark rows require repair. The following same-input replay must preserve the final D1 checksum and Lark state exactly.

## Identity and windows

Only the existing candidate authority is used:

```text
buildReportRuntimeCloseoutCandidates
```

Allowed setting identities are:

```text
integration_workspace:<platform>:rolling:1d
integration_workspace:<platform>:rolling:3d
integration_workspace:<platform>:rolling:7d
integration_workspace:<platform>:rolling:30d
```

The execution path filters out `9`, `15` and `90` without changing the shared preset seed.

The existing account identity for these Report sources is `account_key=chemistry_k`; the shared D1 Report readers project this same value as Report `accountId`. No provider identity is invented or substituted.

## Missing-value contract

- unavailable or missing → `null` + `N/A`;
- incomplete → `null` + partial metadata;
- covered empty → `no_data_confirmed`;
- observed zero → `0`.

`sourceWatermark` remains the exact Coverage lineage. `watermarkDate` is only the latest business date and may not replace `sourceWatermark`.

## Generic read-only readiness

The same SELECT-only readiness terminal is used for every ready channel:

```bash
MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=<facebook|instagram|youtube|woocommerce|chatwoot> \
CONFIRM_REPORT_CHANNEL_REMOTE_READINESS=RUN_REPORT_CHANNEL_REMOTE_READINESS \
node scripts/report-channel-remote-readiness-reviewed-terminal.mjs \
  --platform=<platform> \
  --execute
```

It performs no Provider call, Queue send, D1/Lark mutation, Worker upload/deployment, Schedule or Production action. It retains:

- exact clean current `main` and finalizer Head;
- current all-false Worker bindings;
- pending migrations, active Report work, locks, DLQ and critical alerts;
- channel-specific Source/Coverage counts and exact source watermark;
- existing D1/Lark state for 1D/3D/7D/30D;
- exact action for every window.

## Retained handoff and execution

Live execution requires a recursively sanitized retained handoff that proves:

- Meta Remote lock released by an exact Audit Head;
- current clean `main` equals the reviewed Head;
- selected-channel readiness is `readyForLive=true`;
- exact source watermark and 1/3/7/30 actions;
- the selected platform/capability matches the shared closeout authority;
- explicit Live materialization authorization.

Example execution:

```bash
MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=facebook \
MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json> \
CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE=RUN_MULTICHANNEL_REPORT_LIVE_CLOSURE \
node scripts/multichannel-report-live-closure-terminal.mjs \
  --platform=facebook \
  --capability=organic \
  --execute
```

The same command shape applies to Instagram, YouTube, WooCommerce and Chatwoot by changing only platform and capability.

## Ownership and safety

This workstream does not modify:

- Meta connector/use-case/operator/test paths owned by PR #421;
- `package.json` or `package-lock.json`;
- numbered migrations;
- Lark Native AI implementation;
- `docs/current-task.md`;
- retained Meta evidence.

`.dev.vars` is optional. When absent, process environment values remain authoritative; every non-ENOENT file error still fails closed.

Repository/CI execution performs zero Remote mutation. Live execution remains blocked until exact readiness and Meta lock-release evidence are assembled after merge.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/report-live-closure-framework.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-binding.test.js
node --test tests/scripts/report-runtime-closeout-reviewed-multiwindow-wiring.test.js
node --test tests/scripts/multichannel-report-live-closure-terminal.test.js
node --test tests/scripts/report-channel-remote-readiness.test.js
node --test tests/scripts/dev-vars.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Expected Repository result:

```text
FRAMEWORK_STATUS=READY
CHANNELS=facebook,instagram,youtube,woocommerce,chatwoot
WINDOWS=1,3,7,30
REMOTE_WRITE_COUNT=0
QUEUE_ACTION_COUNT=0
WORKER_DEPLOYMENT_COUNT=0
SCHEDULE_ENABLED=false
PRODUCTION=BLOCKED
```
