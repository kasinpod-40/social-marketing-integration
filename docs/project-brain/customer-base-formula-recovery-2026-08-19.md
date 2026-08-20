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

The live Base v3 recovery subsequently established an existing migration-owned Formula:

```text
Table    📣 MKT_Ads_Campaigns
Field    budget
Field ID fldA1bzPlX
```

Do not delete or recreate successful partial Tables/Fields or `fldA1bzPlX`. Downstream Records, relation cells, Views, hierarchy, Advanced Permission and canonical verification remain pending until later operator output proves them complete.

## Live Formula failure chronology

### 1. Full legacy Formula create

A type-20 Formula create carrying the exported Formula property set through Bitable v1 was rejected with Lark `99992402`.

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

This fourth result ruled out further Bitable v1 Formula CREATE payload probing.

### 5. Base v3 definition accepted; legacy presentation PUT rejected

A later controlled recovery used Base v3 Formula definition semantics and successfully retained/reused `budget` as `fldA1bzPlX`. The operator advanced past Formula definition validation and failed only when it attempted to mutate legacy result-presentation metadata through Bitable v1:

```text
operator code  CUSTOMER_BASE_FORMULA_PRESENTATION_UPDATE_REJECTED
Table          📣 MKT_Ads_Campaigns
Table ID       tbl32Hfkfd4HjvFr
Field          budget
Field ID       fldA1bzPlX
HTTP           400
Lark code      99992402
```

Reported presentation differences were limited to:

```text
$.property.type.data_type
$.property.type.ui_property.currency_code
$.property.type.ui_property.formatter
```

This is the decisive live evidence: **Base v3 Formula definition is the correct automatic write boundary; the legacy Formula result-presentation PUT is not a supported automatic mutation path for this customer Base.**

## Confirmed transport and ownership model

The old shared field writer used legacy Bitable v1 field writes:

```text
POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields
PUT  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id
```

Current Base v3 Formula definition writes use:

```text
POST /open-apis/base/v3/bases/:base_token/tables/:table_id/fields
PUT  /open-apis/base/v3/bases/:base_token/tables/:table_id/fields/:field_id
```

with the modern Formula definition shape:

```json
{
  "type": "formula",
  "name": "budget",
  "expression": "..."
}
```

The current official Base v3 field schema exposes Formula definition (`type`, `name`, `expression`, optional common description) but no Formula result-style supplement comparable to the legacy export's `property.type`/currency/formatter metadata.

Therefore ownership is frozen as follows:

- **automatic hard gate:** Formula identity + expression/definition through Base v3;
- **manual/UI parity evidence:** legacy Formula result presentation such as result data type, Currency, currency code, formatter and related UI metadata;
- **forbidden automatic fallback:** Bitable v1 Formula CREATE/PUT payload probing.

The original checkpoint remains valid because it freezes Target resource ownership; moving Formula presentation from automatic to manual ownership does not create or adopt any new Target resource.

## Base v3 recovery implementation

The migration engine remains `consolidate-lark-base.js`; no second clone engine was created.

The existing shared/parity path owns the Formula-only Base v3 boundary while reusing the same authenticated/retried transport:

- `createFormulaFieldV3({ tableId, field })`
- `updateFormulaFieldV3({ tableId, fieldId, field })`
- `verifyFormulaFieldV3Definition({ tableId, fieldId, field })`

At the Base v3 HTTP boundary:

1. require internal Formula type `20` and `property.formula_expression`;
2. resolve current Target Table IDs to exact Target Table names;
3. resolve current Target Field IDs to exact Target Field names;
4. translate legacy target-ID references to modern Formula field/table references;
5. fail closed if a legacy unresolved table/field token remains;
6. submit only documented Base v3 Formula definition fields;
7. immediately verify Formula definition readback.

Controlled recovery behavior is now:

- exact existing Formula definition → zero-write reuse;
- missing Formula definition → Base v3 CREATE;
- recoverable historical shell → Base v3 PUT;
- Base v3 definition mismatch → hard fail;
- Formula result-presentation mismatch → retain as explicit manual/UI parity evidence, **no automatic Formula presentation PUT**;
- Source Formula automatic admission requires an expression only; legacy `property.type` is not required for Base v3 definition parity.

The Base v3 mutation capabilities remain inside the existing checkpoint write fence, preventing direct calls against protected or unowned Tables.

## Canonical verifier ownership

Canonical verification continues to fail closed on Formula definition/expression drift after Source→Target Table/Field ID remap.

Legacy Formula result-presentation differences no longer make automatic canonical verification fail. They are reported separately under Formula manual parity evidence, including the exact Table, Field, Target `formula_type`, difference paths and Source/Target presentation snapshots.

This is not a silent ignore: automatic definition correctness and manual presentation correctness remain separately observable.

## Regression coverage

Regression coverage now proves:

- Base v3 Formula POST/PUT endpoints and modern definition body;
- current-table and cross-table Formula reference conversion;
- unresolved IDs fail before remote write;
- existing exact Formula definition is reused without duplicate creation;
- Base v3 definition mismatch remains a hard failure;
- automatic controlled Apply never invokes legacy `updateField()` merely to reconcile Formula presentation;
- Target `formula_type=2` does not require Source legacy `property.type` for automatic Formula definition;
- Formula presentation drift is emitted as manual parity evidence;
- non-Formula field, Relation, Record and View canonical drift remain hard failures.

## Verified milestones

Earlier Base v3 implementation milestone:

```text
HEAD  1660ecaa638dd17e32e15ed0dca3729b10927665
Run   32266554304
Job   96112717530
PASS  every Branch Verification step
```

Pre-live presentation-reconciliation milestone:

```text
HEAD  48d8f2c798df577d6d855ba52a06384677800e5e
Run   32319484689
Job   96278639550
PASS  every Branch Verification step
```

That HEAD produced the live `CUSTOMER_BASE_FORMULA_PRESENTATION_UPDATE_REJECTED` evidence above and must not be rerun unchanged.

Automatic/manual Formula ownership correction milestone:

```text
HEAD  fb71cb38242d37b6eef70c91de4676c6a1507434
Run   32321387600
Job   96284132980
PASS  every Branch Verification step
```

A subsequent cleanup removes the stale automatic `property.type` requirement and is subject to the final Branch Verification before the next customer Apply.

## No-repeat rules

- Never create a new checkpoint.
- Never delete/recreate the 32 migration-owned partial Tables.
- Never delete/recreate `fldA1bzPlX`.
- Never delete successful ordinary/Relation fields.
- Do not retry any previous Bitable v1 Formula CREATE payload shape.
- Do not use Bitable v1 Formula PUT to reconcile result presentation.
- Do not fall back from Base v3 Formula definition failure to a guessed legacy request.
- Do not mutate Source, Worker, D1, Queue, schedule or deployment state in this recovery.
- Formula definition mismatch is always a hard stop; presentation drift is retained for manual/UI closure.

## Next live evidence required

Run controlled `--apply` only from the final CI-verified branch HEAD while validating the original checkpoint SHA.

Interpret the next operator result literally:

- `budget` definition verifies again → reuse `fldA1bzPlX` with zero Formula presentation write and continue to remaining Formulas/downstream phases;
- a later Base v3 Formula definition rejection/mismatch → preserve all existing Formula fields and diagnose only that field;
- Record/Relation-cell/View/Permission/canonical failure → retain all prior successful state and continue only from the same checkpoint;
- automatic Apply completes → use `canonicalVerification.manualParity.formulaPresentation` as the exact UI Formula-presentation closure manifest, then proceed with retained manual View/Dashboard/Workflow parity.
