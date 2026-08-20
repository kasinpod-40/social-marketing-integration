# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = VIEW_BASE_V3_AND_SOURCE_REFRESH_RECOVERY_CI_VERIFIED
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
CLONE_PARITY_TABLES                 = 32
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = PREPARED_AND_MUST_BE_REUSED
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
TARGET_MUTATION                     = PARTIAL_CONTROLLED_APPLY_WRITES_PRESENT
FORMULA_DEFINITION                  = LIVE_BASE_V3_VERIFIED
FORMULA_PRESENTATION                = MANUAL_UI_PARITY
CURRENT_AUTOMATIC_PHASE             = VIEW
LATEST_LIVE_BLOCKER                 = UPDATE_VIEW_LEGACY_PATCH_1254001
VIEW_RECOVERY                        = BASE_V3_FILTER_VISIBLE_FIELDS_IMPLEMENTED
SOURCE_CURRENT_PATH                 = /Users/wasanjantawong/Desktop/Social MKT Data Hub.base
SOURCE_REFRESH                      = LATEST_EXPORT_REPLACES_OLD_FILE_AT_SAME_PATH
RECORD_PHASE                        = PARTIAL_APPLY_PROGRESS_EXISTS_BEFORE_VIEW_PHASE
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_NEXT_CONTROLLED_APPLY_AND_FINAL_PARITY
```

## Current Source authority model

The original checkpoint remains immutable and continues to prove Target ownership from before the first customer write.
Its retained Source baseline SHA-256 is:

`c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`

The user replaced `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` with a newer export containing today's latest data. The current export is now allowed as **refresh Source authority** without preparing a new checkpoint.

Apply admission is fail-closed:

- checkpoint SHA and Target fingerprint must remain the original approved values;
- clone-scope Table names must match the checkpoint exactly before Target mutation;
- Tables = 33;
- Fields = 723;
- Views = 111;
- Relations = 12;
- Formulas = 4;
- Dashboards = 6;
- Workflows = 2;
- Advanced Permission roles = 4;
- current Record count must be at least the original 35,528 baseline;
- the four required protected/anchor Tables must still exist;
- current Source SHA is inspected from the file itself and may differ from the checkpoint Source baseline SHA.

If any structural dimension changes, controlled Apply stops before Target mutation. This preserves the original checkpoint as a Target ownership fence while allowing non-destructive current-data refresh from the latest export.

**Never run `--prepare-checkpoint` again.**

## Retained Target progress

Controlled Apply has already created/claimed the 32 clone-scope Tables and progressed through ordinary fields, Relations and Formula definition recovery. Successful migration-owned state must be retained.

Formula live evidence now proves:

```text
Table    📣 MKT_Ads_Campaigns
Field    budget
Field ID fldA1bzPlX
```

Base v3 Formula definition succeeds and verifies. Legacy Bitable v1 Formula presentation PUT was rejected with `99992402`, so Formula automatic ownership stops at Base v3 definition. Currency/formatter/result presentation is manual/UI parity evidence and must never trigger another legacy Formula PUT.

Do not delete or recreate `fldA1bzPlX` or any successful partial Table/Field/Relation state.

## Latest live blocker — View write

The next controlled Apply advanced past Formula and reached Views, then failed:

```text
operator    CUSTOMER_BASE_RESUME_REMOTE_WRITE_REJECTED
operation   updateView
Table       🪪 MKT_Accounts
Table ID    tblVB102JoqSfgHa
HTTP        400
Lark code   1254001
```

The rejected implementation used the legacy combined View PATCH model (`property.hidden_fields` / `property.filter_info`). This failure is retained evidence only; do not rerun that exact HEAD.

## View Base v3 recovery

Official Lark Base v3 View contracts separate property writes:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
```

Current branch changes the existing parity decorator only; no second HTTP client or clone engine is introduced.

`updateView()` now:

1. uses the existing authenticated/retried transport;
2. maps Target hidden-field IDs to a Base v3 `visible_fields` object;
3. rejects unmapped hidden IDs before write;
4. translates legacy Source filter operators into Base v3 tuple DSL;
5. preserves Boolean checkbox values as booleans;
6. maps select/link membership semantics to `intersects` / `disjoint`;
7. maps numeric comparison semantics to `>`, `>=`, `<`, `<=`;
8. writes Filter and Visible Fields separately;
9. GET-verifies each Base v3 property immediately after PUT;
10. keeps all writes behind the existing resumable/checkpoint fence.

Official View layout dimensions not yet owned by this automatic phase remain manual unless separately proven by documented APIs.

## Code / CI milestone

Code HEAD before documentation-only follow-up:

```text
HEAD  382d0a6fd3f0ed600d43244b54b3d44bc755c7ac
Run   32325406976
Job   96295532732
PASS  every Branch Verification step
```

Verified gates:

- locked dependencies;
- syntax / architecture / hygiene;
- focused Report / Meta / Woo / Chatwoot / TikTok suites;
- Unit + Workers runtime, including new View v3 regressions;
- Report reliability;
- dependency audit;
- Wrangler dry-run;
- diff whitespace / diagnostics.

The View v3 regression proves:

- documented Base v3 endpoint paths;
- `visible_fields` object body;
- filter tuple conversion;
- select/scalar/comparison/empty/checkbox mappings;
- unmapped hidden field fails before write;
- readback mismatch fails closed rather than trusting PUT success.

## Safety contract

1. Original checkpoint only; never prepare another checkpoint after partial Target writes.
2. `🎵 RAW_TikTok_Creator_Videos` remains protected external reuse and zero-write.
3. No customer resource deletion.
4. No Source mutation.
5. No Worker/D1/Queue/schedule/deploy mutation in this migration recovery.
6. Never retry legacy Formula presentation PUT.
7. Never retry the rejected legacy combined View PATCH for hidden/filter parity.
8. Source refresh may change SHA/Record count only under the structural admission gate above.
9. Any changed clone-scope Table names or structural counts stop before Target mutation.
10. PR #661 remains Draft/Open/Unmerged until automatic + manual parity and final Target export verification close.

## Next controlled sequence

1. Pull only the final CI-verified branch HEAD on the operator Mac.
2. Verify the original checkpoint file SHA remains `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`.
3. Use the current `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`; do not restore the old export merely to satisfy the old SHA.
4. Run only controlled `--apply` with the existing confirmation token; do not run `--prepare-checkpoint`.
5. The operator first inspects the latest export locally and blocks before Target mutation if refresh compatibility or checkpoint scope fails.
6. If admitted, resume successful partial state and exercise Base v3 View writes.
7. Interpret the next live result literally; retain every successful prior phase.
8. After automatic Apply passes, complete Formula presentation UI parity, remaining View layout parity, Dashboard/Workflow UI parity and final Target export comparison.
9. Ready/Merge PR #661 only after all automatic/manual gates pass.

Detailed current recovery record: `docs/project-brain/customer-base-view-v3-source-refresh-2026-08-20.md`.
Historical Formula incident record: `docs/project-brain/customer-base-formula-recovery-2026-08-19.md`.
