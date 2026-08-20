# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = SOURCE_REFRESH_ADMISSION_RECOVERY_CI_PENDING
CURRENT_PROGRAM                     = CUSTOMER_BASE_FULL_PARITY_V1
TARGET_BASE                         = ✨Marketing Content Calendar
TARGET_FOLDER                       = Setup Phase | Social MKT Data Hub
CLONE_PARITY_TABLES                 = 32
PROTECTED_EXTERNAL_TABLES           = 1
ORIGINAL_CHECKPOINT                 = PREPARED_AND_MUST_BE_REUSED
ORIGINAL_CHECKPOINT_SHA256          = 7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053
CHECKPOINT_SOURCE_BASELINE_SHA256   = c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
CURRENT_SOURCE_SHA256               = 1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7
CURRENT_SOURCE_PATH                 = /Users/wasanjantawong/Desktop/Social MKT Data Hub.base
TARGET_MUTATION                     = PARTIAL_CONTROLLED_APPLY_WRITES_PRESENT
FORMULA_DEFINITION                  = LIVE_BASE_V3_VERIFIED
FORMULA_PRESENTATION                = MANUAL_UI_PARITY
NEXT_REMOTE_PHASE                   = VIEW_BASE_V3
LATEST_LIVE_RESULT                  = SOURCE_REFRESH_FALSE_BLOCK_BEFORE_TARGET_WRITE
VIEW_RECOVERY                       = BASE_V3_FILTER_VISIBLE_FIELDS_IMPLEMENTED
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_NEXT_CONTROLLED_APPLY_AND_FINAL_PARITY
```

## Source refresh authority

The user replaced `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` with a newer export containing the latest data on 2026-08-20.

Current Source SHA-256:

`1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`

The original checkpoint remains the immutable pre-write **Target ownership fence** and must never be recreated. Its retained historical Source SHA remains:

`c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`

For `--apply`, a refreshed Source may have a different SHA and a larger Record count, but the migration structure remains fail-closed:

- Tables = 33
- Fields = 723
- Views = 111
- Relation fields = 12
- Formula fields = 4
- Dashboards = 6
- Workflows = 2
- Advanced Permission roles = 4
- Records >= 35,528 baseline
- after excluding protected external `🎵 RAW_TikTok_Creator_Videos`, the exact unique set of 32 clone-scope Table names must equal the original checkpoint scope

Table order in a refreshed export is not semantic. The name set must be exact, but reordering alone is allowed. After set-equivalence succeeds, the controlled Apply receives the original checkpoint Table-name order so its retained contract stays stable.

### Target anchors are not Source requirements

The checkpoint/Target identity anchors are:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

These identify and protect the customer Target. They must remain validated against the original checkpoint/Target fence, but they are **not** all required to exist in the refreshed Source export.

The previous refresh admission incorrectly required all four names in Source. The current Source passed every structural count/Record gate and failed only on the three Target-only names above. That was an operator admission defect, not a Source incompatibility.

The repaired refresh gate no longer references `REQUIRED_PROTECTED_TABLE_NAMES`; clone-scope names are checked independently against `checkpoint.expectedTableNames` before controlled Target mutation.

**Never run `--prepare-checkpoint` again.**

## Latest live evidence — no Target mutation

The latest operator run used Source SHA `1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7` and stopped with:

```text
code  CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_MISMATCH
message Source export is not refresh-compatible with the approved migration structure
```

The only reported mismatches were Source requirements for these Target-only anchors:

```text
(VDO) Content Creator
(Graphic) Content Creator
คำถามจาก Sale & Support
```

Because this stop occurs during local Source authority resolution, it happened before controlled Target mutation. No successful Target state from earlier runs was changed by this attempt.

## Retained successful Target state

Do not delete or recreate successful migration-owned state:

- 32 clone-scope Tables already created/claimed;
- ordinary fields progressed;
- Relation fields progressed;
- Formula definitions progressed using Base v3;
- `📣 MKT_Ads_Campaigns.budget` exists as `fldA1bzPlX` and must be reused;
- Formula result presentation is manual/UI parity only;
- controlled Apply previously reached the View phase.

## View blocker and repair

The last remote blocker before the Source file was refreshed was:

```text
operation   updateView
Table       🪪 MKT_Accounts
Table ID    tblVB102JoqSfgHa
HTTP        400
Lark code   1254001
```

The rejected path was the old combined legacy View PATCH. It must not be retried.

The existing parity decorator now owns documented Base v3 View property writes through the same authenticated/retried transport:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
```

Automatic View recovery:

- computes visible Target field IDs from live fields and Source hidden fields;
- rejects unknown Target field IDs before write;
- translates Source filters to Base v3 tuple DSL;
- preserves Boolean checkbox values;
- writes filter and visible fields separately;
- GET-verifies each property immediately after write;
- stays behind the original resumable/checkpoint fence.

Unsupported View layout dimensions remain manual parity.

## Current code milestone

Source admission fixes after the live SHA `1571cefa...` failure:

```text
5ac438745f6fec0728cd08ccf461e4780cda0969  target anchors removed from Source refresh gate
f0f259f1a2bb56e6d0e2a77d79ffe213f72eb4ff  clone-scope comparison made order-insensitive
66109d9145f90c3537a386df40abe3b4ceee10d3  regression coverage for both rules
```

Branch Verification for the latest code/test HEAD is Run `32326133414`, Job `96297655016` and must be SUCCESS before the next customer Apply.

## No-repeat rules

1. Never prepare a new checkpoint.
2. Never delete/recreate the 32 partial clone Tables.
3. Never delete/recreate `fldA1bzPlX`.
4. Never retry Bitable v1 Formula presentation PUT.
5. Never retry the combined legacy View filter/hidden PATCH.
6. Never require Target-only identity anchors to exist in refreshed Source authority.
7. Never treat refreshed export Table ordering as schema drift; compare exact unique names instead.
8. Never weaken Tables/Fields/Views/Relation/Formula/Dashboard/Workflow/Role structural gates merely to accept a newer export.
9. Never mutate Source, Worker, D1, Queue, schedule or deployment state in this recovery.

## Next controlled sequence

1. Require Branch Verification SUCCESS on the final HEAD.
2. Pull that exact HEAD on the operator Mac.
3. Verify the original checkpoint SHA remains `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`.
4. Use the current Source file at the same Desktop path; do not restore the old export.
5. Run only controlled `--apply` with the existing confirmation token.
6. Interpret the next result literally:
   - Source structural/scope mismatch → stop before Target mutation;
   - View v3 rejection/readback mismatch → retain all prior state and fix only that View contract;
   - Views pass → continue hierarchy, Advanced Permission and canonical verification;
   - automatic Apply completes → perform retained manual Formula/View/Dashboard/Workflow parity and final Target export verification.
7. Ready/Merge PR #661 only after automatic and manual parity gates close.
