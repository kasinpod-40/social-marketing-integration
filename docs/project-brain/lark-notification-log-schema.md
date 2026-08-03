# Project Brain — Lark Notification Log Schema

## Current authority

AI Preview in `🧠 MKT_AI_Report_Runs` has been completed manually for the eight evidence-backed TikTok/Executive rows while every Preview safety field remains non-sendable. The next approved additive object is one Notification attempt log table; Automation, destination activation and message sending remain separate phases.

```text
Physical Table        🔔 MKT_Notification_Log
Primary Field         notification_attempt_key
Fields                15
Views                  6
Filtered Views         5
Records                0
Automation             disabled
Notification/Webhook   0/0
Schedule               disabled
Production             blocked
```

## Icon and identity decision

The existing shared Lark client creates a Table from `name`, `default_view_name` and ordered Fields. There is no separate icon mutation in that reviewed client path. The physical Table name therefore carries the deterministic `🔔` Emoji prefix.

The plain logical name `MKT_Notification_Log` is treated as a legacy alias only. Finding it in the live Base blocks the installer before mutation; the operator does not rename, delete or create a second table beside it.

## Data contract

The log stores stable attempt identity, AI source identity, dedupe identity, destination hash, report window/period, deterministic severity, redacted payload checksum, attempt lifecycle, timestamps, sanitized failure evidence and Preview mode.

It never stores:

- Webhook URL;
- raw Group ID;
- App/Tenant access token;
- message authorization;
- customer PII;
- raw error body.

## Views

```text
🌐 All Notification Attempts
🧪 Preview Attempts
⏳ Pending / Sending
✅ Sent
❌ Failed
🛑 Blocked / Deduped
```

View filters reuse the existing Lark schema filter resolver. Select names are resolved to live option IDs, Boolean checkbox values remain Boolean, and readback comparison hydrates every View individually.

## Safety

The exact Terminal is metadata-only and additive-only. Its network allowlist excludes every Record, Automation, webhook, D1, Queue, Worker, Provider, Schedule and Production path. Unknown Fields/Views or conflicting existing schema stop the run rather than attempting cleanup.

The installer is resumable only through fresh metadata inspection. It creates missing approved schema, verifies exact zero drift, writes private sanitized evidence and leaves all business/send flags unchanged.

Full contract:

```text
docs/tasks/lark-notification-log-schema-v1.md
```
