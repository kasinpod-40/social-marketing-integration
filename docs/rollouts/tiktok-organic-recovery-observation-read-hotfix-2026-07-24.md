# TikTok Organic Recovery — D1 Observation Read Bind-Limit Hotfix

Date: 2026-07-24
Environment: Integration Workspace only
Production: blocked
Schedules: disabled
Lark business writes: none

## Live failure evidence

The first guarded recovery Queue message was accepted and processed by the Worker, but all six Main Queue attempts failed before Unit 3 completed.

```text
error_code = D1_ORGANIC_OBSERVATION_READ_FAILED
error_message = Failed to read Organic observation repair state
retry_count = 0..5
business facts = unchanged at 1309 / 1000 / 1000
write checkpoint = nextSequence 2 / unitsCompleted 2
recovery_status = in_progress
```

The recovery Queue message then reached the DLQ after retry exhaustion:

```text
message_id = 06f7660b796808ebca3b8cd2e7780894
job_type = tiktok.creator.native.history.recover
error_code = QUEUE_RETRY_EXHAUSTED
```

The original incident DLQ remains retained and open. No cleanup, delete, restore, manual Work mutation or new generation was performed.

## Confirmed root cause

`D1OrganicHistoryGateway.listObservedContentKeysAt()` used a batch of 100 Content keys and also bound `observed_at`, creating 101 bound parameters in one D1 statement.

Cloudflare D1 supports at most 100 bound parameters per query. The local SQLite test helper did not enforce this Cloudflare-specific runtime limit, so the recovery scenario passed locally but failed on Remote D1.

## Hotfix

- Define the D1 per-query bound-parameter ceiling explicitly as 100.
- Keep State reads at 100 keys because they have no fixed extra parameter.
- Reserve one parameter for `observed_at` and limit observation-repair reads to 99 keys per statement.
- Add a regression that executes a 500-key observation read against a fake D1 binding which rejects any statement above 100 bound parameters.

## Safety and next boundary

This hotfix changes only read batching. It does not alter row mapping, stable keys, write ordering, Work identity, checkpoint semantics, Coverage semantics, Queue retry rules, DLQ records or Lark behavior.

Before any retry of the exact recovery operation:

1. merge the hotfix after full CI;
2. deploy the Worker with all existing schedule/report/notification flags still false;
3. re-check that business facts remain 1309 / 1000 / 1000 and Work remains at nextSequence 2;
4. use a separately guarded exact resume action for the same operation/generation and recovery reference;
5. do not use generic DLQ redrive and do not create a new generation.
