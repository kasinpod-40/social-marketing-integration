# Project Brain — Meta History 2026 Finalizer

## Program authority

```text
Initial history implementation          PR #319 / Squash Merged
Runtime-preflight recovery              PR #330 / Squash Merged
Pinned-continuity recovery              PR #342 / Squash Merged
Shared Queue auth ordering              PR #343 / Squash Merged
Meta Cloudflare account recovery        PR #348 / Squash Merged
Explicit Safe flags recovery            PR #353 / Squash Merged
Explicit Safe flags main SHA            1548ea1c16bcc1283ddc49334af4929d566bb162
Meta verification                       #113 / PASS
Branch verification                     #1459 / PASS
Live history completion                 pending accepted Terminal evidence
```

The only public entrypoint is:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

The one-command child, finalizer child, D1/Lark phase launchers and manual Queue sends are not public
operator commands.

## Explicit Safe environment authority

The public Terminal owns the environment passed to the guarded child. Before child execution it must:

```text
copy caller environment
→ close every existing MKT_*_ENABLED key
→ materialize every META_D1_ONLY_REQUIRED_FALSE_FLAGS key as false
→ freeze the child environment
→ spawn the guarded child with that exact environment
```

This Shared list is a superset of the Meta read-only requirements and is also the D1 safe-config authority.
A missing execution flag is explicit `false`; a stale `true` or a future `MKT_*_ENABLED` key is also closed.
Non-flag values and exact confirmations remain preserved without mutating the caller environment.

The child operators continue to fail closed, and later D1/Lark active windows enable only the reviewed
private-config flags before restoring all execution flags false.

## Fifth attempt incident

The Terminal attempt on `main@a0bbef75b0185ac55dba3a272eb925cfb1ea056b` stopped at
`fresh-read-only-validation` because `MKT_CONNECTOR_META_ADS_ENABLED` was absent from the inherited local
environment rather than explicit `false`.

It stopped before Provider validation and before every current history operation:

```text
Meta operations             0
Meta Queue messages         0
Meta Provider requests      0
Remote D1 Business writes   0
Remote Lark Business writes 0
Worker deployments          0
Schedule mutations          0
Worker safe restore         verified
```

All prior evidence remains retained.

## Retained history and data authority

- Historical local Meta clone/session/overlay/finalizer files are not required and are never executed.
- Existing Facebook and Lark facts remain authoritative and are never deleted or replaced.
- One deterministic Facebook July operation fills missing history with Stable Business keys.
- Instagram covers July 1–31, 2026.
- Meta Ads covers May 1–July 31, 2026 for both accounts, with January–April conditional on bounded volume.
- D1 completes before same-operation Lark continuation.
- Completion requires D1/Lark parity, same-operation idempotency, all-false Worker flags and active
  Work/Lock/Queue counts `0/0/0`.

## Cloudflare account authority

The Integration Workspace has stable private Cloudflare identity and authentication:

```text
Account name              Social MKT Data Hub DEV
CLOUDFLARE_ACCOUNT_ID     local .dev.vars authority
Wrangler account_id       generated private config authority when present
CLOUDFLARE_API_TOKEN      local .dev.vars secret authority
```

The ordering contract remains:

```text
explicit CLOUDFLARE_API_TOKEN
→ no Wrangler authentication command
→ explicit CLOUDFLARE_ACCOUNT_ID when present
→ otherwise generated Wrangler config account_id
→ whoami --json only when no Account ID is available
→ exact bounded Queue REST inventory
→ Worker all-false and Reliability-idle checks
```

## Runtime-preflight authority

- The source Wrangler config may be a readable regular file or symlink resolving to one.
- The generated execution config is private `0600` with absolute runtime paths.
- Remote Worker safety and Reliability idle are separate checks.
- Emergency all-false deployment is allowed only when exact evidence proves an active Worker execution
  flag; authentication/read/config failures never authorize deployment.
- Active Queue execution requires an attempt linked to active durable Work; historical `sync_runs` rows do
  not count as current execution.
- Blind Queue resend is blocked whenever an attempt file exists without accepted admission evidence.

## Pinned continuity authority

The finalizer writes Head-bound `pinned-facebook-continuity.json` and accepts it only when:

- the read-only Summary has the expected contract and no mutation;
- exactly four identities validate in order: Facebook, Instagram, `chemistry_k2`, `chemistry_k3`;
- all six target/range/mode/deterministic-operation-ID tuples match current Head;
- no historical operation ID is used;
- replay and replacement flags are false;
- canonical `larkParityVerified` and idempotency evidence pass.

## Final safe decision

Only accepted Terminal output can establish:

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook continuity             fresh identity / no old replay
Facebook July supplemental      complete
Instagram July                  complete
Meta Ads required               complete
D1/Lark parity                  pass
same-operation replay           pass
Worker flags                    all false
Active Work/Lock/Queue          0/0/0
Schedule                        disabled
Production                      blocked
```

Until then, Live completion is not declared.
