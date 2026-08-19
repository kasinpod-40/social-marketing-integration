# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = FORMULA_BASE_V3_RECOVERY_FINAL_CI_VERIFIED_LIVE_VALIDATION_PENDING
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
SOURCE_AUTHORITY                    = LOCAL_LARK_BASE_EXPORT
SOURCE_EXPORT_SHA256                = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
CLONE_PARITY_TABLES                 = 32
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = PREPARED_AND_MUST_BE_REUSED
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
TARGET_MUTATION                     = PARTIAL_CONTROLLED_APPLY_WRITES_PRESENT
CURRENT_AUTOMATIC_PHASE             = FORMULA
CURRENT_BLOCKER                     = 📣 MKT_Ads_Campaigns.budget
LATEST_LIVE_BLOCKER                 = LEGACY_BITABLE_V1_FORMULA_TYPE_ONLY_CREATE_REJECTED_99992402
FORMULA_V3_LIVE_VALIDATION          = NOT_YET_EXECUTED
RECORD_PHASE                        = NOT_STARTED
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_LIVE_RECOVERY_AND_PARITY
```

## Authority and scope

The approved Source authority remains the exact local export with SHA-256
`c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`:

- 33 Tables / 723 Fields / 35,528 Records / 111 Views
- 12 Relations / 4 Formulas / 6 Dashboards / 2 Workflows / 4 Advanced Permission roles
- clone scope = 32 Tables / 705 Fields / 33,488 Records / 110 Views
- `🎵 RAW_TikTok_Creator_Videos` remains immutable `protected_external_reuse`

`consolidate-lark-base.js` remains the only Table migration engine. The Base v3 Formula repair extends the existing parity transport/decorator and resumable adapter; it does not create another clone engine or change the Source authority.

## Controlled Apply truth

The controlled Apply has already run and the Target contains migration-owned partial state. Any older statement saying Target mutation is zero, Apply has not run, or a checkpoint should be prepared next is superseded.

Observed progress before the current Formula blocker:

- original checkpoint accepted;
- 32 clone-scope Tables created/claimed;
- ordinary fields progressed successfully;
- Relation fields progressed successfully, including `account_link` compatibility;
- Formula phase reached `📣 MKT_Ads_Campaigns.budget`;
- Record materialization has not started;
- relation record-cell remap, supported Views, hierarchy, Advanced Permission and canonical verification remain downstream;
- cloned Tables are already under `Setup Phase | Social MKT Data Hub`.

### Checkpoint rule — immutable

The only allowed recovery baseline is the original checkpoint whose SHA-256 is
`7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`.

**Never run `--prepare-checkpoint` again.** A new baseline after partial Target writes would incorrectly reclassify migration-owned resources as pre-existing customer state.

## Formula incident — live evidence

All live failures so far occurred through the legacy Bitable v1 field-write model. `📣 MKT_Ads_Campaigns.budget` was rejected with Lark code `99992402` under progressively reduced legacy request shapes:

1. full exported Formula property set;
2. shell without `formula_expression` but with currency / formatter / type metadata;
3. direct create with `formula_expression + type`;
4. type-only shell with `propertyKeys = ["type"]`.

The latest live result is:

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

No Formula field was created by that rejected request. Existing successful Tables, ordinary fields and Relations must be retained.

## Confirmed repository defect and current repair

Repository inspection confirmed that the shared `createField()` / `updateField()` path still writes legacy numeric field contracts through:

```text
POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields
PUT  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/fields/:field_id
```

The current official Base field-write contract used by Lark's 2026 CLI uses Base v3:

```text
POST /open-apis/base/v3/bases/:base_token/tables/:table_id/fields
PUT  /open-apis/base/v3/bases/:base_token/tables/:table_id/fields/:field_id
```

For Formula fields that contract uses `type: "formula"`, `name` and `expression` rather than the legacy numeric `type: 20` / `field_name` / `ui_type` / `property` request shape.

The branch now keeps the existing internal/export Formula contract unchanged and converts only at the Lark HTTP boundary:

- the existing parity decorator exposes migration-only `createFormulaFieldV3()` and `updateFormulaFieldV3()` on the shared authenticated/retried transport;
- legacy internal target-ID references such as `bitable::$table[targetTableId].$field[targetFieldId]` are resolved from current Target metadata and translated to Base v3 name syntax;
- current-table references become `[FieldName]`;
- cross-table references become `[TableName].[FieldName]`;
- unresolved legacy `$table` / `$field` references fail closed before a write;
- fresh Formula recovery uses Base v3 create directly and never falls back to legacy Formula create when the v3 capability exists;
- historical Formula shells, if present, are finalized through Base v3 PUT;
- immediate readback continues through the existing normalized `listFields()` contract and must semantically match the Source-derived internal Formula field;
- direct Base v3 Formula methods are covered by the same checkpoint write fence as other Target mutation methods;
- ordinary fields, Relations, Records, Views, permissions and checkpoint logic retain their existing transports/contracts.

This confirms a repository transport/schema defect in the previous Formula write path. It does **not** yet prove that this defect is the complete live root cause of Lark `99992402`; that statement requires the next controlled Base v3 Target recovery to pass `budget`.

## Verification milestones

Base v3 Formula implementation milestone:

```text
CODE_HEAD     1660ecaa638dd17e32e15ed0dca3729b10927665
Run           32266554304
Job           96112717530
Result        SUCCESS — all Branch Verification steps
```

Safety + repository-truth milestone:

```text
VERIFIED_HEAD 627df1fae25adb0ff31fa54f9036c8b36c700db2
Run           32267549092
Job           96115748843
Result        SUCCESS — all Branch Verification steps
```

The safety commit adds `createFormulaFieldV3/updateFormulaFieldV3` to the existing checkpoint write-method fence. The subsequent documentation commits align current-task, Project Brain and CHANGELOG with the actual partial Target state and recovery rules.

Regression coverage includes:

- Base v3 Formula POST path and documented body shape;
- Base v3 Formula PUT path;
- current-table target-ID → `[FieldName]` translation;
- cross-table target-ID → `[TableName].[FieldName]` translation;
- unresolved reference fail-closed before remote mutation;
- resumable fresh Formula chooses v3 capability and never invokes legacy Formula create/update;
- historical shell recovery chooses v3 update;
- safe redacted v3 rejection diagnostics;
- Source/internal Formula object remains the semantic comparison authority.

## Safety contract

1. Exact local export remains Source authority.
2. Every Table/Role that existed before the original checkpoint remains immutable.
3. `🎵 RAW_TikTok_Creator_Videos` remains zero-write and outside clone traversal.
4. No customer resource delete.
5. No Source mutation.
6. No Worker/D1/Queue/schedule/deploy mutation in this recovery.
7. No undocumented Formula payload probing or fallback to another guessed v1 request shape.
8. The same original checkpoint must be reused after every interrupted Apply.
9. PR #661 remains Draft/Open/Unmerged until automatic and manual parity close.
10. Do not remove/recreate the 32 partial clone Tables or already-successful Fields.
11. If Base v3 Formula create succeeds but semantic readback fails, preserve the created Formula and diagnose the exact readback difference on the next recovery; do not delete it or create a new checkpoint.

## Next controlled sequence

1. Pull only the final CI-verified branch HEAD on the operator Mac.
2. Verify the original checkpoint SHA remains `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`.
3. Run **only** `node scripts/customer-base-controlled-apply.mjs --apply` with the existing confirmation token and exact Source export.
4. Interpret the real live result without guessing:
   - Base v3 Formula create + exact readback passes → continue remaining Formulas and downstream phases;
   - `CUSTOMER_BASE_RESUME_FORMULA_V3_CREATE_REMOTE_REJECTED` → inspect the returned Lark code/scope/contract evidence; do not fall back to v1;
   - `CUSTOMER_BASE_RESUME_FORMULA_V3_READBACK_MISMATCH` → preserve the newly created Formula and use the reported difference paths for recovery;
   - another `99992402` from the Base v3 path → the transport correction was necessary but not sufficient; stop and diagnose from that new evidence.
5. After Formulas: materialize 33,488 clone-scope Records, relation record-cell remap, supported Views, hierarchy, Advanced Permission and canonical GET verification.
6. Complete retained manual View layout parity, Dashboard / Workflow UI parity and final Target export verification.
7. Ready/Merge PR #661 only after all parity gates pass.

Detailed incident record: `docs/project-brain/customer-base-formula-recovery-2026-08-19.md`.
