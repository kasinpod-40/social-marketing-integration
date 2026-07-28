# YouTube Shared-Worker True-Flag Scope Hotfix

## Objective

Allow the YouTube Remote read-only preflight to validate the YouTube and shared-safety contract on the Integration Workspace Shared Worker without treating deliberately enabled flags owned by other connectors as YouTube drift.

## Incident

After Queue timeout compatibility, shared Secret scoping, omitted-false materialization and bounded D1 migration-read retry were merged, the authorized read-only preflight progressed through Remote metadata reads and stopped fail-closed with:

```text
YOUTUBE_DRY_RUN_REMOTE_TRUE_FLAG_INVALID
Remote deployment contains an unapproved true flag
```

The operation remained read-only:

```text
remoteMutation   = NONE
providerCall     = NOT_RUN
queueMessage     = NOT_SENT
d1Write          = NONE
larkRequest      = NOT_RUN
workerDeployment = NOT_RUN
```

## Root cause

The strict validator inspected every `MKT_*_ENABLED` binding on the Shared Worker and allowed `true` only for the two YouTube dry-run gates. This is correct for a dedicated all-false rollout config, but not for a shared Integration Workspace Worker where TikTok, Meta, WooCommerce, Chatwoot, Facebook, Instagram or Google Ads may have separately reviewed active flags.

## Contract

- Known non-YouTube connector flags may retain their real Remote value.
- The compatibility adapter validates each such binding as an explicit Boolean and rejects duplicates.
- Known non-YouTube connector `true` values are projected to `false` only in the sanitized YouTube fingerprint input.
- The original Remote response, Worker version and configuration are never mutated or persisted.
- YouTube-owned flags remain authoritative and are never projected:
  - `MKT_CONNECTOR_YOUTUBE_ENABLED`
  - every `MKT_YOUTUBE_*_ENABLED`
  - `MKT_SCHEDULE_YOUTUBE_ENABLED`
- Shared flags outside a known connector namespace also remain authoritative.
- YouTube write, Analytics or Schedule flags set to `true` remain hard failures.
- Unknown shared `true` flags remain hard failures and expose only the sanitized flag name in diagnostics.
- Invalid Boolean values and duplicate bindings remain hard failures.

## Known non-YouTube connector namespaces

```text
CHATWOOT
FACEBOOK
GOOGLE_ADS
INSTAGRAM
META
TIKTOK
WOOCOMMERCE
```

## Acceptance criteria

- unrelated connector true flags do not alter the YouTube fingerprint;
- the source Remote response is unchanged after normalization;
- YouTube write/Analytics/Schedule true flags fail closed;
- unknown shared true flags fail closed;
- invalid and duplicate unrelated connector bindings fail closed;
- success output includes only the count of projected connector true flags, not values;
- failure diagnostics may include only allowlisted sanitized flag names;
- existing Queue, D1 UUID, Secret subset, Cron, route, workers.dev, traffic, migration and fingerprint checks remain unchanged;
- full Repository gates pass;
- no Worker deployment, Queue/DLQ action, D1/Lark mutation, Provider request, Secret/Schedule change or Production action occurs.
