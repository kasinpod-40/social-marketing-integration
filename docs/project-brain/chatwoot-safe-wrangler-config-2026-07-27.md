# Project Brain — Chatwoot Safe Wrangler Config

## Decision

The Chatwoot Remote read-only preflight must not depend on a manually edited or temporarily committed
Wrangler config. The repository provides a deterministic local generator that derives a minimal
all-flags-false read config from the ignored Integration Workspace `wrangler.sync.jsonc`.

## Incident boundary

```text
main observed                = 829c5e214134e7faa0b32f458e6df40e0b8959f6
operator invoked             = false
blocker                      = NO_MATCHING_SAFE_WRANGLER_CONFIG
remote mutations             = 0
```

The stop was correct: the available local configs separately had the correct target/topology or the
complete false-flag set, but none had both.

## Durable contract

```text
contract                     = chatwoot_safe_wrangler_config_v1
source                       = ignored local wrangler.sync.jsonc
default output               = outputs/chatwoot-remote-readiness/
                               wrangler.chatwoot-preflight.safe.jsonc
remote commands              = 0
remote mutations             = 0
```

The generator copies only:

- optional Cloudflare account ID;
- Worker entrypoint and compatibility metadata;
- exact D1 UUID and migrations directory;
- exact Main Queue and DLQ topology.

It creates a minimal vars block containing only Integration target labels, Queue names and every flag
required by `CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS` set explicitly to `false`.

It never copies triggers, routes, Chatwoot Provider identity, OAuth identifiers, Lark mappings or
Secret values. It validates the output through the merged Chatwoot readiness validator before writing
success.

## Safety

Generated files remain under ignored `outputs/`. No D1 UUID or local config is committed. No Provider,
D1, Queue, Lark, Worker deployment, Schedule/Webhook or Production action is part of this task.

## Next operational sequence

```text
merge generator
→ refresh clean main
→ generate ignored Safe config
→ run Remote read-only preflight only
→ stop for separate Backup authorization
```
