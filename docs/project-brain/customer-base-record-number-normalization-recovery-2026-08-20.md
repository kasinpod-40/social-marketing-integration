# Customer Base Record Number Normalization Recovery — 2026-08-20

## Scope

This incident record continues PR #661 after the admitted Source refresh progressed beyond the first mutable Record conflict and stopped during mandatory readback verification on a Number field.

## Immutable safety baseline

- Target Base: `✨Marketing Content Calendar`
- Target folder: `Setup Phase | Social MKT Data Hub`
- original checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- checkpoint Source baseline SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- current Source path: `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`
- current Source SHA-256: `1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`
- PR: `#661`

Never create a new checkpoint after partial Target writes.

## Latest live evidence

Controlled Apply stopped at:

```text
code          CUSTOMER_BASE_RESUME_RECORD_REFRESH_READBACK_MISMATCH
Table ID      tbl7rAIECdX34Ec1
primary       account_daily_key
primary value instagram:17841413521012797:2026-08-10
field         followers
```

The mandatory readback fence worked as designed. No delete/recreate recovery is allowed.

## Root cause

The local `.base` Source adapter reports `sourceRecordValueMode: normalized-to-openapi-write-values`, but its Number-cell branch previously returned the export-native `cell.value` without normalizing scalar type.

For Number fields, the export can contain a numeric string such as `"1234"`. Lark accepts the write and reads the Number cell back as numeric `1234`. The resumable adapter intentionally compares canonical values strictly, so the Source string and Lark number differ even though the numeric value is the same.

The defect is therefore in Source value normalization, not in the readback fence.

## Recovery rule

`lark-base-export-source-client.js` now normalizes field type `2` values before they reach consolidation:

- finite JavaScript numbers remain numbers;
- finite numeric strings are converted to numbers;
- null/undefined/empty Number cells become null;
- non-numeric Number values fail closed with `LARK_BASE_EXPORT_NUMBER_CELL_INVALID`;
- Text values are not coerced;
- stable primary-key identity and strict readback comparison remain unchanged.

This preserves the existing `sourceRecordValueMode: normalized-to-openapi-write-values` contract instead of weakening the resumable verifier.

## Regression

A dedicated regression uses the live failure shape:

```text
account_daily_key = instagram:17841413521012797:2026-08-10
followers         = "1234" in the local export
```

Expected Source adapter output:

```text
account_daily_key -> string
followers         -> number 1234
```

A non-numeric Number cell must fail before any remote mutation path can consume it.

## No-repeat rules

- Never run `--prepare-checkpoint` again.
- Never delete/recreate the migration-owned Record to solve this mismatch.
- Never loosen Text/stable-key equality to numeric coercion.
- Never weaken mandatory post-update readback.
- Never mutate Source, Worker, D1, Queue, schedule or deployment state for this incident.
- Preserve already successful Target writes and resume from the same original checkpoint.

## Next live evidence required

Run controlled `--apply` only from the final Branch-Verification-passing HEAD with the same original checkpoint and current Source SHA. The Number-field mismatch should converge before the existing View v3, hierarchy, Advanced Permission and canonical verification phases continue.
