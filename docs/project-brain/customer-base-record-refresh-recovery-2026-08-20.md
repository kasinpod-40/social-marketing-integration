# Customer Base Record Refresh Recovery — 2026-08-20

## Scope

This incident record is the recovery authority for PR #661 after the latest local `Social MKT Data Hub.base` export was admitted as a structurally compatible Source refresh and the customer Apply reached an existing migration-owned Record whose current Source value had changed.

## Immutable safety baseline

- Target Base: `✨Marketing Content Calendar`
- Target folder: `Setup Phase | Social MKT Data Hub` — already complete
- original checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- checkpoint Source baseline SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- current Source path: `/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`
- current Source SHA-256: `1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`
- clone scope: 32 Tables
- protected external Table: `🎵 RAW_TikTok_Creator_Videos`

Never create a new checkpoint after partial Target writes.

## Latest live evidence

The latest controlled Apply passed Source-refresh admission and stopped at:

```text
code          CUSTOMER_BASE_RESUME_RECORD_CONFLICT
Table         🪪 MKT_Accounts
Table ID      tblVB102JoqSfgHa
primary       account_key
primary value facebook:982406442148381
field         last_sync_at
```

The stable primary key is unchanged. The conflict is a requested Source field whose value in the latest export differs from the migration-owned Record retained by an earlier partial Apply.

This is expected when an exact-idempotent retry mechanism is reused with a newer admitted Source snapshot: create-only recovery can prove duplicates are safe, but cannot converge mutable existing values to the new authority.

## Root cause

`prepareLarkBaseResumableTarget()` previously treated every existing stable-key Record as an exact-retry candidate only:

- same primary and all requested fields equal → reuse;
- same primary and any requested field differs → `CUSTOMER_BASE_RESUME_RECORD_CONFLICT`;
- missing primary → create.

That behavior remains correct for the exact original Source. The defect was using the same behavior after the operator had explicitly admitted a newer Source SHA as refresh authority.

## Recovery contract

The existing resumable adapter now receives an internal reconciliation mode.

### exact-retry

Default and original behavior:

- applies when current Source SHA equals checkpoint Source baseline;
- any existing requested field mismatch is a hard conflict;
- no record update capability is required or used.

### source-refresh

Enabled only when the controlled operator has already proven:

1. the original checkpoint/Target identity is unchanged;
2. the current Source structural counts satisfy the retained baseline contract;
3. Record count has not regressed below baseline;
4. the clone-scope 32 Table names are the same exact unique set;
5. current Source SHA differs from checkpoint Source SHA.

For an existing migration-owned Record with the same stable primary:

- the primary key is never included in the update;
- only requested Source fields whose canonical values differ are sent;
- the shared Lark `batchUpdateRecords` transport is reused;
- immediate Record readback verifies every updated field;
- missing/mismatching readback is a hard stop;
- stable keys not yet present are still created through the existing batch-create path.

No delete/recreate path is introduced.

## Transport reuse

The existing `LarkBitableClient.batchUpdateRecords()` already owns the production transport:

```text
POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/batch_update
```

Internal input remains:

```json
{
  "recordId": "...",
  "fields": {
    "last_sync_at": "..."
  }
}
```

The shared client serializes it to Lark `record_id` + `fields`, preserves bounded chunks, `beforeChunk` guards and partial-write progress semantics. No new connector or raw HTTP writer was added.

## Compatibility correction

An initial implementation at HEAD `92d670491a0f4e182e380719aea60cca21cc4c06` failed Unit + Workers runtime in Branch Verification Run `32327093672`, Job `96300470359`.

That HEAD is forbidden for live use.

The follow-up preserves historical contracts:

- `batchCreateRecords()` still returns `{ created }`;
- exact retry does not require a `batchUpdateRecords` method;
- update capability is checked only when admitted Source refresh actually has an existing differing Record;
- the resumable checkpoint diagnostic shape remains unchanged;
- the shared consolidation engine remains unchanged.

## Regression coverage

New regression proves:

- exact retry still fails on `last_sync_at` mismatch;
- source refresh updates only `last_sync_at` for `facebook:982406442148381` and omits `account_key` from the update fields;
- a missing stable key is created normally;
- exact retry remains compatible with a client that lacks `batchUpdateRecords`;
- source refresh fails explicitly if an update is needed but the capability is unavailable;
- a successful update with stale readback fails closed;
- the controlled Apply threads the mode through the existing resumable adapter.

## Verified code milestone

```text
HEAD  1c641e1e65be865ceb451261a12f29723f4a6e9a
Run   32327719737
Job   96302287010
PASS  all Branch Verification steps
```

This milestone passed architecture/hygiene, focused suites, Unit + Workers runtime, report reliability, dependency audit, Wrangler dry-run and diff/diagnostic steps.

## Retained downstream recovery

The View recovery remains unchanged and must be exercised only after Record refresh converges:

- Base v3 `visible_fields`
- Base v3 `filter`
- immediate GET readback
- no legacy combined View PATCH

Formula remains Base v3 definition-only automatic parity; result presentation remains manual/UI parity.

## No-repeat rules

- Never run `--prepare-checkpoint` again.
- Never delete/recreate migration-owned partial resources to solve current-data drift.
- Never weaken the stable primary-key identity requirement.
- Never enable record refresh for exact-baseline retries.
- Never update pre-existing/protected/unowned customer Tables through this path.
- Never mutate Source, Worker, D1, Queue, schedule or deployment state.
- Preserve any successful record updates/creates if a later View, Permission or canonical gate fails.

## Next live evidence required

Run controlled `--apply` from the final CI-verified branch HEAD with the same original checkpoint and current Source SHA.

Expected sequence:

1. Source refresh admission passes;
2. migration-owned stable-key Records with current-value drift are updated and read back;
3. missing stable keys are created;
4. consolidation progresses to the Base v3 View recovery;
5. later phases remain fail-closed and resumable from the same checkpoint.
