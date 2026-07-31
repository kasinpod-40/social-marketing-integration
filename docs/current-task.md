# Current Task — Meta History Cloudflare Account Resolution Recovery v4

## Status

```text
TASK_STATUS                    = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                = META_HISTORY_CLOUDFLARE_ACCOUNT_RESOLUTION_V4
BASE_MAIN_SHA                  = a339a06afc57e6ee17c4413b2700e79235ceb3be
BRANCH                         = hotfix/meta-history-cloudflare-account-resolution-v4
IMPLEMENTATION_PR              = PENDING
ORIGINAL_IMPLEMENTATION_PR     = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR    = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR    = #342 / SQUASH_MERGED
PREVIOUS_HANDOFF_PR            = #344 / SQUASH_MERGED
PLANNED_OPERATION_COUNT        = 6
FOURTH_ATTEMPT_META_OPERATIONS = 0
FOURTH_ATTEMPT_REMOTE_WRITES   = 0
SCHEDULE                       = DISABLED
PRODUCTION                     = BLOCKED
NEXT_STEP                      = VERIFY_REVIEW_AND_MERGE_V4
```

## Fourth Terminal failure retained

The one-time command on `main@a339a06afc57e6ee17c4413b2700e79235ceb3be` stopped at:

```text
stage  cloudflare-readiness
code   META_HISTORY_2026_COMMAND_FAILED
cause  npx wrangler whoami --json exited 1
```

The failure occurred after local gates and private safe-config generation but before Remote Worker/D1
inspection, fresh Meta identity validation, Queue admission, Provider reads, D1/Lark Business writes or any
of the six history operations. The restore child repeated the same unnecessary `whoami` dependency and
therefore could not independently re-read Remote safe state. No Remote mutation path had been entered.

## Established Cloudflare authority

The Integration Workspace already has stable non-secret account authority:

```text
Cloudflare account     Social MKT Data Hub DEV
CLOUDFLARE_ACCOUNT_ID  present in local .dev.vars
Wrangler source config copies account_id into the generated safe config
Cloudflare API token   present in local .dev.vars / never committed
```

The launcher nevertheless executed `wrangler whoami --json` unconditionally before asking the existing
shared resolver to use `CLOUDFLARE_ACCOUNT_ID` or config `account_id`. This made a proven API-token/config
path depend on a separate user-session membership command.

## Root cause and correction

- Resolve `CLOUDFLARE_ACCOUNT_ID` from the explicit environment first.
- Otherwise resolve top-level Wrangler `account_id` from the already generated private config.
- Only when neither stable source exists may the launcher call `wrangler whoami --json` as fallback.
- Preserve fail-closed handling for invalid explicit/config Account IDs.
- Preserve `wrangler auth token --json` only as fallback when no explicit API token exists.
- Keep Queue discovery, Worker all-false verification, Reliability-idle checks and all operation contracts
  unchanged.
- Add a regression that proves static Account ID resolution occurs before the only remaining `whoami`
  invocation and rejects a return to unconditional `whoami`.

## Safety boundary

Repository implementation and CI perform no Cloudflare Remote query/write, Worker deployment, Queue/DLQ
send, Provider request, D1/Lark Business mutation, Schedule activation, Secret change or Production action.

Do not rerun the public Terminal command while this Hotfix is unmerged.

## Required verification

```text
Focused Meta public-launcher regression       PASS required
Meta End-to-End Verification                  PASS required
Branch Verification                           PASS required
Full Unit / Workers runtime                   PASS required
Report reliability                            PASS required
Dependency audit                              PASS required
Wrangler dry-run                              PASS required
Changed files                                 Meta scope only
Remote action during implementation and CI    0
```

## Public command boundary after merge and handoff

The only public entrypoint remains:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

Do not invoke the one-command child, finalizer child, phase launchers or manual Queue sends. Retain all
previous output/evidence directories.

Detailed contract: `docs/tasks/meta-history-cloudflare-account-resolution-v4.md`.
