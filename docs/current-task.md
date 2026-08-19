# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = FORMULA_RECOVERY_CODE_CI_VERIFIED_LIVE_VALIDATION_PENDING
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

The existing `consolidate-lark-base.js` remains the only Table migration engine. No parallel clone engine is allowed.

## Controlled Apply truth

The controlled Apply has already been executed and has partial Target writes. Therefore all older statements saying
`TARGET_MUTATION = ZERO_TO_DATE`, “Apply not yet executed”, or “prepare checkpoint next” are superseded.

Observed progress before the Formula blocker:

- original checkpoint accepted;
- 32 clone-scope Tables created/claimed by the resumable migration;
- ordinary fields progressed successfully;
- Relation field phase progressed successfully, including the prior `account_link` compatibility correction;
- Formula phase reached `📣 MKT_Ads_Campaigns.budget`;
- Record materialization has not started;
- automatic Views / hierarchy / Advanced Permission / canonical final verification are still downstream;
- the user already moved the cloned Tables under `Setup Phase | Social MKT Data Hub`.

### Checkpoint rule — immutable

The only allowed recovery baseline is the original checkpoint whose SHA-256 is
`7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`.

**Never run `--prepare-checkpoint` again.** A fresh checkpoint after partial Target mutation would incorrectly bless migration-owned partial resources as pre-existing customer state.

## Formula incident and recovery implementation

Live Target evidence invalidated the temporary Formula-shell staging assumption.

At verified HEAD `3b7ee74b55aec459300f08fb6722cfe0ae69e552`, recovery attempted to create a type-20 Formula shell without `formula_expression`. Lark rejected:

```text
code          CUSTOMER_BASE_RESUME_FORMULA_SHELL_CREATE_REMOTE_REJECTED
Lark code     99992402
Table         📣 MKT_Ads_Campaigns
Field         budget
propertyKeys  currency_code / formatter / type
```

The branch now uses the documented `formula_type=2` request semantics in the resumable adapter:

- fresh Formula creation is one direct CREATE containing the remapped `formula_expression` and `property.type`;
- Formula UI presentation keys such as Currency formatter/currency are canonicalized under `property.type.ui_property` rather than duplicated at top level for `formula_type=2`;
- fresh create is followed by GET readback and semantic comparison;
- an exact Formula already present on retry is reused without another write;
- the historical-shell recovery path remains only to safely finalize a shell if one ever exists;
- a different non-empty expression still fails closed;
- Source field objects are not mutated.

This request-shape correction is **code- and CI-verified but not yet live-confirmed**. It must not be described as the confirmed Lark root cause until the next controlled Target Apply passes the `budget` field.

### Code verification milestone

```text
CODE_HEAD     4f624207e2828b859d0e65c181d72d6a2aaa4d1e
Run           32254077830
Job           96071712121
Result        SUCCESS
```

The successful Branch Verification includes:

- locked dependency install;
- architecture/hygiene;
- focused Report / Meta / Woo / Chatwoot / staged TikTok suites;
- Unit + Workers runtime, including direct Formula create/reuse/historical-shell/conflict regressions;
- Report reliability;
- dependency audit;
- Wrangler dry-run;
- diff whitespace and diagnostics.

## Safety contract

1. Exact local export remains Source authority.
2. Every resource that existed before the original checkpoint remains immutable.
3. `🎵 RAW_TikTok_Creator_Videos` remains zero-write and outside clone traversal.
4. No customer resource delete.
5. No Source mutation.
6. No Worker/D1/Queue/schedule/deploy mutation in this recovery.
7. No guessed undocumented request payloads.
8. The same original checkpoint must be reused after every interrupted Apply.
9. PR #661 remains Draft/Open/Unmerged until automatic and manual parity close.
10. Do not remove or recreate the existing partial clone Tables/Fields.

## Next controlled sequence

1. Use the exact final CI-verified branch HEAD.
2. Verify the original checkpoint file SHA matches `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`.
3. Run **only** `node scripts/customer-base-controlled-apply.mjs --apply` with the existing confirmation token and exact Source export.
4. If `📣 MKT_Ads_Campaigns.budget` succeeds, continue from the operator's real phase result; do not assume the remainder passed.
5. Complete remaining Formulas, then 33,488 clone-scope Records, Relation record-cell remap, supported Views, hierarchy, Advanced Permission and canonical GET verification.
6. Complete retained manual View layout parity.
7. Complete Dashboard / Workflow UI parity and final Target export verification.
8. Ready/Merge PR #661 only after all parity gates pass.

Detailed Formula recovery incident record: `docs/project-brain/customer-base-formula-recovery-2026-08-19.md`.
