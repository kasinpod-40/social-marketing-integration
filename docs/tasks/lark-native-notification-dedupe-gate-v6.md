# Lark Native Notification Dedupe Gate v6

## Objective

Record the user-observed Lark Base Automation limitation and prevent the inactive notification Automation from being configured with an unsafe duplicate-send path.

## Confirmed UI evidence

The tenant's `Find records` action exposes only:

```text
When no records found:
- Continue
- Stop
```

It does not expose any supported branch or gate for:

```text
records found -> stop
records not found -> continue
```

The desired Notification Log contract requires exactly that inverse gate before message delivery.

## Safety decision

`AI Materialization → MKT_AI_Report_Runs` may remain saved and inactive.

`Eligible AI Run → Lark Group Notification` must remain the original inactive placeholder. Do not save a `Find records`, Notification Log, or Send Message chain that cannot fail closed on an existing `notification_attempt_key`.

## Contract v6

```text
contractVersion  lark_native_ai_disabled_configuration_preview_v6
status           repository_preview_ai_materialization_configured_notification_blocked
blockerCount     1
blocker          LARK_NATIVE_NOTIFICATION_DEDUPE_GATE_UNSUPPORTED
```

## Forbidden workarounds

Do not use any of the following without a separately reviewed architecture decision:

- HTTP Request
- AnyCross
- Webhook
- external Worker or provider
- using `dedupe_key` as a fake payload checksum
- setting `sent_to_group=true` before a send
- saving a workflow that can send when a prior attempt record exists

## Safe live state

```text
AI Materialization → MKT_AI_Report_Runs
Inactive / saved manual configuration

Eligible AI Run → Lark Group Notification
Inactive / original placeholder
```

## Safety

```text
Remote Lark read/write       0 / 0 from Repository work
Workflow mutation            0
Native AI call               0
Record write                 0
Notification send            0
Schedule                     disabled
Production                   BLOCKED
```
