# Report Runtime Metric Null Repair v1

## Incident

Organic 3D refresh completed one D1 materialization and returned the Worker to all-false, but exact D1/Lark verification remained different after five fresh Lark reads over 15 seconds:

```text
Report metrics                 10
Persistent value mismatches     7
Duplicate metric keys           0
Worker active window            closed
Recovery deploy/Queue attempt   none
```

## Root cause

The Report metric output contains nullable Number fields:

- `current_value`
- `compare_value`
- `change_value`
- `change_percent`

The generic Lark serializer intentionally omits null values because most sync paths use partial updates. During a stable-key Report refresh, a metric can legitimately change from a prior number to `null`/N/A. Omitting the field preserves the prior Lark number instead of clearing the cell.

For this incident, the incomplete Organic baseline requires these six current KPI values to be null:

```text
tiktok:period_views
tiktok:period_likes
tiktok:period_comments
tiktok:period_shares
tiktok:period_engagement
tiktok:period_engagement_rate
```

The seventh mismatch is formatter precision: the Lark metric Number fields use `0.0000`, while the previous integrity check compared the unrounded D1 value to the canonical Lark value exactly.

## Repository correction

- Add a provider-neutral explicit-null update repository in the Sync Engine layer.
- Keep Create behavior unchanged: nullable fields remain omitted.
- For Update only, selected null fields are sent as explicit JSON null.
- Apply the adapter only to `MKT_Report_Metric_Values`; Snapshot, Top Content and Top Ads retain the normal repository.
- Compare D1/Lark Report metrics at the four-decimal precision declared by the Lark schema.
- Preserve D1 payload and all Business facts.

## Exact live repair

The repair operator is limited to the original Organic TikTok 3D incident. It must:

1. Verify clean current `main` and current Finalizer evidence.
2. Verify the Remote Worker remains all-false and targets the reviewed D1.
3. Validate original deploy, first-send and safe-restore evidence plus exact Report ID, job hash and config hashes.
4. Read authoritative D1 materialization and exact Lark metric rows.
5. Require exact 10-key parity and exactly the six approved stale-null current values, with no other current-value drift.
6. Backup the exact Lark metric rows to a private `0600` artifact.
7. Write an attempt file before the only Lark update.
8. Set all four nullable numeric fields from authoritative D1, including explicit null.
9. Perform bounded fresh readback until all four fields match D1 at Lark precision.
10. Never deploy a Worker, send Queue/DLQ messages, mutate D1, retry the first materialization, enable schedules/AI, or touch Production.

If the attempt already exists without a summary, rerun is verification-only and cannot write again.

After the exact null repair passes, the existing closeout recovery sends only the missing replay, proves idempotency, restores all flags false, and resumes 7D/1D/30D.

## Validation

```text
Focused explicit-null adapter tests
Focused exact null repair planner/readback tests
Recovery source-order and no-Queue/no-Deploy guards
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
Branch Verification CI
```

## Safety

Repository implementation and CI perform no Remote Lark/D1 mutation, Worker deployment, Queue/DLQ send, schedule change, secret change, provider call, Business fact deletion, or Production action.
