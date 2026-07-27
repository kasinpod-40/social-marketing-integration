# Project Brain — YouTube Queue Timeout Remote Compatibility Hotfix

## Durable incident fact

The YouTube Remote read-only preflight authenticated and read Remote metadata, then failed closed before
mutation because Cloudflare exposed Queue wait time as `settings.max_wait_time_ms`, while the strict
validator consumed normalized seconds as `max_batch_timeout`.

```text
REMOTE_MUTATION        = NONE
QUEUE_MESSAGE          = NOT_SENT
D1_WRITE               = NONE
LARK_REQUEST           = NOT_RUN
WORKER_DEPLOYMENT      = NOT_RUN
```

## Durable decision

Treat the Cloudflare API field as authoritative only when it is a non-negative safe integer and exactly
convertible to whole seconds. Preserve the existing strict fingerprint contract after normalization.
Never default an absent Remote timeout from Local configuration.

Duplicate timeout representations are accepted only when they resolve to the same value. Any negative,
non-integer, fractional-second or conflicting representation fails closed.

## Historical boundary

YouTube DEV Lark schema apply, Full sync, idempotent rerun, incremental sync, lock/retry/DLQ/Alert and
identity fail-closed remain confirmed PASS. This Hotfix changes only Remote metadata compatibility and
must not rebuild or alter existing YouTube Business records.

## Safety

Repository Hotfix only. No Worker deployment, Queue send/Ack/Retry/DLQ action, D1 write/Migration,
YouTube/Lark request, Schedule/route/Secret mutation or Production action.
