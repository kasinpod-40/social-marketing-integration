# Report Runtime Finalize Operator

Status: `identity_scope_hotfix_validation_pending`

Original branch: `codex/report-runtime-finalize-operator`

Hotfix branch: `codex/report-finalizer-identity-scope-hotfix`

Original merged PR: `#207`

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

Required final gates:

- `npm ci`;
- `npm run check`;
- focused staged TikTok regression;
- Unit and Workers runtime tests;
- `npm run test:report-reliability`;
- `npm audit`;
- `npm run deploy:dry-run`.

No additional Live Lark action is authorized during Hotfix implementation or CI. After merge, rerun the exact one-command finalizer from clean current `main`.
