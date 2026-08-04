# Lark Native AI Nullable Payload Checksum v5

## Objective

Close the artificial `LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN` blocker without introducing AnyCross, HTTP Request, a custom Worker, Webhook, external provider or a false checksum.

## Proven product boundary

The inspected Lark Base Automation action list does not expose a native Hash/SHA-256 action. Lark AnyCross documents a separate Crypto Helper that supports SHA256, but AnyCross is outside the locked Base Automation architecture and is not introduced by this task.

## Corrected checksum policy

The Notification Log field `payload_checksum` remains present but nullable.

```text
Repository preview:
  SHA-256 over the canonical redacted payload
  evidence / contract validation only

Live Lark Base Automation:
  payload_checksum = null
  status = not_computed_in_lark_base_automation
```

No surrogate value is written into `payload_checksum`. In particular, `dedupe_key` is not mislabeled as a payload hash.

## Dedupe authority

Exactly-once send protection does not depend on the optional payload checksum. It remains:

```text
notification_attempt_key = ai_run_key :: dedupe_key
find Notification Log where notification_attempt_key matches exactly
require existing record count = 0 before send
sent_to_group must be false before send
```

The existing `dedupe_key` remains a required 64-character SHA-256 identity. The destination remains hash-only in evidence.

## Preview v5

```text
contractVersion  lark_native_ai_disabled_configuration_preview_v5
status           repository_preview_ready_for_manual_inactive_configuration
blockerCount     0
advisoryCount    2
```

Advisories:

```text
LARK_NATIVE_PAYLOAD_SHA256_NOT_AVAILABLE_NON_BLOCKING
UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED
```

## Safety

```text
Live configuration authorized  false
Activation authorized          false
Remote Lark read/write          0 / 0
Workflow create/update          0 / 0
Workflow status change          0
Native AI call                  0
Record write                    0
Notification send               0
Schedule                        disabled
Production                      BLOCKED
```

The two existing Base Automations remain inactive. This task prepares the exact manual disabled configuration only; it does not authorize Save, Test Results, activation or message sending.

## Verification

```bash
npm ci
npm run check
node --test tests/application/lark-native-ai-disabled-configuration-preview.test.js
node --test tests/scripts/lark-native-ai-disabled-configuration-preview.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```
