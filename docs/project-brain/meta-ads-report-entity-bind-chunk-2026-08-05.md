# Project Brain — Meta Ads Report Entity Bind Chunk

Date: `2026-08-05`

## Locked repository finding

The Shared Paid Ads D1 reader used one `ads_entity_state` query for every unique ranking Ad ID. Three bindings are
always reserved for customer, platform and account. Under the reviewed D1 100-bound contract, one query may therefore
contain no more than 97 Ad IDs.

The current correction chunks sorted unique IDs into deterministic groups of 97 and executes them sequentially. It
preserves the explicit scalar projections merged in PR #512, the same entity map and identical Top Ads semantics.

## Runtime relation

The exact Meta Ads 3D recovery produced six `D1_ADS_REPORT_READ_FAILED` attempts, no materialization and a new Queue
retry-exhaustion DLQ. The unchunked entity query is a confirmed repository defect and is consistent with that runtime
boundary. The exact runtime root remains pending a SELECT-only count of unique 3D ranking Ads because the persisted
Sync Run exposed only the Shared wrapper error.

```text
Original DLQ  terminal:e408707c9c2d383e04a3e213a7be45a0
New DLQ       dlq:2f292f08f5bdc4f12c91b68ceff71e1b
Work/Lock     0 / 0
Baseline      Notification Runtime restored
```

## Recovery prohibition

Do not repeat the failed recovery root or Run All handoff. Do not generically resend, redrive, close or delete either
DLQ. After merge, collect exact new-DLQ identity and unique-Ad counts through SELECT-only inspection before creating
an exact continuation.

## Safety

Repository implementation performs no Worker deployment, Queue/DLQ action, Provider request, Remote D1/Lark
mutation, Notification Admission, Schedule or Production action.
