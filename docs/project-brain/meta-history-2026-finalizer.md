# Project Brain — Meta History 2026 Finalizer

## Program authority

```text
Initial history implementation          PR #319 / Squash Merged
Runtime-preflight recovery              PR #330 / Squash Merged
Pinned-continuity recovery              PR #342 / Squash Merged
Shared Queue auth ordering              PR #343 / Squash Merged
Meta Cloudflare account recovery        PR #348 / Squash Merged
Explicit Safe flags recovery            PR #353 / Squash Merged
Customer runtime config recovery        PR #359 / Squash Merged
Customer runtime config main SHA        339b72d8b950caffc78efaf513e6e6abf9bf4b0e
Meta verification                       #115 / PASS
Branch verification                     #1470 / PASS
Live history completion                 pending accepted Terminal evidence
```

The only public entrypoint is:

```bash
CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND \
node scripts/meta-history-2026-terminal.mjs --execute
```

The one-command child, finalizer child, D1/Lark phase launchers and manual Queue sends are not public
operator commands.

## Shared customer runtime authority

The Meta history public Terminal, D1 launcher and Lark launcher share one non-secret Integration Workspace
authority:

```text
MKT_ENV                     development
MKT_CUSTOMER_PROFILE        integration_workspace
MKT_CONNECTION_CUSTOMER_KEY chemistry_k
META_GRAPH_API_VERSION      v25.0
Facebook mapping            approved Chemistry K Page
Instagram mapping           approved Chemistry K Professional Account
Meta Ads mappings           chemistry_k2 and chemistry_k3
META_AD_ACCOUNT_ID          empty
```

The approved mappings are the same authority that completed the ordered Chemistry K GET-only identity and
permission validation on 2026-07-27. Raw identity values remain in Source only where required for exact
runtime mapping and are excluded from sanitized evidence. Tokens and credentials remain in `.dev.vars` or
Worker Secret storage and are never written into generated config, Source logs or evidence.

The runtime sequence is:

```text
caller environment
→ apply exact customer runtime authority
→ close all reviewed execution flags false
→ guarded child
→ read Head-bound Safe Wrangler config
→ replace stale customer vars and insert missing vars
→ validate exact runtime authority
→ write private 0600 runtime config under ignored outputs/
→ D1 and Lark operators use that reviewed runtime config
```

The runtime config remains inside the Repository path boundary required by the D1/Lark operators without
making the Working Tree dirty. The operator does not modify `.dev.vars`, and the user does not manually
supply API version or customer identities on the public command.

## Explicit Safe environment authority

The public Terminal owns the environment passed to the guarded child. Before child execution it must:

```text
apply exact customer runtime authority
→ close every existing MKT_*_ENABLED key
→ materialize every META_D1_ONLY_REQUIRED_FALSE_FLAGS key as false
→ freeze the child environment
→ spawn the guarded child with that exact environment
```

This Shared list is a superset of the Meta read-only requirements and is also the D1 safe-config authority.
A missing execution flag is explicit `false`; a stale `true` or a future `MKT_*_ENABLED` key is also closed.

The child operators continue to fail closed, and later D1/Lark active windows enable only the reviewed
private-config flags before restoring all execution flags false.

## Seventh attempt incident

The Terminal attempt on `main@2ddc9cef8262f768d1b589e5b7bc069d861d80a4` passed local gates, Cloudflare
readiness, Remote all-false verification and the fresh ordered Provider GET-only validation. It then stopped
while loading the first Facebook July D1 target because the generated Safe config did not contain
`META_GRAPH_API_VERSION`.

The failure occurred before Remote D1 inspection, backup, Worker deployment and Queue admission:

```text
Current Meta operations       0
D1 backup                     0
Worker deployments            0
Meta Queue messages           0
Remote D1 Business writes     0
Remote Lark Business writes   0
Provider validation           GET-only passed
Emergency restore             not required
Worker safe restore           verified
Schedule mutations            0
Production                    blocked
```

All previous evidence remains retained.

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
- Generated Safe and customer-runtime configs are private `0600` with absolute runtime paths.
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
