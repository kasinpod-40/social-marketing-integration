# Lark Native AI Additive Apply

## Current authority

The Remote metadata-only inventory completed successfully on `main@f12a88e00417e76749e0f8ca9b314f7ee39e0117` against the Integration Workspace Base.

```text
Base identity SHA-256 7ad3bb5438302abcb6b198fe591abb33e142c2ed4919053d2b537961265cb56c
Inventory SHA-256     c25ac907bb7112d6dc4d712966aa1f1ce5f64ac91d01f51e486b1d7db6a7ad23
Tables                72
Target                 🧠 MKT_AI_Report_Runs
Existing fields        16
Existing views          5
Planned actions        31
Blockers                0
Remote writes           0
```

The reviewed Phase 3 operator is:

```text
scripts/lark-native-ai-additive-apply-reviewed-terminal.mjs
```

## Apply boundary

The operator is capable only of:

```text
23 Field creates
2 existing Select option extensions
6 View creates
5 exact View filter PATCH operations
```

It cannot read or write Records, create Automation, call Lark Native AI, send notifications, mutate D1/Queue/Worker/Provider or enable Production.

Execution is not implied by merge. It requires an exact clean reviewed `main`, the retained Remote inventory evidence, exact Evidence ancestry, exact Base/inventory hashes and the explicit confirmation:

```text
APPLY_LARK_NATIVE_AI_ADDITIVE_SCHEMA
```

## Replay rule

A current Target schema is accepted only when it equals the retained inventory or is a monotonic partial completion of its 31 reviewed actions. Existing fields/views must remain; no unrelated Target field, option or View may appear. Successful completion must replay to `zero_drift`.

## Remaining boundary

After additive schema Apply and zero-drift verification, prompt binding, 40-row AI Preview writes, Lark Native AI calls, Notification Log, group notification and Automation remain separate blocked phases.
