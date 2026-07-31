# Current Task — Meta History Execution After Cloudflare Account Recovery v4

## Status

```text
TASK_STATUS                    = META_HISTORY_2026_EXECUTION_READY
CURRENT_PROGRAM                = META_HISTORY_2026_FINALIZER_V1
ORIGINAL_IMPLEMENTATION_PR     = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR    = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR    = #342 / SQUASH_MERGED
SHARED_QUEUE_AUTHORITY_PR      = #343 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_HOTFIX_PR   = #348 / SQUASH_MERGED
CLOUDFLARE_ACCOUNT_MAIN_SHA    = 51edf7fd33f8302d96c8cf986940cc9e6b9523cc
META_VERIFICATION_RUN          = 30632339712 / #110 / PASS
BRANCH_VERIFICATION_RUN        = 30632340034 / #1424 / PASS
ACCOUNT_ID_BEFORE_WHOAMI       = REQUIRED
WHOAMI_WITH_CONFIGURED_ACCOUNT = FORBIDDEN
PLANNED_OPERATION_COUNT        = 6
FOURTH_ATTEMPT_META_OPERATIONS = 0
FOURTH_ATTEMPT_REMOTE_WRITES   = 0
SCHEDULE                       = DISABLED
PRODUCTION                     = BLOCKED
NEXT_STEP                      = RUN_META_HISTORY_2026_TERMINAL_ONCE
```

## Authority

PR #348 was Squash Merged at:

```text
51edf7fd33f8302d96c8cf986940cc9e6b9523cc
```

The exact reviewed Head `c6122a19a35fe0c0e0e9b775744004b2f75e1d0f` passed:

```text
Meta End-to-End Verification  run 30632339712 / #110 / PASS
Branch Verification           run 30632340034 / #1424 / PASS
Review threads                0
Branch behind main            0 before merge
Changed files                 5 / Meta scope only
Finalizer executable mode     100755
Remote action during hotfix   0
```

## Fourth attempt retained

The prior Terminal attempt on `main@a339a06afc57e6ee17c4413b2700e79235ceb3be` stopped at
`cloudflare-readiness` because the Meta finalizer called `npx wrangler whoami --json` before using the
already-configured Account ID.

It stopped before Remote Worker/D1 inspection, Meta Provider validation, Queue admission and every current
history operation:

```text
Meta operations             0
Meta Queue messages         0
Meta Provider requests      0
Remote D1 Business writes   0
Remote Lark Business writes 0
Worker deployments          0
Schedule mutations          0
Production                  blocked
```

Retain all evidence from this and every earlier attempt. Do not delete, copy or edit prior output
directories.

## Cloudflare authority now merged

The Integration Workspace already has stable Cloudflare routing/authentication in the local private
environment:

```text
Account name              Social MKT Data Hub DEV
CLOUDFLARE_ACCOUNT_ID     private Environment authority
Wrangler account_id       generated private config authority when present
CLOUDFLARE_API_TOKEN      private Environment secret authority
```

The merged execution order is:

```text
explicit API token
→ no Wrangler authentication command
→ explicit CLOUDFLARE_ACCOUNT_ID
→ otherwise generated Wrangler config account_id
→ whoami only when Account ID is genuinely absent
→ exact bounded Queue REST discovery
→ Worker all-false and Reliability-idle verification
```

Invalid explicit/config Account IDs remain fail-closed. The operator never silently selects another
Cloudflare account.

## Retained Meta continuity contract

- Historical local Meta clone/session/overlay/finalizer files are not required.
- Existing Facebook and Lark Business facts are never deleted or replaced.
- Fresh identity validation must pass for Facebook, Instagram and both Meta Ads accounts.
- The exact six-operation plan remains bound to the current merged Head.
- The historical operation is never replayed or replaced.
- One deterministic Facebook July operation fills missing history using Stable Business keys.
- D1 completes before same-operation Lark continuation.
- Completion requires canonical `larkParityVerified`, same-operation idempotency and final all-false state.
- Blind Queue resend remains blocked when admission is uncertain.

## Execution scope

```text
Facebook July        2026-07-01..2026-07-31
Instagram            2026-07-01..2026-07-31
Meta Ads required    2026-05-01..2026-07-31 for chemistry_k2 and chemistry_k3
Meta Ads optional    2026-01-01..2026-04-30 only under bounded baseline volume
```

## Public Terminal command

Run only from exact clean current `main`:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke `scripts/meta-history-2026-one-command.mjs`,
`scripts/meta-history-2026-finalizer.mjs`, D1/Lark phase launchers or manual Queue sends.

## Expected accepted result

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook continuity             fresh identity / no old replay
Facebook July supplemental      complete
Instagram July                  complete
Meta Ads required               complete for both accounts
D1/Lark parity                  pass
Same-operation replay           pass
Active Work / Lock / Queue      0 / 0 / 0
Worker flags                    all false
Schedule                        disabled
Production                      blocked
```

Live completion is not declared until the Terminal emits the accepted decision and final safe-state
evidence.

Detailed execution contract: `docs/tasks/meta-history-2026-one-command-v1.md`.
Cloudflare recovery contract: `docs/tasks/meta-history-cloudflare-account-resolution-v4.md`.
