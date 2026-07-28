# Meta D1 Queue Consumer Contract Hotfix

## Incident

Facebook Meta D1-only rollout reached `verify-safe-baseline` after a successful read-only preflight, Remote D1 backup and Safe Worker deployment. Verification stopped fail-closed before any Facebook gates or Queue message with:

```text
META_D1_ONLY_QUEUE_TOPOLOGY_INVALID
Queue consumer drift for social-mkt-sync-jobs: maxBatchSize
```

The Safe Worker remained active with every execution flag false. No D1 business write, Queue message, Lark mutation, Provider request, Secret mutation, Schedule activation or Production action occurred.

## Root cause

The Meta verifier read only legacy Queue fields such as `settings.max_batch_size` and `settings.max_batch_timeout`. The current Cloudflare Queue consumer response may expose the official fields `settings.batch_size` and `settings.max_wait_time_ms`.

The Repository already has the shared `normalizeCloudflareQueueConsumerPayload` contract that validates equivalent official/legacy fields, converts milliseconds to whole seconds and rejects conflicts. Meta D1 verification did not reuse that Shared Core contract, causing a false topology drift.

## Correction

- Reuse `normalizeCloudflareQueueConsumerPayload` through the existing Meta Wrangler compatibility layer.
- Normalize scoped Wrangler Queue consumer JSON before strict topology comparison.
- Preserve exact expected values, queue context, DLQ topology and fail-closed conflicts.
- Add Meta-specific regression for official fields, legacy fields and conflicting fields.

## Safety

Repository implementation only. This hotfix performs no Remote D1 query/write, Queue/DLQ action, Worker deployment, Provider request, Lark request/mutation, Schedule/Secret change or Production action.
