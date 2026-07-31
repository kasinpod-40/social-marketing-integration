# Chatwoot Final Secret Staging Hotfix — 2026-07-31

## Retained incident

The guarded Chatwoot Final UAT stopped at the read-only Worker Secret-name gate:

```text
code         CHATWOOT_FINAL_UAT_SECRET_MISSING
missing      CHATWOOT_API_ACCESS_TOKEN
safeRestore  NOT_REQUIRED
production   BLOCKED
```

The attempt performed no D1 backup, temporary Active deployment, Queue send, Chatwoot Provider request, D1/Lark Business write, Schedule/Webhook activation or Production action.

## Runtime authority

The Shared Chatwoot runtime reads `CHATWOOT_API_ACCESS_TOKEN`. The legacy name `CHATWOOT_API_TOKEN` is not a valid fallback for this Final UAT.

The private local `.dev.vars` remains the approved Development credential source. Repository files, public evidence and logs must never contain the token value.

## Recovery design

The public Final UAT launcher now performs a guarded Secret bootstrap only when the exact remote Secret is absent:

```text
exact clean current main
→ local private environment read
→ reviewed Lark and Queue discovery
→ exact Chatwoot lock scope = 0
→ current Worker exactly one 100% active version
→ current Worker execution flags all false
→ required existing Lark Secret names present
→ value-free attempt marker
→ ephemeral mode-0600 secrets JSON
→ all-flags-false Worker deploy with --secrets-file
→ ephemeral file deletion in finally
→ required three Secret names verified
→ active Worker execution flags all false
→ existing Chatwoot Final UAT operator
```

When the remote Chatwoot Secret already exists, the launcher does not read the local token and performs zero bootstrap mutations.

## Fail-closed boundaries

- Missing or placeholder local token fails before deployment.
- Missing Lark Worker Secrets fail before deployment.
- Any enabled execution flag in the generated Safe config fails before deployment.
- Any enabled execution flag in the active Worker fails before deployment and after bootstrap.
- A prior attempt marker plus an absent remote Secret blocks blind repetition.
- The token is removed from the Wrangler child environment and supplied only through the ephemeral private file.
- No Queue submission, Provider call or Business write is owned by the bootstrap path.
- Schedule, Webhook and Production remain false/false/blocked.

## Expected live closeout

Live completion is not declared until the single public Terminal entrypoint emits:

```text
marker                          CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
chatwootWorkerSecretVerified    true
exactLockScopeVerified          true
activeLockCount                 0
scheduleEnabled                 false
webhookEnabled                  false
production                      false
```

`docs/current-task.md` remains owned by the concurrent Meta workstream and is intentionally unchanged.
