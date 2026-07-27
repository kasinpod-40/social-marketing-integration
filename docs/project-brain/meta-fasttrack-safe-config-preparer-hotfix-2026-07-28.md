# Meta Fast-track Safe Config Preparer Hotfix — 2026-07-28

## Verified incident facts

```text
Meta Provider validation          = PASS / 4 targets
Meta fast-track operator          = merged
Attempted operation               = meta-facebook-fasttrack-20260727t182204z
Remote mutation                   = none
D1 writes                         = 0
Queue messages                    = 0
Worker deployments                = 0
Lark record/schema mutations      = 0
Provider requests                 = 0
```

Two read-only lanes stopped fail-closed:

1. Meta Lark metadata preflight found local Wrangler Table mapping drift at
   `rawMetaOrganicAccounts` before making a Lark request.
2. Meta D1 preflight found malformed generated JSONC after local text insertion added newly required
   WooCommerce/Chatwoot false flags.

No credential, token or raw Table ID was exposed in evidence.

## Decision

Do not weaken `META_LARK_TABLE_MAPPING_DRIFT` or required-false flag validation. Add a generated safe
config preparer instead of editing ignored `wrangler.sync.jsonc` with regex/text insertion.

The generated config must use the existing JSONC parser and path-rebase utility, synchronize all 15
Meta Lark mappings from the local Environment, force all execution flags false, reject secret-shaped
Wrangler vars and pass local Wrangler dry-run before use.

## Execution reset

The stopped operation performed no Remote action and may be abandoned. Because `main` advanced after
its reviewed SHA, any later deployment must use a new operation from then-current `main` and a newly
resolved active Worker version. Old Worktrees/Evidence are diagnostic only and must not continue into a
mutating phase.
