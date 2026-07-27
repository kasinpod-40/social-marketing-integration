# Chatwoot Analytics Foundation Merge Closeout — 2026-07-27

## Repository result

```text
SOURCE_PR                    = #68
REVIEW_DECISION              = PASS_FOR_INTEGRATION_REVIEW
ALIGNED_REVIEWED_HEAD        = dd2d15ffe9684ac6be567a23c36dbc25786b1038
FINAL_BRANCH_VERIFICATION    = #619 / 30245463139 PASS
MERGE_METHOD                 = SQUASH
MAIN_MERGE_COMMIT            = 80601de973740e8654b2cea2c4ecf419f4378c0a
CHANGED_FILES                = 10 / CHATWOOT-ONLY
RUNTIME_WIRING               = NOT IMPLEMENTED
NUMBERED_MIGRATION           = NOT CREATED
REMOTE_EXECUTION             = NOT AUTHORIZED
```

PR `#68` imports the reviewed Chatwoot Application API polling and analytics foundation:

- bounded Conversation, Contact, Message and Reporting Event reads;
- backwards `before` Message-history pagination;
- strict timeout, page, row and response-byte limits;
- retryable non-JSON `429`/`5xx` classification;
- PII-minimized state and analytics normalizers;
- stable keys and deterministic source hashes;
- D1 current state, Reporting Event facts and Daily fact preparation;
- correct Message/Event/Conversation date grain and null semantics;
- independent Connector, D1, Lark, Report and Checkpoint gates;
- partial-to-complete Coverage finalization after required sinks;
- batched D1 state reads and immutable identity protection;
- existing `TableSyncEngine`, Coverage, checkpoint and Shared error contracts.

No duplicate Reliability engine, Queue framework, generic D1 writer, Lark engine or Report engine was introduced.

## Migration dependency

At closeout time:

```text
latest migration on merged main      0016_tiktok_post_lark_pipeline.sql
WooCommerce Integration PR #94       open / reserves additive Migration 0017
Chatwoot next migration               provisional 0018 / NOT CREATED
```

Chatwoot Runtime Wiring must not create or commit a numbered migration until WooCommerce PR `#94` reaches a stable merge decision and the migration directory is refreshed. If `0017` changes or is not merged, Chatwoot must reallocate from the then-current sequence rather than assuming `0018`.

## Remote safe state

The foundation merge performed none of the following:

- Chatwoot Provider/API request or Customer token access;
- Worker deployment;
- local or Remote numbered migration apply;
- Remote D1 Business mutation;
- Remote Lark schema or record mutation;
- Queue send, retry or DLQ action;
- Schedule or Webhook activation;
- Customer/Production LIVE UAT;
- Production configuration change.

## Next repository gate

After the Migration owner is stable, open a unique Integration branch and Draft PR to:

1. refresh `main`, open PRs and migrations;
2. import/reuse the merged Chatwoot foundation;
3. allocate the next additive migration without collision;
4. wire the existing Worker Reliability, lock, generation, Queue retry and DLQ boundary;
5. add exact default-false runtime flags and route isolation;
6. add Shared Lark logical mappings without Remote apply;
7. add migration, route, lock-loss, retry, partial-sink and checkpoint regressions;
8. pass exact-head Branch Verification;
9. stop before Remote execution.
