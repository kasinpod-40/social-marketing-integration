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
