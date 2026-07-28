# YouTube Shared-Worker True-Flag Scope — 2026-07-28

## Verified live evidence

The authenticated YouTube Remote read-only preflight completed Cloudflare Worker, Queue, Trigger and D1 migration-list reads, then stopped at the strict flag guard:

```text
YOUTUBE_DRY_RUN_REMOTE_TRUE_FLAG_INVALID
Remote deployment contains an unapproved true flag
```

No mutation occurred:

```text
REMOTE_MUTATION       = NONE
PROVIDER_CALL         = NOT_RUN
QUEUE_MESSAGE         = NOT_SENT
D1_WRITE              = NONE
LARK_REQUEST          = NOT_RUN
WORKER_DEPLOYMENT     = NOT_RUN
```

## Repository diagnosis

`validateRemoteYouTubeDeploymentContract` enumerates every plaintext binding matching `MKT_*_ENABLED`. It rejects any true flag outside the two YouTube dry-run gates before the reviewed fingerprint is built. That contract is appropriate for the dedicated local safe/active rollout configs, which require all other flags false, but it creates false YouTube drift on the Integration Workspace Shared Worker when another independently reviewed connector is active.

## Compatibility correction

The live adapter now performs a comparison-only projection for known non-YouTube connector namespaces:

```text
CHATWOOT
FACEBOOK
GOOGLE_ADS
INSTAGRAM
META
TIKTOK
WOOCOMMERCE
```

Each binding is still required to be an explicit Boolean and unique. A real `true` value is replaced by `false` only in the in-memory sanitized YouTube fingerprint input. The original Wrangler response is not mutated or persisted.

YouTube-owned and shared-safety flags remain unscoped and authoritative. This includes the YouTube connector, End-to-End, Lark write, Analytics and Schedule gates. Unknown shared true flags remain fail-closed.

## Diagnostic boundary

Success evidence contains only `additionalConnectorTrueFlagCount`. It does not persist connector flag names or values. Failure diagnostics may expose only an allowlisted `unexpectedTrue` flag-name array, never binding values or the complete Remote contract.

## Safety boundary

This correction is Repository-only. It authorizes no Worker deployment, rollback, Queue/DLQ action, Remote D1 query beyond the existing migration-list read, D1/Lark write, Provider request, Cron/route/workers.dev/Secret mutation or Production action.
