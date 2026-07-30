# WooCommerce Final Empty DLQ Identity Hotfix v1

## Prevented incident

Cloudflare Queue consumer responses represent no dead-letter Queue as an empty string:

```text
dead_letter_queue: ""
```

The reviewed Final core compares the DLQ consumer topology against `deadLetterQueue: null`. The Queue compatibility adapter already normalized the semantic value internally but did not write the normalized top-level field back to the JSON passed to the immutable core.

## Correction

For the exact `wrangler queues consumer list <queue> --json` compatibility path:

- preserve a non-empty main Queue `dead_letter_queue` name;
- convert an empty-string DLQ identity to JSON `null`;
- preserve modern batch and wait fields;
- continue adding only the reviewed legacy batch aliases;
- leave every other `npx` command unchanged.

## Regression

- official modern main Queue response with a non-empty DLQ name;
- official modern DLQ response with `dead_letter_queue: ""`;
- direct array, `result` and `consumers` containers;
- immutable Final core Git-blob identity;
- invalid/conflicting topology remains fail-closed.

## Safety

Implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue/DLQ send, Provider request, Schedule change, Meta execution, Secret change or Production action. The next Live run remains blocked until exact-head CI and Squash Merge complete.
