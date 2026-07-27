# Project Brain — YouTube Shared-Worker Fingerprint Scope

## Durable live fact

After Queue timeout compatibility was merged, the YouTube Remote read-only preflight reached the complete
sanitized deployment contract comparison and stopped fail-closed with
`YOUTUBE_DRY_RUN_REMOTE_FINGERPRINT_MISMATCH`.

```text
REMOTE_MUTATION        = NONE
PROVIDER_CALL          = NOT_RUN
QUEUE_MESSAGE          = NOT_SENT
D1_WRITE               = NONE
LARK_REQUEST           = NOT_RUN
WORKER_DEPLOYMENT      = NOT_RUN
```

## Durable architecture decision

`social-mkt-sync-worker` is a shared Worker. Connector-specific Remote verification must validate the
connector's required Secret-name subset rather than fingerprint every Secret belonging to all connectors.
For YouTube the required subset is `LARK_APP_ID`, `LARK_APP_SECRET` and `YOUTUBE_API_KEY`.

Additional shared-Worker Secret names are permitted for the YouTube fingerprint only after:

- all required YouTube Secret names are present exactly once;
- no Secret value appears in Remote version output;
- the original Remote response remains unmodified outside the in-memory compatibility adapter.

Wrangler live metadata may omit plaintext bindings whose effective value is false. A connector verifier may
materialize such a value only when the binding name comes from the exact reviewed local contract. Explicit
Remote values are authoritative and must never be overwritten. Explicit true, invalid Boolean text and
duplicate binding names remain fail-closed.

## Shared Queue rule

YouTube must use `normalizeCloudflareQueueConsumerPayload` for current Cloudflare Queue API fields instead of
maintaining another connector-local translation. Main Queue and DLQ command contexts remain separate and
exact.

## Safety boundary

This decision changes only sanitized read-only comparison semantics. It does not authorize or perform
Worker deployment, Queue/DLQ mutation, D1 write/migration, Provider/Lark request, Secret mutation, Cron/route
change, Schedule activation or Production.

## Historical business baseline

YouTube Lark schema apply, full sync, idempotent rerun, incremental sync, lock/retry/DLQ/alert and identity
fail-closed validation remain confirmed. Existing RAW and Canonical business records are not modified by this
Hotfix.
