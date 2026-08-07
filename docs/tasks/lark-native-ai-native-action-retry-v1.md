# Lark Native AI Weekly 7D Native Action Retry v1

## Incident

The compact weekly Executive UAT evidence now fits the reviewed Lark AI input budget, but the first retry still used the legacy `AI-generated text (GPT model)` Automation action and failed with `Unable to generate. Please check if the API key is valid.`

The Lark UI exposes a separate native `AI-generated text` action that does not present the external GPT model/API-key selector. The Automation is being switched manually in Lark because the repository does not own that UI mutation.

## Controlled retry

After the operator confirms the four AI actions were changed to native `AI-generated text` and the Automation was saved/activated, run the one-shot retry operator.

The operator:

- requires clean exact current `main`;
- verifies the exact AI Materialization Automation is active;
- verifies the exact Notification Automation remains inactive;
- resolves exactly one pending weekly Executive 7D UAT row;
- requires `failure_code=CONTROLLED_UAT_RETRY_COMPACT_V1` from the prior compact retry;
- verifies `promptShape=lark_ai_compact_v1`, all nine channels, and the existing 2800/700 character budgets;
- does not modify either evidence field;
- writes only `failure_code=CONTROLLED_UAT_NATIVE_AI_RETRY_V2` once to trigger the reviewed record-update path;
- observes the same AI Run until generated, failed, or timeout.

## Safety

```text
Report materialization      0
Evidence rewrite            0
Remote D1                   0
Queue                       0
Worker deployment           0
Notification Automation     must remain inactive
Notification count          0
Schedule                    disabled
Production                  BLOCKED
Record writes               exactly 1 maximum
```
