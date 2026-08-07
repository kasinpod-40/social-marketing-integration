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

Primary identity authority:

```text
GET /open-apis/bitable/v1/apps/{app_token}/workflows
→ resolve Base UI Automation workflow_id/title/status
```

The first live probe on `main@98eb16d55ebccb4a353050562482cd2abfbf3d55` proved this endpoint succeeds and returns the target title, but the local validator rejected its `workflow_id` before any definition read. Official Lark documentation shows Bitable v1 List automations returns `workflow_id` as a decimal string, not a required `wkf...` prefix.

The correction therefore accepts the documented decimal Bitable v1 Automation identity. Legacy prefixed workflow IDs remain supported only for the existing Base v3 exact-definition read path. A decimal Bitable v1 Automation identity is not forced through that legacy hydration path during the identity probe.

No missing Automation is interpreted as authority to create a replacement.

## Fail-closed rules

- exact clean current `main` only;
- Integration Workspace only;
- exactly one Automation per approved title;
- Bitable v1 Automation workflow identity must be a bounded decimal string;
- legacy `wkf...` IDs are accepted only for the pre-existing v3 definition-read compatibility path;
- both targets must be inactive/disabled/draft/off;
- any active target blocks later configuration;
- duplicate, missing, unsupported status or unsupported identity blocks;
- no automatic create/update/enable/disable fallback exists.

## Evidence

Public stdout and summary retain only:

- exact Repository Head;
- title;
- normalized status;
- SHA-256 of workflow identity;
- workflow ID format and definition source;
- bounded topology only when an exact v3 definition is actually read;
- request counters and blockers.

The private mode-0600 authority file may retain the raw workflow ID so a separately reviewed later operator can bind the exact existing object. It does not retain full step configuration, prompts, Group IDs, Table IDs or message payloads.

## Read-only network boundary

Allowed:

```text
POST tenant_access_token
GET  bitable v1 List automations
GET  base v3 exact workflow definition only for a compatible legacy prefixed identity
```

Everything else is blocked before fetch.

## Retained failed read-only attempt

```text
Head                       98eb16d55ebccb4a353050562482cd2abfbf3d55
List automations           HTTP 200
Automation list reads      1
Workflow definition reads  0
Writes                     0
AI calls                   0
Notifications              0
Schedule                   disabled
Failure                    local workflow_id format validator
```

The failed evidence directory is retained. A post-hotfix run uses a brand-new immutable attempt directory.

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

If and only if both exact targets resolve inactive:

1. retain their exact Bitable v1 Automation identities;
2. review the exact inactive AI Materialization update/read contract separately;
3. never modify the Notification Automation in the AI configuration phase;
4. run one 7D Executive AI controlled UAT from the latest available validated Base Report evidence;
5. inspect generated Thai text before any Notification admission/send.
