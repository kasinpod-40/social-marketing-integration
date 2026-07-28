# Report Runtime Finalize Operator

Status: `repository_implementation_complete_validated`

Branch: `codex/report-runtime-finalize-operator`

Stacked base: `codex/report-multichannel-runtime`

Draft PR: `#207`

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
- full Node/Workers tests: PASS;
- Report reliability: PASS;
- Wrangler dry-run: PASS;
- no Remote action executed.

GitHub Branch Verification run `30371545241` passed on exact implementation HEAD
`d646c0e38fe8e62497b674ad1b6a7ca0f6c011db`:

- install locked dependencies: PASS;
- syntax, architecture and repository hygiene: PASS;
- focused staged TikTok regression: PASS;
- Unit and Workers runtime tests: PASS;
- Report reliability regression: PASS;
- dependency audit: PASS;
- Wrangler dry-run: PASS;
- diagnostics upload: PASS.

No Worker deployment, Remote D1 action, Lark mutation, Queue action, Schedule activation,
Secret change, Production action or LIVE UAT was performed during repository validation.

## Final handoff

Merge order remains controlled and must preserve stacked ancestry:

1. PR `#195` into `main`;
2. retarget PR `#199` to `main`, verify its diff, then merge;
3. retarget PR `#207` to `main`, verify its diff, then merge;
4. update a clean local `main` checkout and run the single guarded command above.

The operator itself does not merge Pull Requests because repository authorization for this workstream explicitly keeps merge approval separate.
