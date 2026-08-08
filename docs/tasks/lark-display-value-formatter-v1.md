# Lark Display Value Number Formatter Hotfix v1

## Incident

The first Live Report schema v6 Apply for Dashboard `display_value` stopped before any mutation:

```text
schemaVersion       report-materialization-schema-v6
planned create      display_value / Number
formatter           1,000.0000
Lark code           1254001 WrongRequestBody
appliedActionCount  0
```

Preview itself was safe and reported one create-field action, zero conflicts, zero warnings and Dashboard Compatibility Freeze active.

## Confirmed root cause

The repository already locks the supported fixed Lark Number formatter contract to:

```text
0
0.0
0.00
0.000
0.0000
1,000
1,000.00
```

The new `display_value` field incorrectly used `1,000.0000`, which is not in that reviewed OpenAPI formatter contract. The permanent Lark field serializer preserved the unknown formatter, so Preview did not reject it and the Live Create Field request failed with `WrongRequestBody`.

## Correction

Keep Report materialization schema v6 and change only the additive `display_value` Number formatter:

```text
1,000.0000 -> 0.0000
```

This matches the existing four-decimal `display_value` rounding contract and the already-supported Lark fixed formatter. Add a schema regression that locks this exact formatter and explicitly rejects the invalid grouped four-decimal spelling.

## Safety

- failed Live Apply mutated zero fields (`appliedActionCount=0`)
- no Report regeneration
- no canonical `current_value` mutation
- no Record create/delete
- no D1/Queue/Worker/Provider action
- Schedule disabled
- Production blocked

## Post-merge sequence

1. sync clean exact merged `main`;
2. rerun `npm run setup:report-schema` and require exactly one `display_value` Create Field using formatter `0.0000`;
3. run one confirmed `setup:report-schema:apply`;
4. rerun schema Preview and require `createFields=0`;
5. run display-value backfill Preview;
6. run one confirmed Record-only display-value backfill;
7. rerun backfill Preview and require `pendingRecordUpdateCount=0`;
8. only then bind Dashboard money blocks to `display_value`.
