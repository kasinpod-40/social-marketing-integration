# Chatwoot Final UAT Secret Staging Hotfix

## Incident

The guarded Final UAT stopped during the read-only Worker Secret-name preflight:

```text
CHATWOOT_FINAL_UAT_SECRET_MISSING
missing = CHATWOOT_API_ACCESS_TOKEN
safeRestore = NOT_REQUIRED
production = BLOCKED
```

The failure occurred before D1 backup, temporary Active deployment, Queue send, Chatwoot Provider request and D1/Lark Business writes. No recovery mutation is required.

## Root cause

The runtime correctly requires `CHATWOOT_API_ACCESS_TOKEN`, but the Integration Workspace Worker did not yet contain that Secret. The private local `.dev.vars` remains the approved Development credential source; the Final UAT launcher did not have a guarded path to stage the value into the Worker.

The legacy name `CHATWOOT_API_TOKEN` is not accepted because the current runtime reads only `CHATWOOT_API_ACCESS_TOKEN`.

## Corrected execution contract

When the remote Secret already exists, the launcher performs no Secret mutation and does not read the local value.

When only `CHATWOOT_API_ACCESS_TOKEN` is missing:

1. Require existing `LARK_APP_ID` and `LARK_APP_SECRET` Worker Secrets.
2. Require a non-placeholder `CHATWOOT_API_ACCESS_TOKEN` in private local `.dev.vars`/Environment.
3. Prove the exact Shared Chatwoot lock scope is idle.
4. Persist a value-free attempt marker before mutation.
5. Create an ephemeral mode-0600 JSON secrets file containing only the Chatwoot Secret.
6. Deploy the already normalized all-flags-false Worker bundle with `--secrets-file`.
7. Delete the ephemeral secrets file in `finally`.
8. Verify the required three remote Secret names and the active all-flags-false version.
9. Continue through the existing inner Final UAT operator.

The safe bootstrap deployment does not send Queue messages, call the Chatwoot Provider, write D1/Lark Business facts, enable Schedule/Webhook or touch Production. Existing Worker Secrets not included in the private file remain preserved by Wrangler deployment semantics.

## Safety requirements

```text
Secret value in Git / docs / logs / evidence       forbidden
Secret value in command arguments                   forbidden
Secret value in persistent generated config         forbidden
Secret value in ephemeral file                      allowed / mode 0600 / deleted in finally
Bootstrap Worker execution flags                    all false
Schedule / Webhook                                  false / false
Queue message / Provider request / Business write   0 / 0 / 0
Production                                          blocked
```

An existing attempt marker plus an absent remote Secret is classified as uncertain and blocks blind repetition.

## Verification

```bash
npm ci
npm run check
node --test \
  tests/application/chatwoot-final-secret-bootstrap.test.js \
  tests/application/chatwoot-final-30d-daily-uat.test.js \
  tests/application/chatwoot-final-lock-scope.test.js \
  tests/application/chatwoot-runtime-wiring.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

`docs/current-task.md` remains owned by the concurrent Meta workstream and is unchanged.
