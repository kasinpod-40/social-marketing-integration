# Lark Dashboard Statistics Request Contract Recovery v3.3

## Incident

Live Recovery v3.2 was authorized against the reviewed `17/5/7` plan, then stopped on the first Organic Statistics Block:

```text
Dashboard          🌱 Organic Performance
Block              Baseline Coverage Rate
Block type         statistics
Lark code          1
Readback            unchanged
Statistics writes  0
Window-chart writes 0
Record updates      0
Field mutations     0
```

No Remote Lark mutation was confirmed. Retain the complete evidence directory from the failed attempt.

## Confirmed defect

The existing Organic filter rewrite cloned the Dashboard Read response and sent the resulting `filter` object back as a replacement top-level key. This could reflect response-only metadata such as `condition_id`, `field_type`, `condition_omitted` or response `type` into the Update request.

The required scope contract also named `base:block:update`; Dashboard chart Block mutation belongs to the Dashboard update authority and must declare `base:dashboard:update`.

Lark's generic `code=1` response does not prove which defect caused the rejection. The exact cause remains a hypothesis until a bounded Live Statistics request probe converges.

## v3.3 contract

- Bump the recovery contract to `lark_dashboard_field_identity_recovery_v3_3`.
- Serialize Organic Statistics filters into request shape only:
  - top-level `conjunction` and `conditions`;
  - condition `field_name`, `operator` and `value` when the operator requires it;
  - preserve reviewed business conditions;
  - remove all response-only metadata;
  - fail closed on malformed valued conditions.
- Replace obsolete Block scopes with:
  - `base:dashboard:read`;
  - `base:dashboard:update`.
- Write a private `statistics-request-plan.json` before mutation.
- Assert that every changed Statistics patch replaces only the `filter` top-level key and contains no unreviewed condition keys.
- Add `--statistics-probe-only`:
  - target exactly `Baseline Coverage Rate`;
  - patch and read back only that one Statistics Block;
  - stop before Window charts, Records and Fields;
  - emit `LARK_DASHBOARD_STATISTICS_REQUEST_PROBE_CONVERGED` only after readback convergence.
- Full Recovery remains blocked until the bounded probe passes and its evidence is reviewed.

## Preserved invariants

- Slicer PATCH count remains zero.
- Dashboard IDs, Block IDs, Block types and layouts are preserved.
- All 86 Report records are preserved.
- The 24 baseline-incomplete `current_value=null` rows remain N/A.
- No Record or Field mutation may occur during the Statistics request probe.
- `docs/current-task.md` remains untouched because it is owned by the active Meta workstream.

## Required verification

```text
Focused canonical filter tests
Focused field-identity tests
Focused window-chart tests
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

Live validation must be a bounded one-Block probe before the full resumable Recovery is considered.
