# Current Task — Customer Base Full Parity v1

## Current status

```text
TASK_STATUS                         = SOURCE_REFRESH_RECORD_RECONCILIATION_CI_VERIFIED
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
VIEW_RECOVERY                       = BASE_V3_FILTER_VISIBLE_FIELDS_IMPLEMENTED
LATEST_LIVE_BLOCKER                 = MKT_ACCOUNTS_STABLE_KEY_RECORD_LAST_SYNC_AT_REFRESH
RECORD_REFRESH_RECOVERY             = STABLE_PRIMARY_BATCH_UPDATE_PLUS_GET_READBACK
FOLDER_PLACEMENT                    = COMPLETE_BY_USER
DRAFT_PR                            = 661
PRODUCTION                          = BLOCKED_PENDING_NEXT_CONTROLLED_APPLY_AND_FINAL_PARITY
```

## Objective

Finish the export-driven migration of the approved Social MKT Data Hub structure and current data into customer Base `✨Marketing Content Calendar`, while preserving all pre-existing customer resources and every migration-owned partial write already proven successful.

The existing `consolidate-lark-base.js` remains the only Table migration engine. Recovery extends only the existing resumable Target adapter and Lark parity transport; no second clone engine or destructive reset is allowed.

## Immutable Target recovery baseline

The original checkpoint is the only valid pre-write Target ownership fence:

- checkpoint file: `$HOME/Downloads/customer-base-controlled-apply-checkpoint.json`
- checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- historical Source SHA retained by checkpoint: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- protected external Table: `🎵 RAW_TikTok_Creator_Videos`
- folder placement is already complete under `Setup Phase | Social MKT Data Hub`

**Never run `--prepare-checkpoint` again.**

Do not delete/recreate the 32 migration-owned clone Tables, successful ordinary/Relation fields, Records, or Formula `📣 MKT_Ads_Campaigns.budget` (`fldA1bzPlX`).

## Current Source refresh authority

The user replaced `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base` with the latest export for 2026-08-20.

Current SHA-256:

`1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`

A refreshed Source may have a different SHA and a larger Record count, but Apply admission remains fail-closed:

- Tables = 33
- Fields = 723
- Views = 111
- Relation fields = 12
- Formula fields = 4
- Dashboards = 6
- Workflows = 2
- Advanced Permission roles = 4
- Records >= 35,528 baseline
- after excluding `🎵 RAW_TikTok_Creator_Videos`, the exact unique set of 32 clone-scope Table names must equal the checkpoint scope

Table order is not semantic. After set-equivalence succeeds, controlled Apply uses the checkpoint's retained Table-name order.

Target identity anchors `(VDO) Content Creator`, `(Graphic) Content Creator` and `คำถามจาก Sale & Support` are Target/checkpoint protection evidence, not Source refresh requirements.

## Retained automatic recovery state

### Formula

Base v3 Formula definition is the automatic write boundary. `budget` exists as `fldA1bzPlX` and its definition has been live-verified. Legacy Formula result presentation is manual/UI parity only; never retry Bitable v1 Formula presentation PUT.

### View

The previous live View blocker was legacy `updateView` HTTP 400 / Lark `1254001` on `🪪 MKT_Accounts`.

The existing parity decorator now uses documented Base v3 property operations:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
```

Each write receives immediate GET readback. Legacy combined View PATCH must not be retried.

## Latest live blocker — refreshed Record differs from retained migration state

After Source refresh admission was repaired, controlled Apply progressed into Record reconciliation and stopped on:

```text
code          CUSTOMER_BASE_RESUME_RECORD_CONFLICT
Table         🪪 MKT_Accounts
Table ID      tblVB102JoqSfgHa
primary       account_key
primary value facebook:982406442148381
field         last_sync_at
```

This proves the refreshed export is reaching the existing migration-owned Record path. The stable identity is unchanged; a current mutable Source field differs from the value retained by an earlier partial Apply.

The old resumable contract was intentionally create-only/exact-idempotent: an existing stable-key Record had to match every requested field. That remains correct for retrying the exact baseline Source, but it cannot materialize an explicitly admitted newer Source export.

## Record reconciliation ownership

Recovery now has two explicit modes.

### `exact-retry`

Used when the current Source SHA equals the checkpoint Source baseline.

- existing stable-key Record must exactly match requested Source fields;
- any difference remains `CUSTOMER_BASE_RESUME_RECORD_CONFLICT`;
- no update path is enabled.

### `source-refresh`

Enabled only by the controlled operator after the current Source has passed structural/scope admission and its SHA differs from the checkpoint baseline.

For migration-owned clone-scope Tables only:

1. resolve the existing Record by the same primary/stable key;
2. never rewrite the primary key;
3. collect only requested Source fields whose canonical values differ;
4. call the existing shared `batchUpdateRecords({ recordId, fields })` transport;
5. immediately GET/list Records again;
6. verify every updated field by stable primary key;
7. fail closed on missing/mismatching readback;
8. create only stable keys still missing from Target.

There is no delete path. Pre-existing/protected/unowned customer Tables stay behind the same checkpoint write fence.

The shared `batchCreateRecords()` public result remains its historical `{ created }` shape. `batchUpdateRecords` is required only when admitted `source-refresh` actually has existing differing Records; exact retry does not gain a new capability requirement.

## Regression coverage

Focused regression now proves:

- exact retry still rejects `last_sync_at` drift;
- source refresh updates `last_sync_at` for the same stable `account_key` without sending the primary field in the update;
- missing stable keys still use create;
- update readback mismatch fails closed;
- exact retry does not require `batchUpdateRecords`;
- source refresh requires update capability only when an update is necessary;
- controlled Apply threads `source-refresh` only through the existing resumable adapter;
- historical `batchCreateRecords()` result shape remains `{ created }`.

## Verification milestone

Compatibility-preserving record-refresh HEAD:

```text
HEAD  1c641e1e65be865ceb451261a12f29723f4a6e9a
Run   32327719737
Job   96302287010
PASS  every Branch Verification step
```

Passed:

- locked dependencies;
- syntax / architecture / hygiene;
- focused Report / Meta / Woo / Chatwoot / TikTok suites;
- Unit + Workers runtime;
- Report reliability;
- dependency audit;
- Wrangler dry-run;
- diff whitespace / diagnostics / post steps.

The preceding HEAD `92d670491a0f4e182e380719aea60cca21cc4c06` failed Unit + Workers runtime and must not be used for live Apply. Its public-contract compatibility regression was corrected before the milestone above.

## No-repeat rules

1. Never prepare a new checkpoint.
2. Never delete/recreate migration-owned Tables/Fields/Records or `fldA1bzPlX`.
3. Never retry legacy Formula presentation PUT.
4. Never retry combined legacy View filter/hidden PATCH.
5. Never require Target-only anchors in refreshed Source.
6. Never treat refreshed Table ordering as schema drift; compare exact unique names.
7. Never turn exact retry into permissive update behavior.
8. Never update a primary/stable key during Source refresh.
9. Never mutate Source, Worker, D1, Queue, schedule or deployment state in this recovery.
10. Preserve all successful phases after any later failure and resume with the same original checkpoint.

## Next controlled sequence

1. Require Branch Verification SUCCESS on the final documentation + code HEAD.
2. Pull that exact HEAD on the operator Mac.
3. Verify the original checkpoint SHA and current Source SHA.
4. Run only controlled `--apply` with the existing confirmation token.
5. Expect `source-refresh` Record reconciliation to update changed migration-owned values such as `last_sync_at`, create only missing stable keys, and GET-verify updates.
6. If Records pass, continue to the already-repaired Base v3 View phase, hierarchy, Advanced Permission and canonical verification.
7. Interpret any later blocker literally and preserve all completed state.
8. After automatic completion, finish manual Formula presentation, View layout, 6 Dashboards / 75 charts, 2 Workflows and final Target export verification.
9. Ready/Merge PR #661 only after automatic and manual parity gates close.
