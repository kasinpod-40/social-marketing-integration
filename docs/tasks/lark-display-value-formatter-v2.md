# Lark Display Value Number Formatter Hotfix v2

## Incident

The first Live `report-materialization-schema-v6` Apply planned exactly one additive `display_value` Number field and stopped with Lark `1254001 WrongRequestBody` before any mutation (`appliedActionCount=0`).

The attempted request used formatter `1,000.0000`.

## Current hypothesis

Repository contracts already use fixed four-decimal Number formatting (`0.0000`) elsewhere, while the grouped four-decimal spelling `1,000.0000` is not a reviewed formatter shape. Per `AGENTS.md`, the generic `WrongRequestBody` response alone is not sufficient to call this a confirmed root cause. The formatter mismatch remains the bounded working hypothesis until the next controlled Live Apply succeeds.

## Correction

Change only the additive `display_value` formatter from `1,000.0000` to `0.0000` and lock it with regression coverage.

Do not change schema version because the failed Apply performed zero actions.

## Safety

- failed Live Apply mutations: 0
- Report regeneration: 0
- canonical `current_value` mutation: 0
- Record create/delete: 0
- D1 / Queue / Worker / Provider: 0
- Schedule remains disabled
- Production remains blocked
- `docs/current-task.md` remains owned by the active Chatwoot workstream and is not modified here

## Post-merge controlled verification

1. synchronize clean exact merged `main`;
2. run schema Preview and require exactly one `display_value` Create Field with formatter `0.0000`;
3. run one confirmed schema Apply;
4. if Apply fails again, stop and preserve the exact zero/partial mutation count; do not assert formatter as root cause;
5. if Apply succeeds, rerun schema Preview and require zero schema drift;
6. run display-value backfill Preview, then one confirmed Record-only Apply;
7. rerun backfill Preview and require zero pending updates;
8. only after data convergence bind Dashboard money blocks to `display_value`.
