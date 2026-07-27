# Current Task — Meta Runtime and Read-Only Operator Merge Closeout

## Authoritative status

```text
TASK_STATUS                         = MERGED_PROVIDER_EXECUTION_NOT_AUTHORIZED
CURRENT_PROGRAM                     = META_CHEMISTRY_K_READ_ONLY_VALIDATION
RUNTIME_PR                          = #73 / MERGED
RUNTIME_MERGE_COMMIT                = 13ebba1476d7983428c5b5ce51ce754adf493ad5
RUNTIME_REVIEWED_HEAD               = a700f5f31ebd24a32cc64cc6ca5ffe123a632ff4
RUNTIME_META_VERIFICATION           = #26 PASS
RUNTIME_BRANCH_VERIFICATION         = #593 PASS
OPERATOR_PR                         = #82 / MERGED
OPERATOR_MERGE_COMMIT               = 0f38aeb8a1c69e8655145f97808f3d3d1b31615a
OPERATOR_REVIEWED_HEAD              = 9b6f8d48891daa9ad7620f731dcdf2483da871e3
OPERATOR_META_VERIFICATION          = #29 PASS
OPERATOR_BRANCH_VERIFICATION        = #605 PASS
ENVIRONMENT                         = development
CUSTOMER_PROFILE                    = integration_workspace
CUSTOMER_KEY                        = chemistry_k
PROVIDER_EXECUTION                  = NOT RUN
TOKEN_READ_OR_ROTATION              = NOT RUN
QUEUE_MESSAGE                       = NOT SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
WORKER_DEPLOYMENT                   = NOT RUN
SCHEDULES                           = DISABLED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT RUN
PRODUCTION                          = BLOCKED
```

## Merge result

PR `#73` was Squash Merged into `main` at
`13ebba1476d7983428c5b5ce51ce754adf493ad5` after alignment with the merged YouTube Organic
baseline and final verification on reviewed head
`a700f5f31ebd24a32cc64cc6ca5ffe123a632ff4`.

PR `#82` was rebuilt on the merged parent baseline and Squash Merged into `main` at
`0f38aeb8a1c69e8655145f97808f3d3d1b31615a` after final verification on reviewed head
`9b6f8d48891daa9ad7620f731dcdf2483da871e3`.

Repository merge alone did not call Meta, read or rotate a Token, deploy a Worker, send a Queue
message, mutate Remote D1/Lark, enable a Schedule or authorize LIVE UAT.

## Chemistry K exact source identities

```text
Facebook Page
page_id=982406442148381
name=เคมี K

Instagram Professional Account
account_id=17841413521012797
username=chemistry_key

Meta Ads
sourceAccountKey=chemistry_k2
account_id=505898710119851
name=ChemistryK2

sourceAccountKey=chemistry_k3
account_id=851206695716861
name=ChemistryK3
```

Canonical Ads mapping:

```text
META_AD_ACCOUNT_MAPPINGS=chemistry_k2=505898710119851,chemistry_k3=851206695716861
```

Tokens remain Environment/Secret Manager inputs and are not committed, logged or written into
operator evidence.

## Merged protected runtime

The Shared Worker route now preserves this order:

```text
YouTube guarded route
→ Google Ads protected route
→ Meta protected route
→ existing TikTok/report/active fallback
```

Merged Meta contracts:

- Facebook Organic, Instagram Organic and Meta Ads jobs remain `uat_pending` and manual-only;
- Meta Connector activation requires the exact Integration Workspace and source-read gate;
- all new Connector/source/D1/Lark/report flags default to `false`;
- Meta Ads mappings are bounded, normalized and reject duplicate aliases or Account IDs;
- canonical multi-account and legacy singular configuration cannot be enabled together;
- every Meta Ads operation selects exactly one configured `sourceAccountKey`;
- Queue work identity is `meta_ads:<sourceAccountKey>:<operationId>`;
- sync-run identity, Reliability scope and continuation preserve the selected account;
- Coverage IDs include the exact Ad Account ID;
- preflight results expose sanitized counts only;
- the existing Reliability, Queue, D1 history/Coverage and Lark `TableSyncEngine` are reused.

## Merged read-only operator

The operator is deliberately ordered and fail-closed:

```text
plan
→ configuration preflight with zero Provider requests
→ Facebook exact Page validation
→ Instagram exact Professional Account validation
→ Meta Ads chemistry_k2 exact validation
→ Meta Ads chemistry_k3 exact validation
→ sanitized summary
```

Safety contract:

- plan-only default;
- exact confirmation for every executable phase;
- every Connector, Meta, D1/report, DLQ-redrive and Schedule flag must explicitly be `false`;
- one Connector/account is validated per Provider phase;
- transport is GET-only and the bearer Token is not placed in the URL;
- unknown Meta Ads aliases fail before a Provider request;
- evidence is ordered and bound to contract version, API version and sanitized target fingerprint;
- evidence contains no Token or raw Page/Instagram/Ad Account ID;
- the operator contains no Queue, D1/Lark mutation, Worker deployment, Schedule or Production path.

## Verification result

Runtime final verification:

```text
Meta End-to-End Verification      #26 / 30242465671 PASS
Branch Verification               #593 / 30242465674 PASS
```

Operator final verification:

```text
Meta End-to-End Verification      #29 / 30243180589 PASS
Branch Verification               #605 / 30243180585 PASS
```

The workflows passed dependency installation, diff and repository hygiene, focused Meta/TikTok
regressions, full Unit and Workers runtime tests, Report reliability, dependency audit, Wrangler
dry-run and diagnostics upload. Wrangler validation did not deploy a Worker.

## Repository hygiene note

During PR `#82` branch reconstruction, a temporary file `tmp/noop` containing only `x` was
accidentally committed directly to `main` at
`62857a7e6c298b4be02dc105aeecbff4080d5313` and immediately removed at
`6158a8b1381d62539274a7fa77d7860bdbee624a`.

The final tree contains no temporary file. The incident changed no Business fact, Secret, Runtime
configuration, migration, Queue state, D1/Lark data or deployed infrastructure. Both commits remain
visible as audit history.

## Remote safe state

```text
Meta Provider/API GET             NOT RUN
Token inspection/rotation         NOT RUN
Queue message                     NOT SENT
DLQ action                        NONE
Remote D1 migration/mutation      NONE
Remote Lark schema/data mutation  NONE
Worker deployment                 NOT RUN
Schedule activation               NONE
Customer/Production LIVE UAT      NOT RUN
Production                        BLOCKED
```

## Next separately authorized gate

The next action requires a local authorized Integration Workspace checkout containing the real
Meta credentials. It must be executed one phase at a time:

1. run the operator plan;
2. authorize and run configuration preflight with zero Provider requests;
3. review the preflight evidence;
4. authorize one Facebook GET-only validation;
5. authorize one Instagram GET-only validation;
6. authorize one `chemistry_k2` GET-only validation;
7. authorize one `chemistry_k3` GET-only validation;
8. generate and review the sanitized summary.

Merge does not authorize these Provider phases automatically. D1-only processing, Coverage
reconciliation, Lark parity, LIVE UAT, schedule activation and Production remain separate later
approval gates.

## Detailed records

```text
docs/tasks/meta-runtime-wiring.md
docs/tasks/meta-read-only-validation-operator.md
docs/runbooks/meta-read-only-validation.md
```

Previous Current Task:

```text
docs/archive/current-task-before-meta-read-only-operator-closeout-2026-07-27.md
```
