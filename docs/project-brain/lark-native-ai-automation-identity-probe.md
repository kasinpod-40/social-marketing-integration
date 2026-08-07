# Lark Native AI Automation Identity Probe

## Current authority

The Lark Base UI contains two user-created Automations that must be reused rather than recreated:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Historical Base v3 `workflows/list` returned zero items and therefore cannot by itself prove that these UI Automations are absent.

The Bitable v1 identity authority is:

```text
Bitable v1 List automations
→ exact workflow_id/title/status
→ private exact identity authority + public SHA-256 identity
```

Official Lark documentation represents the List automations `workflow_id` as a decimal string. The first live probe on `main@98eb16d55ebccb4a353050562482cd2abfbf3d55` reached List automations successfully with HTTP 200 and then stopped locally because Repository code incorrectly required a `wkf...` prefix. No workflow definition read or Remote mutation occurred.

The corrected probe accepts bounded decimal Bitable v1 Automation IDs. It does not force those IDs through the legacy Base v3 hydration path during identity resolution. Legacy prefixed IDs retain their pre-existing exact-definition read compatibility only.

This bridge is read-only. Missing/duplicate/active/unsupported Automations fail closed and never trigger a create/update/status mutation.

## Why this is required

Weekly Executive AI Prompt v2 is already merged in Repository, but Live testing must bind to the exact existing AI Materialization Automation rather than create a replacement. The Bitable v1 List automations result is now the exact object identity authority for that later separately reviewed inactive-only phase.

No Prompt v2 Apply, Native AI call, AI Run mutation or Notification send is authorized by the identity probe itself.

## 7D controlled UAT boundary

After identity readback succeeds, the next AI-only gate is:

```text
latest available validated 7D Base evidence
→ exact existing AI Materialization Automation identity
→ separately reviewed inactive-only Prompt v2 configuration
→ one controlled Executive 7D generation
→ read back AI text
→ quality review
```

Notification remains a separate later gate. The closed runtime smoke identity is never reused.

## Safety

```text
Automation create/update/status  0 / 0 / 0
Record write                     0
Native AI call                   0
Notification send                0
Schedule                         disabled
Production                       BLOCKED
```
