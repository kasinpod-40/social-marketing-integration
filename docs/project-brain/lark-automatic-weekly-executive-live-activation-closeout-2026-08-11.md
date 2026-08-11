# Lark Automatic Weekly Executive Live Activation Closeout — 2026-08-11

## Final state

```text
WORKSPACE                           = integration_workspace
REPOSITORY_MAIN_AT_ACTIVATION       = 89f9c615f2ae20f798b089e639c3d9dd5f1cb38a
ACTIVE_WORKER_VERSION               = f19492d2-67f4-4b7c-ba78-3bb84fb439e8
WORKER_TRAFFIC                      = 100_PERCENT
SOURCE_REPORT_COUNT                 = 8
NOTIFICATION_RUNTIME                = ENABLED
NOTIFICATION_SEND                   = ENABLED
NOTIFICATION_MIRROR                 = ENABLED
RUNTIME_MODE                        = runtime
AUTOMATIC_WEEKLY_NOTIFICATION       = ENABLED
WEEKLY_NOTIFICATION_TIME            = MONDAY_0830_ASIA_BANGKOK
AI_MATERIALIZATION_AUTOMATION       = ENABLED
BASE_NOTIFICATION_AUTOMATION        = DISABLED
IMMEDIATE_QUEUE_ADMISSIONS          = 0
IMMEDIATE_MESSAGE_SENDS             = 0
PRODUCTION                          = BLOCKED
```

## Activation evidence

The first live preview after the original automatic implementation failed read-only because the activation terminal passed flattened builder settings to a resolver that requires raw Lark `record.fields.*` records. It stopped with `LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID`, `matchCount=0`, and zero mutations. PR #633 corrected only this authority boundary and merged after exact-head Branch Verification passed.

The first execute after the authority fix updated three exact 7D Report Setting rows, then Cloudflare rejected Worker version creation because the automatic Worker path imports `node:crypto` and the ignored active Wrangler config did not yet enable Node compatibility. That attempt had zero Worker deployments, zero Queue admissions and zero message sends. Because deployment had been attempted, the guarded operator correctly avoided blind rollback.

Recovery kept those exact Settings active, added `nodejs_compat` to ignored `wrangler.sync.jsonc`, reran preview against current Lark authority and executed again. The final recovery required zero additional Setting writes and deployed Worker version `f19492d2-67f4-4b7c-ba78-3bb84fb439e8` at 100% traffic.

## Next automatic cycle

```text
Weekly Shared Report                = Monday 08:15 Asia/Bangkok
Automatic Weekly Executive          = Monday 08:30 Asia/Bangkok
Next scheduled execution            = 2026-08-17 08:30 Asia/Bangkok
Expected exact source period        = 2026-08-10..2026-08-16
```

No manual/test message was sent during activation or recovery. The automatic runtime must fail closed if the exact fresh period is incomplete or stale, Native AI is not generated, or the Executive Decision Quality Gate fails. Historical sent Weekly identities must never be substituted or resent.

## Operational note

The current live Worker path uses `node:crypto`; therefore the ignored active `wrangler.sync.jsonc` must preserve `nodejs_compat` on future deployments unless the Worker implementation is later migrated away from the Node built-in. This is runtime configuration state, not a committed secret or customer mapping.
