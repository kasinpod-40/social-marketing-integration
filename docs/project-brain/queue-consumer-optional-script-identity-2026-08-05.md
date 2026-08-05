# Project Brain — Queue Consumer Optional Script Identity

Date: `2026-08-05`

## Verified live response

The exact Queue Consumer preflight returned one stable Consumer and matching topology but omitted `script_name` even
after exact Consumer hydration:

```text
consumerCount             1
consumerIdentityMatched   true
explicitTypeCount         3
typeMatched               true
explicitQueueNameCount    2
queueNameMatched          true
scriptNamePresent         false
detailHydrated            true
```

The preflight stopped before Evidence-root creation, deployment, Queue send or Remote mutation. The existing three
Meta Ads 3D DLQs and empty target are unchanged.

## Durable rule

Cloudflare Queue Consumer identity fields are optional response properties. Shared Report operators must distinguish
absence from disagreement:

- absence of `script_name` is not failure by itself;
- every explicit script name must match the reviewed Worker contract;
- exact deployed Worker verification remains the execution authority before Queue send;
- one Consumer, ID, type, Queue, settings and DLQ remain mandatory and fail closed.

## Preserved boundaries

- Report activation barrier: three exact samples across 120 seconds.
- Notification baseline restore: three samples across 30 seconds.
- Provider requests: zero.
- Notification Admission and schedules: false.
- Production: blocked.
- Do not rerun any previous continuation evidence root.
