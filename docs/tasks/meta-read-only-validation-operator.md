# Meta Customer Read-Only Validation Operator

## Status

```text
TASK_STATUS                  = IMPLEMENTATION_VERIFIED_DRAFT / PROVIDER_EXECUTION_NOT_RUN
PARENT_PR                    = #73
PARENT_BRANCH                = agent/meta-runtime-wiring
DRAFT_PR                     = #82
IMPLEMENTATION_BRANCH        = agent/meta-read-only-validation-operator
VERIFIED_HEAD_BEFORE_DOCS    = 5f11cc9b1a1b7aa25f1ecad42508a3847d47a7a5
META_VERIFICATION            = #22 PASS
BRANCH_VERIFICATION          = #575 PASS
ENVIRONMENT                  = development
CUSTOMER_PROFILE             = integration_workspace
CUSTOMER_KEY                 = chemistry_k
QUEUE_MESSAGE                = NOT_SENT
REMOTE_D1_OR_LARK_MUTATION   = NONE
WORKER_DEPLOYMENT            = NOT_RUN
SCHEDULES                    = DISABLED
PRODUCTION                   = BLOCKED
```

## Objective

Add a manual, evidence-chained and fail-closed operator for the first Chemistry K Meta customer
source validation gate after the protected runtime and two-account mapping contract in Draft PR
`#73`.

The ordered validation is:

```text
plan
→ configuration preflight with zero Provider requests
→ Facebook Organic exact Page validation
→ Instagram Organic exact Professional Account validation
→ Meta Ads chemistry_k2 exact Ad Account validation
→ Meta Ads chemistry_k3 exact Ad Account validation
→ sanitized evidence summary
```

## Scope implemented

1. Reuses the existing secret-owning `MetaGraphClient`, connection adapters and preflight
   classification. No second Meta client or connector was created.
2. Adds a single-connector preflight entry point so the operator can stop after each target and
   Meta Ads can resolve exactly one configured `sourceAccountKey` before any Provider request.
3. Adds exact phase confirmations and ordered evidence prerequisites.
4. Locks the runtime target to:
   - `MKT_ENV=development`;
   - `MKT_CUSTOMER_PROFILE=integration_workspace`;
   - `MKT_CONNECTION_CUSTOMER_KEY=chemistry_k`;
   - the approved Facebook, Instagram and two Meta Ads mappings from PR `#73`.
5. Requires every Connector, Meta write/read gate, D1/report gate, DLQ redrive gate and business
   schedule to be explicitly `false`.
6. Stores sanitized local evidence under `outputs/meta-read-only-validation/`, which is ignored by
   Git.
7. Adds focused tests and npm commands for every phase.

## Safety contract

- Default invocation is plan-only.
- `--execute` without the exact phase confirmation fails closed.
- Configuration preflight constructs adapters but performs zero Provider requests.
- Each Provider phase validates only one target and uses the existing GET-only Graph transport.
- Tokens stay in `.dev.vars` or the local secret environment and are never printed or written to
  evidence.
- Raw Page, Instagram and Ad Account IDs are not included in operator output or evidence.
- Request evidence contains only operation names, counts, retry status and the fixed `GET` transport
  contract.
- Unknown Meta Ads aliases fail before the Provider request.
- Facebook, Instagram, chemistry_k2 and chemistry_k3 must pass in order; a later phase cannot run
  without all earlier evidence.
- The operator contains no Queue send, D1 mutation, Lark mutation, Worker deploy, schedule,
  retention/delete or Production path.

## Files

```text
scripts/lib/meta-read-only-validation-operator.js
scripts/meta-read-only-validation-operator.mjs
tests/application/meta-read-only-validation-operator.test.js
packages/application/src/use-cases/preflight-meta-customer-connections.js
tests/application/preflight-meta-customer-connections.test.js
docs/runbooks/meta-read-only-validation.md
package.json
```

## Acceptance result

```text
Plan-only default                                  PASS
Exact confirmation per executable phase           PASS
Exact Integration Workspace target                 PASS
Exact Chemistry K identity mappings                PASS
All execution/write/schedule flags false           PASS
Configuration preflight Provider requests          0 by contract/test
One Connector/account per Provider phase           PASS
Unknown account alias Provider requests            0 by regression
Transport                                          GET only
Token query parameter                              forbidden by shared client/test
Ordered evidence chain                             PASS
Output/evidence raw IDs or tokens                  blocked by sanitization tests
Queue / D1 / Lark / deploy / schedule              none
Focused Meta tests                                 PASS
Full Unit / Workers runtime tests                   PASS
Report reliability regression                      PASS
Dependency audit                                   PASS
Wrangler deployment dry-run                        PASS / no deployment
Live Provider execution                            NOT RUN / separate approval
```

## Verification evidence

Temporary verification PR `#83` exposed the exact stacked head against `main` without merging it.

```text
Meta End-to-End Verification run 30240840940 / #22   PASS
Branch Verification run 30240840961 / #575           PASS
```

Both workflows passed locked dependency install, syntax/architecture/repository hygiene, focused
Meta or TikTok regression, full Unit and Workers runtime tests, Report reliability, dependency
audit, Wrangler dry-run and diagnostics upload.

## Implementation result

```text
STATUS          = IMPLEMENTATION_VERIFIED_DRAFT
DRAFT_PR        = #82
TESTS           = PASS / Meta #22 and Branch #575
LIVE_VALIDATION = NOT_RUN
REMOTE_ACTIONS  = NONE
REMAINING_RISK  = Real token validity, current permissions and exact Provider identities require
                  separately approved execution from an authorized local Integration Workspace.
```

## Next gate

After this stacked Draft and PR `#73` pass Integration Review, run the operator locally one phase
at a time using `docs/runbooks/meta-read-only-validation.md`. Provider execution is not authorized
by merge alone.

A clean summary only authorizes review of evidence. D1-only processing, Coverage reconciliation,
Lark parity, LIVE UAT, schedule activation and Production remain separate later gates.
