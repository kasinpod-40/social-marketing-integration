# Lark Automatic Weekly Executive Notification — 2026-08-11

## Approved business state

The Weekly 7D Executive message for `2026-08-03..2026-08-09` was delivered successfully through the existing Shared Notification Runtime on `main@b7fa1629e3c4eaa9f5723814746427d3def23ccc`.

Verified one-shot result:

```text
Queue admission                    1
Lark message send                  1
D1 delivery                        sent / mirrored
Notification Log                   +1
sent_to_group                      true
exact delivery rows                1
duplicate delivery rows            0
additional sends during observation 0
reviewed message SHA-256           6b8a2f1d2243c0bb2575082afb4e5ea7a530e8d16de31a02ee666fcf27da2a5f
Decision Quality Gate              PASS
one-shot --execute                 PERMANENTLY CLOSED
```

The user explicitly approved promotion to automatic weekly delivery after reviewing the actual group message. This approval replaces the older `automatic_weekly_notification_requires_separate_approval` hold for the Integration Workspace only.

## Architecture

Automatic delivery must reuse the proven central path:

```text
Weekly Shared Report materialization
→ exact new 7D period
→ Fresh Executive AI identity
→ existing AI Materialization → MKT_AI_Report_Runs Automation
→ unchanged Executive Decision Quality Gate
→ deterministic executive_weekly_7d_notification_v1 AI identity
→ existing lark.notification.send Queue job
→ existing D1 atomic notification claim
→ existing Lark group sender
→ existing Notification Log + AI Run mirror
```

Forbidden alternatives:

- no new sender or Queue framework;
- no external AI provider/model runtime;
- no duplicate D1 writer/dedupe engine;
- no direct Cron-to-Lark send;
- no Base `Eligible AI Run → Lark Group Notification` automatic sender because its native dedupe boundary is not the delivery authority;
- no replay of the already-sent `2026-08-03..2026-08-09` identity.

## Schedule contract

```text
Timezone                         Asia/Bangkok
Weekly Shared Report            Monday 08:15
Automatic Weekly Executive      Monday 08:30
Target period end               previous completed Bangkok day
Expected next period            2026-08-10..2026-08-16
Expected next period end        2026-08-16
```

The automatic producer is separately gated by `MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED`. It must remain default false in repository examples and may become true only in the reviewed Integration Workspace activation.

## Freshness and no-old-week rule

The automatic job carries its exact `periodEnd`. Runtime source selection must equal that period and must contain every reviewed active Report platform. A missing/older Report set is retryable only inside the bounded Queue attempt window. A newer or mismatched period is permanent drift. Runtime must never substitute an older accepted Weekly message.

Each new week builds a deterministic Fresh Executive identity from the exact current 7D Report bundle. Native AI generation must pass the unchanged Executive Decision Quality Gate before a dedicated sendable notification AI row can be admitted.

## Native AI safety

The existing `AI Materialization → MKT_AI_Report_Runs` Automation must remain the exact reviewed active workflow. The existing Base `Eligible AI Run → Lark Group Notification` Automation must remain inactive.

Before the single `failure_code` trigger write, automatic runtime persists durable D1 attempt evidence. If the Lark update outcome is uncertain and the marker cannot be proven on readback, blind retrigger is forbidden. Generated/failed identity state is immutable.

## Notification exact-once safety

The downstream sender is unchanged. D1 `notification_attempt_key` remains the atomic send/dedupe authority:

- sent claim cannot send the group message again;
- mirror retry repairs Lark state without resending;
- unknown Lark send outcome becomes blocked and automatic resend is forbidden;
- duplicate Queue admission for the same dedicated notification identity cannot duplicate the group message.

## Activation target

Repository merge alone does not activate live automatic delivery. The reviewed Integration Workspace activation must leave:

```text
MKT_NOTIFICATION_RUNTIME_ENABLED          true
MKT_NOTIFICATION_LARK_SEND_ENABLED        true
MKT_NOTIFICATION_LARK_MIRROR_ENABLED      true
MKT_NOTIFICATION_RUNTIME_MODE             runtime
MKT_SCHEDULE_WEEKLY_REPORT_ENABLED        true
MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED  true
MKT_WEEKLY_NOTIFICATION_TIME              08:30
Exact 7D source Report Settings AI flags  true
Exact 7D source Report Settings notify    true
AI Materialization Automation             ON
Base Notification Automation              OFF
Production                                BLOCKED
```

Every existing Source/Daily/Weekly Report execution flag and Cron trigger must be preserved. Activation must not send a message immediately; the next real send is admitted only by the next due Fresh period.

## Live activation result — 2026-08-11

Automatic Weekly is now **LIVE ENABLED for the Integration Workspace**. Production remains blocked.

Repository implementation PR #630 merged at `8aba0b5dc112d96b37bc6522efc0443000ce046d`. The first live preview exposed a source-Settings authority defect: the activation terminal passed flattened builder settings into a resolver that requires raw Lark records. The preview failed read-only with `LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID`, `matchCount=0`, and zero settings/deploy/Queue/message mutations. PR #633 corrected that boundary by reading the exact canonical `report_setting_key` rows through the existing Lark Record Repository and merged at `89f9c615f2ae20f798b089e639c3d9dd5f1cb38a` after exact-head CI passed.

The first execute after PR #633 activated three exact 7D Report Setting rows, then Cloudflare rejected Worker version creation because the new automatic Worker path imports `node:crypto` while the ignored active Wrangler config did not yet include Node compatibility. This was a partial activation only: `settingsWriteCount=3`, `workerDeploymentCount=0`, `queueAdmissionCount=0`, `messageSendCount=0`, Base Notification Automation remained inactive, and Production remained blocked. Because deployment had been attempted, the guarded operator correctly did not perform a blind rollback.

Recovery preserved the active Settings and added `nodejs_compat` to the ignored active `wrangler.sync.jsonc`. This compatibility flag must be preserved by future deployments while the current Worker path imports `node:crypto`. Recovery preview saw the exact source Settings already active, so the final execute made zero additional Setting writes and successfully deployed the runtime.

Verified final state:

```text
status                              automatic_weekly_executive_notification_enabled
repository                          main@89f9c615f2ae20f798b089e639c3d9dd5f1cb38a
active Worker version               f19492d2-67f4-4b7c-ba78-3bb84fb439e8
traffic                             100 percent
activation source period            2026-08-04..2026-08-10
source Report count                 8
source Settings state before recovery active
source Settings active after        true
recovery settingsWriteCount         0
Notification runtime                enabled
Notification send                   enabled
Notification mirror                 enabled
runtime mode                        runtime
Automatic Weekly                    enabled
Weekly notification time            Monday 08:30 Asia/Bangkok
AI Materialization Automation       enabled
Base Notification Automation        disabled
immediate Queue admission count     0
immediate message send count        0
recovery Worker deployment count    1
Production                          BLOCKED
```

No manual/test message was sent during activation or recovery. The next eligible automatic cycle is Monday `2026-08-17 08:30 Asia/Bangkok`, targeting the exact fresh period `2026-08-10..2026-08-16`. If that source period is missing/incomplete, Native AI does not reach generated state, or the Executive Decision Quality Gate fails, the automatic flow must fail closed and must not substitute an older Weekly identity.
