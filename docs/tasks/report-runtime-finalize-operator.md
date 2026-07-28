# Report Runtime Finalize Operator

Status: `repository_implementation_complete_validation_pending`

Branch: `codex/report-runtime-finalize-operator`

Stacked base: `codex/report-multichannel-runtime`

## Goal

Leave the Report workstream with one guarded Terminal command after the stacked PRs are merged into `main`:

```bash
CONFIRM_REPORT_RUNTIME_FINALIZE=EXECUTE_REPORT_RUNTIME_FINALIZE \
node scripts/report-runtime-finalize-operator.mjs --execute
```

The command performs repository validation, Lark Report Schema v2 preview/apply, canonical Dashboard Report Settings reconciliation, and zero-drift read-back. It writes sanitized local evidence only.

## Preconditions

- run from a clean `main` working tree after the Report PR stack is merged;
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

## Safety

The operator does not:

- deploy a Worker;
- mutate Remote D1;
- send Queue messages;
- enable Daily/Weekly schedules;
- enable Report D1 reads or preset materialization;
- enable AI summary;
- delete or rewrite Business facts;
- print credentials, tokens, authorization values, or secrets.

Schema and Report Settings are additive/reconciliatory only. Any schema conflict, dirty read-back, active legacy row, unexpected mutation count, non-clean repository, wrong environment/profile, or enabled Report runtime flag fails closed.

## Repository validation

Local validation completed before push:

- operator plan mode: PASS;
- focused operator tests: `4/4` PASS;
- `npm run check`: PASS;
- full Node/Workers tests: PASS after applying the already-reviewed AI fail-closed example fix present in the stacked base;
- Report reliability: PASS;
- Wrangler dry-run: PASS;
- no Remote action executed.

Final GitHub Branch Verification evidence must be recorded on the Draft PR HEAD before this status changes to `repository_implementation_complete_validated`.
