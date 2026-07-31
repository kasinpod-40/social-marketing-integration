# Chatwoot Final Queue Topology Normalization Hotfix

## Incident

The guarded Chatwoot Final UAT passed local gates, Lark table mapping and Queue identity discovery, then stopped during read-only Queue topology validation. Wrangler returned current consumer aliases `batch_size` and `max_wait_time_ms`, while the Chatwoot operator read only legacy `max_batch_size` and `max_batch_timeout`. The resulting `null` values caused a false topology drift decision.

```text
safeRestore = NOT_REQUIRED
production  = BLOCKED
```

No temporary Active Worker deployment, Queue message, D1/Lark Business write or Chatwoot Provider request occurred.

## Correction

- Reuse `assertWooCommerceQueueConsumerTopology()` as the shared Queue topology authority.
- Accept reviewed modern aliases `batch_size` and `max_wait_time_ms` and retained legacy aliases.
- Convert millisecond wait time to exact whole seconds.
- Fail closed when aliases disagree, fields are missing, consumer identity is ambiguous or values differ.
- Preserve Chatwoot public error code and redact raw Queue inventory.
- Do not change Queue configuration, Worker flags, Schedule, Webhook or Production.

## Validation

```text
npm ci
npm run check
focused Chatwoot Final/Lark/Queue/runtime/recovery tests
focused TikTok staged regression
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
exact-head Branch Verification
```

`docs/current-task.md` remains owned by the concurrent Meta workstream and is intentionally unchanged.
