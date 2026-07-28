# Report Runtime Finalize Operator

Status: `identity_scope_hotfix_repository_validated`

Original branch: `codex/report-runtime-finalize-operator`

Hotfix branch: `codex/report-finalizer-identity-scope-hotfix`

Original merged PR: `#207`

Hotfix Draft PR: `#212`

## Goal

Leave the Report workstream with one guarded Terminal command on clean `main`:

```bash
CONFIRM_REPORT_RUNTIME_FINALIZE=EXECUTE_REPORT_RUNTIME_FINALIZE \
node scripts/report-runtime-finalize-operator.mjs --execute
```

The command performs repository validation, Lark Report Schema v2 preview/apply, canonical Dashboard Report Settings reconciliation, and zero-drift read-back. It writes sanitized local evidence only.

## Preconditions

- run from a clean and current `main` working tree;
- `.dev.vars` points to the Integration Workspace Lark Base;
- `MKT_ENV=development`;
- `MKT_CUSTOMER_PROFILE=integration_workspace`;
- Report D1 reads, preset materialization, AI summary, Daily schedule, and Weekly schedule remain false;
- Lark credentials and app token are available locally;
- no Production target is accepted.

## Stages

1. Verify clean `main` repository state.
2. Run `npm ci`, `npm run check`, `npm test`, Report reliability, dependency audit, and Wrangler dry-run.
3. Preview executable Report Schema v2.
4. Apply additive Report Schema v2 with the existing exact write guard.
5. Carry returned Lark Table mappings in-process without committing local config.
6. Preview canonical `integration_workspace` Report Settings reconciliation.
7. Apply canonical settings and disable exact legacy settings without deletion.
8. Re-run schema and settings previews and require zero drift.
9. Write sanitized evidence to `outputs/report-runtime-finalize/report-runtime-finalize-summary.json`.

## Live incident — identity scope

The first authorized Terminal run reached `dashboard-settings-preview` and failed closed with:

```text
MKT_RUNTIME_IDENTITY_OVERRIDE_BLOCKED
Integration Workspace TikTok identity cannot be overridden
```

Root cause:

- `reconcile-dashboard-report-settings.mjs` used the shared Local Lark runtime in full Connector scope;
- full scope evaluates every Connector feature flag and Source identity override from Shell/`.dev.vars`;
- a historical `TIKTOK_SOURCE_HANDLE` therefore reached the current Chemistry K TikTok identity guard;
- Dashboard Report Settings reconciliation does not read or run TikTok, so that Connector dependency was unrelated to the requested operation.

The failure occurred before Dashboard Settings preview/apply. The preceding Report Schema apply stage may already have completed additive actions. Schema apply and read-back are idempotent, so the approved recovery is to merge this Hotfix and rerun the same finalizer command; no manual schema rollback or record deletion is required.

## Repository correction

- Added an explicit `administrative` Local Lark runtime-config scope.
- Administrative scope keeps Lark credentials, table mappings, environment and customer profile validation.
- It forces every Connector feature flag false and removes Connector Source-handle overrides only from the internal runtime-config validation copy.
- The original normalized environment remains unchanged for Lark API and table configuration.
- Full runtime scope remains the default, and the TikTok Chemistry K identity guard is unchanged.
- Dashboard Report Settings reconciliation now opts into administrative scope because it performs Lark schema/settings administration only.

## Safety

The operator and Hotfix do not:

- deploy a Worker;
- mutate Remote D1;
- send Queue messages;
- enable Daily/Weekly schedules;
- enable Report D1 reads or preset materialization;
- enable AI summary;
- run a Connector or Provider request;
- delete or rewrite Business facts;
- print credentials, tokens, authorization values, or secrets.

Schema and Report Settings remain additive/reconciliatory only. Any schema conflict, dirty read-back, active legacy row, unexpected mutation count, non-clean repository, wrong environment/profile, or enabled Report runtime flag fails closed.

## Validation

Hotfix-focused tests cover:

- full Connector runtime still rejects a stale TikTok Source override;
- administrative Lark runtime removes Connector Source overrides from runtime validation only;
- every Connector feature flag is false in administrative scope;
- canonical Integration Workspace TikTok identity remains `chemistry_k`;
- Lark token/table environment values remain unchanged;
- the caller-provided environment object is not mutated.

Branch Verification history:

- run `30378764997` on HEAD `6f8dbc0c4ef944e62db9af4cec4b01963a7da8ca`: expected test-fixture failure because the regression enabled Facebook UAT before reaching the intended TikTok identity assertion; implementation gates before the full suite passed;
- fixture corrected to isolate the stale TikTok override without changing implementation behavior;
- run `30378972903` on HEAD `f830c02431599138860148295b3fd8258592795c`: PASS.

Successful run `30378972903` completed every required gate:

- `npm ci`: PASS;
- `npm run check`: PASS;
- focused staged TikTok regression: PASS;
- Unit and Workers runtime tests: PASS;
- `npm run test:report-reliability`: PASS;
- `npm audit`: PASS;
- `npm run deploy:dry-run`: PASS / no deployment;
- diagnostics upload: PASS.

No additional Live Lark action occurred during Hotfix implementation or CI. After merge, rerun the exact one-command finalizer from clean current `main`.
