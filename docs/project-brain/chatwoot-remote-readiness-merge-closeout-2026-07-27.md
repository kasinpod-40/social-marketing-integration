# Project Brain — Chatwoot Remote Readiness Operator Merge Closeout

## Verified status

```text
PR                                   = #111 / MERGED
SOURCE_HEAD                          = af9a0f087964716652fe29239009363e33ea7ced
SQUASH_MERGE_COMMIT                  = 4423d168d7802e1ee8b128a838a3188dd30416d1
MERGED_AT                            = 2026-07-27T15:36:33Z
MIGRATION_0018                       = SOURCE_ONLY / NOT_APPLIED
REMOTE_EXECUTION                     = NOT_AUTHORIZED
PRODUCTION                           = BLOCKED
```

PR #111 merged the guarded Chatwoot Remote readiness operator into `main`. The operator is plan-only
by default and separates every executable phase behind an exact confirmation and chain-bound evidence:

```text
plan
→ preflight
→ backup
→ migrate
→ schema-readback
```

## Locked safety contract

- Target is limited to `development`, `integration_workspace`, Chemistry K and
  `social-mkt-state-dev`.
- Migration `0017_woocommerce_commerce.sql` is already applied and has no rerun path.
- Before apply, the only allowed pending migration is `0018_chatwoot_analytics.sql`.
- Every Chatwoot, Business-write, reporting, Schedule, Webhook, retention, notification, Audit and
  DLQ-redrive control must be explicitly false.
- Preflight SQL and schema-readback SQL are SELECT-only.
- Preflight requires zero active durable work, zero active locks and no existing Chatwoot schema.
- Backup requires a non-empty Remote D1 export and SHA-256 evidence.
- Migration requires exact source/target/backup evidence and no remaining pending migration.
- Schema read-back requires exactly 14 Chatwoot tables, 15 indexes, zero Chatwoot Business rows and
  no drift in captured Shared counts.
- Evidence excludes Secret values, raw configuration, Provider payload and PII.

The operator contains no Chatwoot Provider request, Token read, Queue send, DLQ action, Lark call,
Worker deployment, Schedule/Webhook activation, retention/delete or Production path.

## Verification

```text
IMPLEMENTATION_VERIFICATION          = #662 / PASS
FINAL_HEAD_VERIFICATION              = #665 / PASS
NODE_UNIT_INTEGRATION                = 1061 / 1061 PASS
WORKERS_RUNTIME                      = 11 / 11 PASS
REPORT_RELIABILITY                   = 91 / 91 PASS
READINESS_OPERATOR_TESTS             = 11 / 11 PASS
DEPENDENCY_AUDIT                     = 0 vulnerabilities
WRANGLER_DRY_RUN                     = PASS / NO DEPLOYMENT
FINAL_ARTIFACT_DIGEST                = sha256:ef2c9fedda7adc73c282ecfc493e3009ed9c715cb47a0133bd36c59bb679da15
```

## Remote safe state

The merge itself performed no Remote preflight, D1 backup, Migration `0018` apply, schema read-back,
Chatwoot API request, Token access, Lark mutation, Queue/DLQ action, Worker deployment, Customer UAT,
Schedule/Webhook activation or Production action.

The next phase must be opened separately from then-current `main` and must authorize only the exact
Remote phase intended. The first eligible phase is read-only `preflight`; it must not implicitly
authorize backup, migrate or schema-readback.
