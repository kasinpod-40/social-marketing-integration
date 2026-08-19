# Customer Base Formula Recovery — 2026-08-19

## Scope

This incident record is the recovery authority for the Formula phase of PR #661 after partial customer Target writes. It supersedes all earlier Formula request-shape hypotheses and all instructions to prepare a new checkpoint.

## Immutable recovery baseline

- Source export SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- Original controlled-Apply checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- Target Base: `✨Marketing Content Calendar`
- Clone scope: 32 Tables
- Protected external Table: `🎵 RAW_TikTok_Creator_Videos`
- Folder placement: complete under `Setup Phase | Social MKT Data Hub`

Recovery rule: **reuse the original checkpoint only; never run `--prepare-checkpoint` again.**

## Retained Target progress

Before the Formula blocker, controlled Apply had already completed/advanced these migration-owned phases:

1. original checkpoint accepted;
2. 32 clone-scope Tables created/claimed;
3. ordinary fields progressed;
4. Relation fields progressed, including corrected `account_link` semantics;
5. Formula phase reached `📣 MKT_Ads_Campaigns.budget`;
6. Record materialization had not started.

Do not delete or recreate successful partial Tables/Fields. Downstream Records, relation cells, Views, hierarchy, Advanced Permission and canonical verification remain pending until later operator output proves them complete.

## Live Formula failure chronology

All live failures below were executed through the legacy Bitable v1 field-write path and stopped before Record materialization.

### 1. Full legacy Formula create

A type-20 Formula create carrying the exported Formula property set was rejected with Lark `99992402`.

### 2. Legacy shell with presentation metadata

The adapter attempted a shell without `formula_expression`, retaining currency/formatter/type metadata. Lark rejected the CREATE with `99992402`; no Formula shell was created.

### 3. Legacy direct create with `formula_expression + type`

After canonicalizing type-2 UI metadata beneath `property.type.ui_property`, the request still failed:

```text
operator code  CUSTOMER_BASE_RESUME_FORMULA_CREATE_REMOTE_REJECTED
operation      createFormulaField
propertyKeys   formula_expression / type
HTTP           400
Lark code      99992402
```

### 4. Legacy type-only shell

The smallest remaining legacy Formula shell was also rejected:

```text
operator code  CUSTOMER_BASE_RESUME_FORMULA_SHELL_CREATE_REMOTE_REJECTED
operation      createFormulaTypeOnlyShell
Table          📣 MKT_Ads_Campaigns
Field          budget
Field type     20 / Formula
propertyKeys   type
HTTP           400
Lark code      99992402
```

This fourth result rules out the prior hypothesis that top-level Formula presentation metadata or `formula_expression` alone caused the legacy CREATE rejection. It also proves that continuing to probe more Bitable v1 Formula property variants is not justified.

## Confirmed repository transport/schema defect

Repository inspection showed the shared legacy field writer still used:

```text
POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields
PUT  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id
```

with the legacy field model (`field_name`, numeric `type`, optional `ui_type`, `property`).

The current official Lark 2026 Base field-write implementation uses Base v3:

```text
POST /open-apis/base/v3/bases/:base_token/tables/:table_id/fields
PUT  /open-apis/base/v3/bases/:base_token/tables/:table_id/fields/:field_id
```

and its Formula write schema is based on:

```json
{
  "type": "formula",
  "name": "budget",
  "expression": "..."
}
```

rather than a numeric type-20 Bitable v1 mutation body.

This is a confirmed repository defect in the previous Formula transport/schema selection. Per repository rules, it is **not yet called the complete live root cause of `99992402`** until the customer Target accepts and exactly reads back the Base v3 Formula.

## Base v3 recovery implementation

The migration engine remains `consolidate-lark-base.js`; no second clone engine was created.

The existing parity decorator now owns the Formula-only Base v3 boundary while reusing the same authenticated/retried shared Lark transport:

- `createFormulaFieldV3({ tableId, field })`
- `updateFormulaFieldV3({ tableId, fieldId, field })`

The internal/export Formula contract remains unchanged so existing remap/verifier logic can remain stable. At the HTTP boundary only:

1. require legacy internal Formula type `20` and `property.formula_expression`;
2. resolve current Target Table IDs to exact Target Table names;
3. resolve current Target Field IDs to exact Target Field names;
4. translate `bitable::$table[targetTableId].$field[targetFieldId]` references:
   - same Table → `[FieldName]`;
   - another Table → `[TableName].[FieldName]`;
5. fail closed if any legacy `bitable::`, `$table[...]` or `$field[...]` token remains unresolved;
6. submit only documented Base v3 Formula fields: `type`, `name`, `expression`, and optional `description`;
7. immediately read the resulting Formula through the existing normalized `listFields()` path;
8. compare that readback against the Source-derived internal semantic Formula field.

The resumable adapter behavior is now:

- exact existing Formula → zero-write reuse;
- fresh Formula + Base v3 capability → Base v3 CREATE only; never legacy Formula CREATE fallback;
- historical recoverable shell + Base v3 capability → Base v3 PUT;
- v3 CREATE rejection → `CUSTOMER_BASE_RESUME_FORMULA_V3_CREATE_REMOTE_REJECTED` with safe diagnostics;
- v3 successful CREATE but semantic mismatch → `CUSTOMER_BASE_RESUME_FORMULA_V3_READBACK_MISMATCH`; preserve the created Formula and recover from the same original checkpoint;
- a different non-empty existing expression remains a hard conflict.

The two Base v3 mutation capabilities are also included in the same existing checkpoint write fence as other migration writes, preventing direct calls against protected or unowned Tables.

## Regression coverage

New regressions prove code behavior without claiming live Target success:

- Base v3 Formula POST endpoint and request body;
- Base v3 Formula PUT endpoint;
- current-table target-ID reference → `[FieldName]`;
- cross-table target-ID reference → `[TableName].[FieldName]`;
- unresolved target ID fails before remote write;
- resumable fresh Formula selects `createFormulaFieldV3` and never invokes legacy Formula `createField/updateField`;
- historical shell selects `updateFormulaFieldV3`;
- v3 rejection retains redacted operation/Table/Field/Lark-code diagnostics;
- existing Formula semantic comparison/reuse remains intact.

## Verified code milestone

Before the final safety/docs commits:

```text
HEAD  1660ecaa638dd17e32e15ed0dca3729b10927665
Run   32266554304
Job   96112717530
PASS  every Branch Verification step
```

Safety-only follow-up:

```text
HEAD  a09857e5bc78d69e019b333d9d899dd7cbc812bd
DIFF  prepare-lark-base-resumable-target.js +2/-0
RULE  add createFormulaFieldV3/updateFormulaFieldV3 to the existing write-method fence
```

Final documentation commits follow this milestone. A final exact-HEAD Branch Verification is required before the next customer Apply.

## No-repeat rules

- Never create a new checkpoint.
- Never delete/recreate the 32 migration-owned partial Tables.
- Never delete successful ordinary/Relation fields.
- Do not retry any previous Bitable v1 Formula payload shape.
- Do not fall back from Base v3 Formula failure to a guessed legacy request.
- Do not mutate Source, Worker, D1, Queue, schedule or deployment state in this recovery.
- Do not describe the Base v3 transport correction as the complete live root cause until `budget` passes on the customer Target.
- If Base v3 creates `budget` but readback comparison fails, preserve that Formula and diagnose the exact difference paths on the next recovery.

## Next live evidence required

Run controlled `--apply` only from the final CI-verified branch HEAD while validating the original checkpoint SHA.

Interpret the next operator result literally:

- `budget` created and exact readback passes → Formula transport hypothesis is live-confirmed for that field and the operator may proceed to remaining Formulas/downstream phases;
- `CUSTOMER_BASE_RESUME_FORMULA_V3_CREATE_REMOTE_REJECTED` → inspect the new Lark code. A permission/scope error is an external prerequisite; another `99992402` means Base v3 transport was necessary but not sufficient;
- `CUSTOMER_BASE_RESUME_FORMULA_V3_READBACK_MISMATCH` → Formula exists; do not delete it. Preserve Target state and use the reported semantic difference paths;
- any later-phase failure → retain all prior successful state and continue only from the same checkpoint.
