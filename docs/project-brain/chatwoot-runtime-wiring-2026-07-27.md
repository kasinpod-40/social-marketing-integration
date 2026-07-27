# Chatwoot Integration Runtime Wiring — 2026-07-27

## Repository status

```text
WORKSTREAM                          = CHATWOOT_INTEGRATION_RUNTIME_WIRING
BRANCH                              = integration/chatwoot-safe-wiring
DRAFT_PR                            = #97 / OPEN / DRAFT / UNMERGED
BASE_MAIN                           = 53c710dcadab14febe5b95078193a185038e0453
ALIGNED_VERIFIED_HEAD               = c44b1b2247b3374d95022eef01317f77c7e0eca0
BRANCH_VERIFICATION                 = #652 / 30265406254 / PASS
MIGRATION_0017                      = APPLIED_OUTSIDE_WORKSTREAM / DO_NOT_RERUN
MIGRATION_0018                      = CHATWOOT SOURCE_ONLY / NOT_APPLIED
REMOTE_ACTIONS_BY_THIS_WORKSTREAM   = NONE
PRODUCTION                          = BLOCKED
```

## Architecture result

The merged Chatwoot analytics foundation is connected to the existing Shared runtime without adding
parallel infrastructure:

```text
Chatwoot manual_uat Queue job
→ account-scoped stable operation identity
→ existing Reliability / distributed lock / generation fence
→ existing resumable work and incremental checkpoint stores
→ read-only Chatwoot Application API client
→ D1ChatwootAnalyticsStore
→ existing Coverage store
→ optional existing Lark repository / TableSyncEngine
→ checkpoint last
```

The top-level Worker route is:

```text
Chatwoot
→ WooCommerce
→ YouTube
→ Google Ads
→ Meta
→ TikTok / reports / active fallback
```

Non-Chatwoot routing remains unchanged. The branch is aligned with the merged TikTok route-stability
Hotfix at `53c710dcadab14febe5b95078193a185038e0453` and preserves those Shared repository facts.

## Durable identity

```text
workKey       = chatwoot:<accountKey>:<operationId>
generation    = originalRequestedAt
syncRunId     = chatwoot:<accountKey>:<operationId>
```

The Router preserves the deterministic `syncRunId` in the live result and resumable completion so a
completed replay returns stable evidence rather than an undefined identifier.

## Data and privacy result

Migration `0018` creates 14 additive Chatwoot state/fact tables with replay-safe indexes. It contains
no destructive SQL and no columns for message body, direct contact PII, raw Provider payload,
Authorization material, Token or Secret.

Migration `0017_woocommerce_commerce.sql` was applied outside this Chatwoot workstream according to
current `main`; it must not be rerun. Chatwoot Migration `0018` remains source-only and unapplied.

Runtime models retain only approved operational identifiers, hashes, classifications, timestamps,
counts and durations. Raw label text and arbitrary attributes are excluded.

## Gate result

All controls remain false by default:

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Connector-disabled execution does not read Provider identity or credentials. Daily/report output
requires both the Report gate and `fullSnapshot=true`. Webhook remains unsupported and no Schedule
producer was added.

## Sink ordering

- Coverage begins Partial.
- D1 state/facts complete before an optional Lark Business write.
- Lark-disabled execution does not construct Lark dependencies.
- Coverage becomes Complete only after every enabled required sink succeeds.
- Checkpoint advances last.
- D1/Lark failure, lock loss and generation mismatch fail closed through Shared contracts.

## Verification evidence

```text
Focused staged TikTok             = 4 / 4 PASS
Node Unit / Integration           = 1050 / 1050 PASS
Workers runtime                   = 11 / 11 PASS
Report reliability                = 91 / 91 PASS
Chatwoot-named tests              = 38 / 38 PASS
Dependency audit                  = 0 vulnerabilities
Wrangler dry-run                  = PASS / no deployment
Diagnostics artifact             = 8652588987
Artifact digest                  = sha256:2465e36229a6b1c6a6949f52fd0d57eae56fe77badffea8e359602e22e2622ff
```

## Remote safe state

No Chatwoot Provider request, Customer Token access, Remote D1 query/backup/Migration `0018` apply or
Business write, Remote Lark mutation, Queue/DLQ action, Worker deployment, Schedule/Webhook
activation, Customer LIVE UAT or Production action occurred.

Repository verification and a future Repository merge authorize none of those phases automatically.
