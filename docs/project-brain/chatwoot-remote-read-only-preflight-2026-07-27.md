# Chatwoot Remote Read-only Preflight — 2026-07-27

## Repository status

```text
WORKSTREAM                  = CHATWOOT_REMOTE_READ_ONLY_PREFLIGHT
BASE_MAIN                   = f3e330339b114536c3a1a9ee7567abf5a76fa78b
BRANCH                      = integration/chatwoot-remote-read-only-preflight
DRAFT_PR                    = #109 / OPEN / DRAFT / UNMERGED
RUNTIME_PR                  = #97 / MERGED
CLOSEOUT_PR                 = #108 / MERGED
MIGRATION_0017              = APPLIED / DO_NOT_RERUN
MIGRATION_0018              = SOURCE_ONLY / EXPECTED_PENDING
CODE_VERIFIED_HEAD          = fce0028d0931eae79634d61bfc29ed4d14df8090
BRANCH_VERIFICATION         = #657 / 30275990578 / PASS
REMOTE_EXECUTION            = NOT_RUN
REMOTE_MUTATION             = NONE
PRODUCTION                  = BLOCKED
```

## Decision

Before backup or application of `0018_chatwoot_analytics.sql`, the Integration Workspace requires a
Remote preflight based on actual read-only Remote responses. Local `wrangler.sync.jsonc` or example
configuration is not evidence that the active Worker is safe.

The implemented Operator contract is:

```text
chatwoot-remote-read-only-preflight-v1
plan → preflight
```

Default execution is `plan`. The `preflight` phase requires `--execute`, an exact confirmation,
exact reviewed Git HEAD and a clean Working Tree.

## Remote evidence required

- active Worker version matches the reviewed version at 100% traffic;
- all six Chatwoot Connector/D1/Lark/Report/Schedule/Webhook flags are false;
- Chatwoot Base URL and external Account ID match approved SHA-256 fingerprints;
- `CHATWOOT_API_ACCESS_TOKEN` exists in the Secret-name list without reading its value;
- Migration `0017` exists in the applied ledger;
- Migration `0018` is not applied and is the only pending migration;
- Main Queue and DLQ each have a consumer;
- protected Worker script exists, Cron matches the Repository contract and workers.dev is disabled;
- local Wrangler strict dry-run bundle has a deterministic SHA-256;
- Evidence records zero Remote mutations, Provider requests and Secret-value reads.

## Evidence boundary

Evidence is written privately below ignored `outputs/` and retains only exact Git/version state,
hashes, counts and booleans. It excludes raw Worker variables, raw Base URL, raw Chatwoot Account ID,
Cloudflare Account ID, Authorization headers, API tokens, Lark credentials and raw response bodies.

## Safety boundary

The Operator has no path for:

```text
Chatwoot Provider/API request
Secret value read/rotation
Remote D1 backup/write/migration apply
Remote Lark request/mutation
Queue send/retry/DLQ
Worker deployment
Schedule/route/workers.dev mutation
LIVE UAT
Production
```

Cloudflare credentials are used only by separately authorized read-only metadata requests and are
never included in output or evidence.

## Files

```text
scripts/chatwoot-read-only-preflight-operator.mjs
scripts/lib/chatwoot-read-only-preflight-operator.js
tests/application/chatwoot-read-only-preflight-operator.test.js
docs/tasks/chatwoot-remote-read-only-preflight.md
docs/current-task.md
```

## Verification

```text
Focused staged TikTok             = 4 / 4 PASS
Chatwoot preflight focused tests  = 9 / 9 PASS
Node Unit / Integration           = 1059 / 1059 PASS
Workers runtime                   = 11 / 11 PASS
Report reliability                = 91 / 91 PASS
Dependency audit                  = 0 vulnerabilities
Wrangler dry-run                  = PASS / no deployment
Artifact                          = 8656831975
Artifact digest                   = sha256:bc8c085862f25f29f4df76d6ca167b2fe86cb0158978bdea8014a644f795b44d
```

## Remaining gate

PR #109 must remain Draft until an explicit merge decision. Repository verification or merge does
not authorize the actual Remote run. Remote preflight needs separate authorization, exact target
inputs and read-only Cloudflare credentials. Migration `0018`, Provider preflight, D1/Lark writes,
Queue activity, deployment, schedules and Production remain blocked.
