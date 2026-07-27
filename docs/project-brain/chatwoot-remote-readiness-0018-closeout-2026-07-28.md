# Project Brain — Chatwoot Remote Readiness and Migration 0018 Closeout

## Final status

```text
STATUS                              = PASS / CLOSED
CONTRACT_VERSION                    = chatwoot_remote_readiness_v1
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
CUSTOMER_KEY                        = chemistry_k
WORKER                              = social-mkt-sync-worker
DATABASE                            = social-mkt-state-dev
MIGRATION                           = 0018_chatwoot_analytics.sql
MIGRATION_STATE                     = APPLIED_AND_SCHEMA_READBACK_PASSED
PRODUCTION                          = BLOCKED
```

## Execution evidence

The guarded sequence completed successfully on `2026-07-27` UTC:

```text
Remote read-only preflight
→ Remote D1 backup
→ Migration 0018 apply
→ Remote schema read-back
```

Local evidence remains ignored under:

```text
outputs/chatwoot-remote-readiness/
```

No backup SQL, local absolute path, Wrangler config, Secret value, Provider response or PII is committed.

## Preflight result

```text
pending migrations                  = 0018_chatwoot_analytics.sql only
Chatwoot tables before              = 0
Chatwoot indexes before             = 0
active durable work                 = 0
active locks                        = 0
remote mutation count               = 0
```

Target fingerprint:

```text
2ba6d3087df1b0e3a348e9ede61db99f82c2b680a1f4f4929ad7ed7def097eb5
```

## Backup result

```text
backup file basename                = social-mkt-state-dev-before-0018-20260727T184034412Z.sql
backup SHA-256                      = 418c6972303b3307d49fadcada14c854d965cbfbd95335f1931239b87aa49606
backup status                       = PASS / NONEMPTY / LOCAL_IGNORED
```

## Migration result

```text
migration                           = 0018_chatwoot_analytics.sql
migration SHA-256                   = ca73b8c2acf1f9b7162b69ea1e2fdd320bfef807ed16b367cdab9d4a6200abdd
apply status                        = PASS
schema read-back required           = true
```

## Final schema read-back

```text
Chatwoot tables                     = 14 / 14
Chatwoot indexes                    = 15 / 15
Chatwoot Business rows              = 0 across all 14 tables
active durable work                 = 0
active locks                        = 0
business fact drift                 = false
pending migrations                  = 0
```

Shared Business facts remained unchanged across the preflight/read-back boundary:

```text
sync_runs                           = 2524
sync_jobs                           = 0
coverage_runs                       = 7
coverage_entities                   = 3396
organic_content_state               = 2021
organic_content_observations        = 2021
open_dlq                            = 121
open_alerts                         = 210
```

The nonzero open DLQ and alert counts are preserved pre-existing facts. This rollout did not delete,
rewrite or resolve them.

## Mutation boundary

```text
Chatwoot Provider requests          = 0
Chatwoot token values read          = 0
Queue actions                       = 0
DLQ actions                         = 0
Lark mutations                      = 0
Worker deployments                  = 0
Schedule/Webhook activations        = 0
Production actions                  = 0
```

## Durable decision

The Chatwoot D1 readiness and Migration `0018` phase is complete and must not be rerun. The next
Chatwoot phase, when separately opened, is exact identity/permission GET-only Provider preflight. It
must not enable the Connector, write Business data, send Queue messages, mutate Lark, deploy the Worker,
or activate Schedule/Webhook merely because the schema phase passed.

`docs/current-task.md` remains owned by the active WooCommerce final rollout and is intentionally not
replaced by this parallel Chatwoot closeout.
