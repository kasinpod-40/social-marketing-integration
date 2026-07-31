# Meta History Runtime Safe Config Recovery v7

## Incident

The eighth one-time Meta history Terminal attempt passed local verification, Cloudflare readiness, Remote
all-false verification and the ordered GET-only Meta customer identity validation. It then entered the first
Facebook July operation and stopped before D1 preflight Remote activity with:

```text
META_D1_ONLY_CONFIG_INVALID
Meta D1-only config requires MKT_WOOCOMMERCE_D1_WRITE_ENABLED=false
```

The D1 target loader rejected the private runtime Wrangler config before Remote D1 inspection, backup,
Worker deployment, Queue admission, D1/Lark Business write, Schedule mutation or Production action.
`emergencyRestoreRequired=false`, and the outer closeout verified all Worker execution flags false.

## Root cause

The process environment and deployment config had different Safe-flag completeness.

The public Terminal already materialized the complete `META_D1_ONLY_REQUIRED_FALSE_FLAGS` list as string
`false` before spawning the guarded child. The customer runtime-config recovery materialized only
Integration Workspace customer/API/mapping values in the private Wrangler config.

D1/Lark operators intentionally validate config text independently from process environment. The first
missing flag was WooCommerce D1 write, but every missing Shared flag represented the same defect.

## Decision

Extend the existing runtime authority instead of adding a one-off WooCommerce flag:

```text
META_HISTORY_RUNTIME_CONFIG_ENV
  = exact customer/API/mapping authority
  + Object.fromEntries(META_D1_ONLY_REQUIRED_FALSE_FLAGS => "false")
```

`META_D1_ONLY_REQUIRED_FALSE_FLAGS` remains the single source of truth. Terminal, D1 and Lark do not maintain
parallel flag inventories.

## Runtime sequence

```text
caller environment
→ exact customer authority
→ all Shared required flags false
→ guarded one-command child
→ read Head-bound Safe Wrangler config
→ replace stale quoted values
→ replace stale boolean true/false values
→ insert all missing customer and Safe vars
→ validate every occurrence is an exact reviewed string
→ write private 0600 runtime config under ignored outputs/
→ D1 and Lark use the same authority
```

## Safety properties

- No `.dev.vars` mutation.
- No Secret value copied into Source, config or evidence.
- No manually duplicated Safe flag list.
- Missing flags are inserted before operator target loading.
- Existing string or boolean flag values are normalized to reviewed strings.
- Non-string or conflicting residual values fail closed.
- Customer/API mappings remain unchanged from the GET-only validated authority.
- Runtime config materialization is idempotent.
- Schedule remains disabled and Production remains blocked.

## Acceptance criteria

```text
required-false source                                  Shared operator export
all required flags in process Environment              string false
all required flags in private Wrangler config          string false
MKT_WOOCOMMERCE_D1_WRITE_ENABLED                       false
future additions to Shared list                        automatically materialized
stale string true                                      replaced
stale boolean true/false                               replaced
missing flag                                           inserted
runtime config repeated materialization                byte-identical
D1 and Lark config authority                           identical
credentials in runtime config/evidence                 0
.dev.vars writes                                       0
Remote action during implementation/CI                 0
focused Meta tests                                     PASS
Meta End-to-End Verification                           PASS
Branch Verification                                    PASS
full Unit/Workers, Report, audit, Wrangler dry-run      PASS
```

## Live continuation boundary

The failed attempt did not complete D1 target loading, create D1 preflight evidence, export a backup, deploy a
Worker or create a Queue attempt. After merge and a docs-only execution handoff, the public Terminal may be
run once from exact clean current `main`.

Retain every prior evidence directory. If a future attempt reaches deployment or Queue admission and then
stops, do not blindly rerun; inspect exact operation evidence, Remote flags and active Work/Lock/Queue state.
