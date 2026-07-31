# Current Task — Meta History Cloudflare Account Resolution Recovery v4

## Status

```text
TASK_STATUS                    = REPOSITORY_HOTFIX_IN_REVIEW
CURRENT_PROGRAM                = META_HISTORY_CLOUDFLARE_ACCOUNT_RESOLUTION_V4
BASE_MAIN_SHA                  = 2d63fd58cfee7710cded74ff3a0dd86f85345038
SHARED_QUEUE_AUTHORITY         = #343 / SQUASH_MERGED
BRANCH                         = hotfix/meta-history-2026-cloudflare-account-resolution-v4
IMPLEMENTATION_PR              = #348 / DRAFT / DO_NOT_MERGE
SUPERSEDED_PR                  = #346 / CLOSED_NOT_MERGED / RUNNER_PREFIX_INVALID
ORIGINAL_IMPLEMENTATION_PR     = #319 / SQUASH_MERGED
RUNTIME_PREFLIGHT_HOTFIX_PR    = #330 / SQUASH_MERGED
PINNED_CONTINUITY_HOTFIX_PR    = #342 / SQUASH_MERGED
PREVIOUS_HANDOFF_PR            = #344 / SQUASH_MERGED
PLANNED_OPERATION_COUNT        = 6
FOURTH_ATTEMPT_META_OPERATIONS = 0
FOURTH_ATTEMPT_REMOTE_WRITES   = 0
SCHEDULE                       = DISABLED
PRODUCTION                     = BLOCKED
NEXT_STEP                      = EXACT_HEAD_VERIFICATION_REVIEW_AND_MERGE_V4
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
of the six history operations. The restore child repeated the same unnecessary `whoami` dependency. No
Remote mutation path had been entered.

## Established Cloudflare authority

```text
Cloudflare account     Social MKT Data Hub DEV
CLOUDFLARE_ACCOUNT_ID  present in local .dev.vars
Wrangler account_id    copied into generated private config when present
Cloudflare API token   present in local .dev.vars / never committed
```

Account selection and authentication are separate. A known Account ID plus explicit API token must not
depend on a Wrangler user-membership command.

## Shared authority now on main

PR #343 merged the repository-wide Queue bootstrap ordering contract at
`main@2d63fd58cfee7710cded74ff3a0dd86f85345038`:

```text
explicit API token      → no Wrangler authentication command
Environment account ID  → first account authority
Wrangler config ID       → second account authority
whoami                   → fallback only when Account ID is absent
exact Queue REST GET     → account/token/Queue permission gate
```

Meta v4 is rebased onto that Main and uses the same existing shared
`resolveCloudflareAccountId()` / `resolveCloudflareBearerAuth()` authority. It does not add another Queue,
Authentication or Account-resolution engine.

## Meta correction

- Read the generated private config first.
- Ask the shared Account-ID resolver to use explicit `CLOUDFLARE_ACCOUNT_ID` or config `account_id` without
  running `whoami`.
- Run `wrangler whoami --json` only when the shared resolver reports that membership discovery is genuinely
  required.
- Preserve fail-closed handling for invalid explicit/config Account IDs.
- Use explicit `CLOUDFLARE_API_TOKEN` directly; keep `wrangler auth token --json` only as missing-token
  fallback.
- Keep Queue discovery, Worker all-false verification, Reliability-idle checks and all six operation
  contracts unchanged.
- Add a focused regression that rejects unconditional `whoami` ordering.

## Runner routing correction

PR #346 used a Branch name outside the repository-approved `hotfix/meta-history-2026-` prefix. GitHub sent
both workflows to exhausted hosted capacity and they failed before `Set up job`; no Source/Test verdict was
produced. PR #348 points to the same reviewed Runtime/Test content under the exact self-hosted runner prefix.

## Safety boundary

Repository implementation and CI perform no Cloudflare Remote query/write, Worker deployment, Queue/DLQ
send, Provider request, D1/Lark Business mutation, Schedule activation, Secret change or Production action.

Do not rerun the public Terminal command while this Hotfix is unmerged.

## Required verification

```text
Focused Meta public-launcher regression       PASS required
Shared Queue auth-order regression            PASS required through current main
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
