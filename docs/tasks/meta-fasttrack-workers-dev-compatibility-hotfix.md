# Meta Fast-track workers.dev Compatibility Hotfix

## Status

Repository-only hotfix. Remote execution remains blocked until merge and a new-operation read-only retry.

## Incident

The first retry from `main@d809d73010bb82f880a1bdc89c6a2dd7c1f45260` stopped before any Remote call because the local canonical `wrangler.sync.jsonc` omitted `workers_dev`. The safe-config preparer required the source value to be explicitly `false`, even though the generated safe config always sets `workers_dev=false`.

## Contract

- Accept source `workers_dev` only when omitted or exactly `false`.
- Reject source `workers_dev=true` and every non-boolean value.
- Generated safe config must always contain `workers_dev=false`.
- Preserve all existing all-false execution flags, 15 Meta Lark mappings, secret-value rejection, Meta D1/Lark config validation and local Wrangler dry-run.
- No Remote D1, Queue, Worker deployment, Provider, Lark, Schedule, Secret or Production action.
