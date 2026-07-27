# Current Task — Chatwoot Foundation Merge Closeout and Runtime Wiring Gate

## Authoritative status

```text
TASK_STATUS                         = FOUNDATION_MERGED_RUNTIME_WIRING_WAITING_FOR_MIGRATION_OWNER
CURRENT_PROGRAM                     = CHATWOOT_INTEGRATION_RUNTIME_WIRING
FOUNDATION_PR                       = #68 / SQUASH_MERGED
FOUNDATION_MERGE_COMMIT             = 80601de973740e8654b2cea2c4ecf419f4378c0a
FOUNDATION_REVIEWED_HEAD            = dd2d15ffe9684ac6be567a23c36dbc25786b1038
FOUNDATION_BRANCH_VERIFICATION      = #619 / 30245463139 PASS
FOUNDATION_CHANGED_FILES            = 10 / CHATWOOT-ONLY
LATEST_MERGED_MIGRATION             = 0016_tiktok_post_lark_pipeline.sql
WOO_INTEGRATION_PR                  = #94 / OPEN / RESERVES 0017
CHATWOOT_MIGRATION                  = PROVISIONAL_0018 / NOT_CREATED
RUNTIME_BRANCH                      = NOT_CREATED
RUNTIME_PR                          = NOT_OPENED
PROVIDER_EXECUTION                  = NOT RUN
TOKEN_READ_OR_ROTATION              = NOT RUN
QUEUE_MESSAGE                       = NOT SENT
REMOTE_D1_OR_LARK_MUTATION          = NONE
WORKER_DEPLOYMENT                   = NOT RUN
SCHEDULE_OR_WEBHOOK                 = DISABLED
CUSTOMER_OR_PRODUCTION_LIVE_UAT     = NOT RUN
PRODUCTION                          = BLOCKED
```

## Foundation merge result

PR `#68` passed Integration Review after all recorded blockers were remediated. It was aligned with
`main` through PR `#95`, verified on exact head
`dd2d15ffe9684ac6be567a23c36dbc25786b1038`, and Squash Merged into `main` at
`80601de973740e8654b2cea2c4ecf419f4378c0a`.

Merged foundation scope:

- bounded Chatwoot Application API polling;
- correct backwards Message-history pagination;
- strict retry, timeout, page, row and response-size bounds;
- PII-minimized account, inbox, contact, agent, team, label, conversation, message and event models;
- stable keys, deterministic source hashes and immutable identity protection;
- correct Daily Message/Event/Conversation date grain and null semantics;
- independent Connector, D1, Lark, Report and Checkpoint gates;
- partial-to-complete Coverage finalization only after required sinks;
- batched D1 reads and existing `TableSyncEngine` reuse.

The merge adds no numbered migration and performs no runtime wiring.

## Migration ownership and parallel-workstream lock

WooCommerce Integration Draft PR `#94` is the current owner of additive Migration `0017`.
Chatwoot must not create a numbered migration while that ownership is unresolved.

The next Chatwoot migration is only **provisionally** `0018`. Before implementation, refresh:

1. current `main`;
2. open Integration PRs;
3. the actual migration directory;
4. PR `#94` status and final migration number.

If WooCommerce does not merge `0017`, Chatwoot must allocate from the then-current sequence rather
than preserving a gap or assuming `0018`.

## Runtime Wiring scope after migration ownership stabilizes

Open a unique Integration branch and Draft PR. Recommended branch:

```text
integration/chatwoot-safe-wiring
```

Repository-only implementation must:

1. allocate the next additive Chatwoot migration without collision;
2. create the approved Chatwoot D1 tables and indexes;
3. wire `D1ChatwootAnalyticsStore` through the existing Worker route;
4. reuse the existing Reliability runner, distributed lock, generation fence, Queue retry and DLQ;
5. preserve D1-before-Lark ordering and partial Coverage until every enabled required sink succeeds;
6. add Connector/Job catalog status as `uat_pending`, never directly `active`;
7. add exact runtime flags with every value defaulting to `false`;
8. add Shared Lark logical mappings only—no Remote Base apply;
9. keep Webhook unsupported and Schedule disabled;
10. add route-isolation, gate-combination, lock-loss, retry, partial-sink and checkpoint regressions;
11. pass exact-head Branch Verification and stop before Remote actions.

## Required default-false controls

```text
MKT_CONNECTOR_CHATWOOT_ENABLED=false
MKT_CHATWOOT_D1_WRITE_ENABLED=false
MKT_CHATWOOT_LARK_WRITE_ENABLED=false
MKT_CHATWOOT_REPORT_WRITE_ENABLED=false
MKT_SCHEDULE_CHATWOOT_ENABLED=false
MKT_CHATWOOT_WEBHOOK_ENABLED=false
```

Storage or Report gates must never implicitly enable Connector, Schedule or Webhook execution.

## Remote safe state

The foundation alignment, verification and merge performed no:

```text
Chatwoot Provider/API request       NOT RUN
Customer token access/rotation      NOT RUN
Worker deployment                   NOT RUN
Numbered migration creation/apply   NONE
Remote D1 Business mutation         NONE
Remote Lark schema/data mutation    NONE
Queue send / retry / DLQ action     NONE
Schedule/Webhook activation         NONE
Customer/Production LIVE UAT        NOT RUN
Production                          BLOCKED
```

## Next action

Do not start collision-prone runtime implementation until WooCommerce PR `#94` establishes the
migration owner. Once stable, create the Integration branch from then-current `main`, re-read
`AGENTS.md` and this file, inspect the entire Shared runtime and open Draft PRs, then implement and
verify Repository-only Runtime Wiring.

Detailed closeout:

```text
docs/project-brain/chatwoot-foundation-merge-closeout-2026-07-27.md
```

Previous Current Task archive:

```text
docs/archive/current-task-before-chatwoot-foundation-closeout-2026-07-27.md
```
