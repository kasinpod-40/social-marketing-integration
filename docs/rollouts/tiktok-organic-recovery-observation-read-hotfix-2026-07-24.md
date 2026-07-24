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

Implementation merge:

```text
9ada02baf6059b6d9efc1aab2b96a4ff3b0bdfa4
```

## Guarded hotfix rollout

The hotfix has a separate operator boundary. It does not reuse the original `send` phase and does not enable generic DLQ redrive.

### Hotfix deploy

```text
CONFIRM_TIKTOK_RECOVERY_HOTFIX_DEPLOY=DEPLOY_D1_BIND_LIMIT_HOTFIX_SCHEDULES_FALSE
npm run rollout:tiktok-recovery:hotfix-deploy
```

The deploy phase requires:

- `main` contains the exact hotfix merge;
- clean Git worktree;
- prior Migration 0010 evidence remains passed;
- exact Integration Workspace Worker/D1/Queue configuration;
- all schedule/report/notification/redrive flags remain false;
- syntax, architecture, focused recovery tests and Wrangler dry-run pass.

It writes `hotfix-deploy.json` with the exact deployed repository head.

### Exact resume

```text
CONFIRM_TIKTOK_RECOVERY_RESUME=RESUME_EXACT_TIKTOK_RECOVERY_AFTER_D1_BIND_FIX
npm run rollout:tiktok-recovery:resume
```

Before sending one exact payload, the resume phase requires all of the following Remote D1 evidence:

- business facts remain `1309 / 1000 / 1000`;
- original Work remains active at `nextSequence=2`, `unitsCompleted=2`, durable counters `1000`;
- original incident DLQ remains open;
- original recovery metadata remains `in_progress` with the same operation, Work, generation and recovery reference;
- tracked Main Queue attempts equal exactly `6`;
- failed recovery DLQ `dlq:06f7660b796808ebca3b8cd2e7780894` is retained open with retry exhaustion;
- exactly six matching failed Sync runs exist with retry counts `0..5` and `D1_ORGANIC_OBSERVATION_READ_FAILED`;
- lock is absent or expired;
- Coverage remains the exact partial `2021 / 0 / 0 / failed=0` shape.

Any mismatch stops before the Queue API call. A successful resume writes `resume.json` and sends the same operation/generation/recovery reference once.

## Safety and next boundary

This hotfix changes only read batching plus guarded rollout tooling. It does not alter row mapping, stable keys, write ordering, Work identity, checkpoint semantics, Coverage semantics, normal Queue retry rules, existing DLQ facts or Lark behavior.

Do not use generic DLQ redrive, do not re-run the old `send` phase, and do not create a new generation.
