# Project Brain — Chatwoot Remote Preflight Next Gate

## Repository state

```text
current main                         = c124e6fdbe27fcd56fb357baef1b4769957748df
WooCommerce preflight PR             = #118 / MERGED
WooCommerce merge SHA                = 15fcf96b42825cb132d581b47d21ce1780186199
Chatwoot safe-config PR              = #125 / MERGED
Chatwoot safe-config merge SHA       = e4ada6d91037a133aa6bfee17485e11ff3c4b49f
TikTok audit exact-version fix PR    = #120 / MERGED
TikTok audit fix merge SHA           = c124e6fdbe27fcd56fb357baef1b4769957748df
```

## Decision

The immediate Chatwoot sequence is:

```text
clean current main
→ generate ignored all-flags-false Safe Wrangler config
→ verify generated file and clean Git state
→ run Chatwoot Remote read-only preflight only
→ stop before Backup
```

The local source `wrangler.sync.jsonc` and generated output remain ignored. They must not be committed.
The generator performs no Remote command. The preflight may read Worker/D1/Queue/DLQ metadata, Secret
names, migration ledger and SELECT-only state required by the merged readiness contract.

## Authorized boundary

```text
Safe config preparation          AUTHORIZED / LOCAL ONLY
Chatwoot Remote preflight        AUTHORIZED / READ-ONLY ONLY
D1 backup                        NOT AUTHORIZED BY THIS GATE
Migration 0018 apply             NOT AUTHORIZED
Schema read-back                 NOT AUTHORIZED UNTIL PRIOR PHASES PASS
Chatwoot Provider API            NOT AUTHORIZED
Queue / DLQ                      NONE
Lark                             NONE
Worker deployment                NOT AUTHORIZED
Schedule / Webhook               DISABLED
Production                       BLOCKED
```

A failed preparation or preflight must stop immediately. It must not be worked around by editing Remote
configuration, creating a temporary committed config, applying Migration `0018`, sending Queue messages,
calling Chatwoot, mutating Lark or deploying the Worker.
