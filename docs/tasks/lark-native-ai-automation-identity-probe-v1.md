# Lark Native AI Automation Identity Probe v1

## Objective

Resolve the two already-existing Lark Base UI Automations by exact title and exact immutable workflow identity before configuring Prompt v2 or running the 7D Executive AI controlled UAT.

This closes the identity gap that remained when the Base v3 Workflow List returned an empty inventory even though the two Automations were visible in the Base UI.

## Scope

Expected existing Automations:

```text
AI Materialization → MKT_AI_Report_Runs
Eligible AI Run → Lark Group Notification
```

The probe uses two existing Lark read surfaces together:

```text
GET /open-apis/bitable/v1/apps/{app_token}/workflows
→ resolve Base UI Automation workflow_id/title/status

GET /open-apis/base/v3/bases/{app_token}/workflows/{workflow_id}
→ hydrate the exact workflow definition for topology review
```

The first endpoint is deliberately different from the prior Base v3 Workflow List endpoint. No missing Automation is interpreted as authority to create a replacement.

## Fail-closed rules

- exact clean current `main` only;
- Integration Workspace only;
- exactly one Automation per approved title;
- workflow identity must be a Lark `wkf...` identity;
- both targets must be inactive/disabled/draft/off;
- any active target blocks later configuration;
- duplicate, missing, unsupported status or identity mismatch blocks;
- failure to hydrate the exact workflow blocks;
- no automatic create/update/enable/disable fallback exists.

## Evidence

Public stdout and summary retain only:

- exact Repository Head;
- title;
- normalized status;
- SHA-256 of workflow identity;
- bounded topology: step count/types and AI/message/delay/trigger presence;
- request counters and blockers.

The private mode-0600 authority file may retain the raw workflow ID so a separately reviewed later operator can bind the exact existing object. It does not retain full step configuration, prompts, Group IDs, Table IDs or message payloads.

## Read-only network boundary

Allowed:

```text
POST tenant_access_token
GET  bitable v1 List automations
GET  base v3 exact workflow definition (maximum two)
```

Everything else is blocked before fetch.

## Safety

```text
Automation create             0
Automation update             0
Automation status change      0
Record write                  0
Lark Native AI call           0
Notification send             0
Queue / D1 / Worker           0
Schedule                      disabled
Production                    BLOCKED
```

This probe does not touch Report materialization, Chatwoot closeout, Notification Runtime, Notification Admission or the closed Notification smoke identity.

## Post-merge Terminal

```bash
cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag && \
git fetch --quiet origin main && \
git switch main && \
git pull --ff-only origin main && \
CONFIRM_LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE=READ_LARK_NATIVE_AI_AUTOMATION_IDENTITIES_V1 \
node scripts/lark-native-ai-automation-identity-probe-terminal.mjs --execute
```

## Next gate

If and only if both exact targets resolve inactive and their v3 definitions hydrate successfully:

1. review the current AI Materialization definition;
2. prepare an exact inactive-only Prompt v2 configuration update against that same workflow identity;
3. never modify the Notification Automation in the AI configuration phase;
4. run one 7D Executive AI controlled UAT from the latest available validated Base Report evidence;
5. inspect generated Thai text before any Notification admission/send.
