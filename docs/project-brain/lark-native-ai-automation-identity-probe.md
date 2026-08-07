# Lark Native AI Automation Identity Probe

## Current authority

The Lark Base UI contains two user-created Automations that must be reused rather than recreated:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

Historical Base v3 `workflows/list` returned zero items and therefore cannot by itself prove that these UI Automations are absent.

The reviewed identity bridge is:

```text
Bitable v1 List automations
→ exact workflow_id/title/status
→ Base v3 GET exact workflow_id
→ sanitized topology + private exact identity authority
```

This bridge is read-only. Missing/duplicate/active/unsupported Automations fail closed and never trigger a create/update/status mutation.

## Why this is required

Weekly Executive AI Prompt v2 is already merged in Repository, but Live testing must update the exact existing AI Materialization Automation. A workflow update has full-definition semantics, so its current exact identity and definition must be read before a later inactive-only update can be reviewed.

No Prompt v2 Apply, Native AI call, AI Run mutation or Notification send is authorized by the identity probe itself.

## 7D controlled UAT boundary

After identity readback succeeds, the next AI-only gate is:

```text
latest available validated 7D Base evidence
→ exact existing AI Materialization Automation
→ Prompt v2 configured while inactive
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
