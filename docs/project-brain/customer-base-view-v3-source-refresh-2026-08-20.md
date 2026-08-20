# Customer Base View v3 + Source Refresh Recovery — 2026-08-20

## Scope

Current recovery authority for PR #661 after:

1. Formula definition succeeded through Base v3;
2. controlled Apply reached View parity and legacy View PATCH failed with `1254001`;
3. the local Source export was replaced in place with the latest 2026-08-20 data;
4. refreshed Source admission exposed a false Target-anchor requirement before any new Target write.

## Immutable Target recovery baseline

- Target Base: `✨Marketing Content Calendar`
- Original checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- Historical checkpoint Source SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- clone scope: 32 Tables
- protected external Table: `🎵 RAW_TikTok_Creator_Videos`
- folder placement: complete under `Setup Phase | Social MKT Data Hub`

The checkpoint is a pre-write Target ownership fence. Never recreate it after partial Target writes.

## Retained successful Target state

Preserve all migration-owned partial state:

- 32 clone-scope Tables created/claimed;
- ordinary fields progressed;
- Relations progressed;
- Formula definitions progressed through Base v3;
- `📣 MKT_Ads_Campaigns.budget` exists as `fldA1bzPlX` and must not be deleted/recreated;
- Formula result-presentation metadata is manual/UI parity only;
- controlled Apply previously reached Views.

No destructive rollback is allowed.

## View live failure and Base v3 repair

Retained live failure:

```text
code       CUSTOMER_BASE_RESUME_REMOTE_WRITE_REJECTED
operation  updateView
Table      🪪 MKT_Accounts
Table ID   tblVB102JoqSfgHa
HTTP       400
Lark code  1254001
```

The failed path used a legacy combined Bitable v1 View PATCH for hidden fields / filters. Do not retry it.

Documented Base v3 property endpoints used by the current repair:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
GET /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
GET /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

`withLarkBaseParityCapabilities()` now overrides `updateView()` only at the existing HTTP boundary. It reuses the same authenticated/retried client; no second clone engine or HTTP client exists.

Automatic View behavior:

- validate Target hidden IDs against live Target fields;
- calculate `visible_fields` from Target field IDs;
- convert Source filter conjunction to Base v3 `logic`;
- map supported equality/membership/numeric/empty operators to Base v3 tuple DSL;
- preserve Boolean checkbox values;
- issue filter and visible-field writes separately;
- immediately GET-verify each property;
- remain behind the existing resumable/checkpoint mutation fence.

Unsupported layout dimensions remain manual parity.

## Current Source export

The Source file at:

`/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`

was replaced with the latest export. Current observed SHA-256:

`1571cefabb3b881dceeb71ccc2c6e879ad0c912b58072a7549825022704d80b7`

Path/name equality no longer implies the historical SHA.

## Source refresh admission contract

The current export may be used by `--apply` without a new checkpoint only when structural migration dimensions remain compatible:

```text
Tables                    33
Fields                    723
Views                     111
Relation fields           12
Formula fields            4
Dashboards                6
Workflows                 2
Advanced Permission roles 4
Records                    >= 35,528 baseline
```

After excluding `🎵 RAW_TikTok_Creator_Videos`, the exact unique set of 32 clone-scope Table names must equal the checkpoint scope. Export ordering alone is not schema drift. Once the name sets match, the Apply receives the checkpoint's original Table-name order.

This separates two authorities correctly:

- **Target ownership authority** — the immutable original checkpoint;
- **current Source data authority** — the actual latest export admitted by structure and clone-scope semantics.

## Live Source-admission incident

The first run against current SHA `1571cef...` stopped before Target mutation with:

```text
CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_MISMATCH
```

All structural count/Record gates passed. The only mismatches were:

```text
(VDO) Content Creator          missing
(Graphic) Content Creator      missing
คำถามจาก Sale & Support        missing
```

These three names are Target identity anchors, not clone-source requirements. Their absence from refreshed Source does not by itself indicate Source schema drift.

The defect came from `refreshAuthorityMismatches()` iterating `REQUIRED_PROTECTED_TABLE_NAMES`. That mixed Target identity ownership with Source admission.

### Corrected ownership

Target checkpoint anchors remain:

```text
🎵 RAW_TikTok_Creator_Videos
(VDO) Content Creator
(Graphic) Content Creator
คำถามจาก Sale & Support
```

They continue to validate the checkpoint/Target identity.

Source refresh admission no longer requires those Target-only anchors. Instead it uses:

1. structural counts;
2. minimum Record count;
3. 32-table clone projection after protected TikTok exclusion;
4. exact unique clone-scope name-set equality against `checkpoint.expectedTableNames` before controlled mutation.

This preserves fail-closed behavior without rejecting a valid latest Source because customer Target-only anchor tables are absent.

## Code milestones

View v3 + first refresh implementation:

```text
HEAD  382d0a6fd3f0ed600d43244b54b3d44bc755c7ac
Run   32325406976
Job   96295532732
PASS  all Branch Verification steps
```

Source admission correction after live SHA `1571cefa...` evidence:

```text
5ac438745f6fec0728cd08ccf461e4780cda0969  remove Target anchors from Source refresh gate
f0f259f1a2bb56e6d0e2a77d79ffe213f72eb4ff  compare clone scope by exact unique name set, not export order
66109d9145f90c3537a386df40abe3b4ceee10d3  regression coverage
```

The final branch HEAD must pass full Branch Verification before the next Target Apply.

## No-repeat rules

- Never prepare a new checkpoint.
- Never delete/recreate successful partial clone Tables/Fields/Relations.
- Never delete/recreate `fldA1bzPlX`.
- Never retry Bitable v1 Formula presentation PUT.
- Never retry combined legacy View filter/hidden PATCH.
- Never require customer Target-only anchors to exist in refreshed Source.
- Never treat Table ordering alone as Source schema drift.
- Never lower structural counts or clone-name-set gates to force acceptance.
- Never mutate Source, Worker, D1, Queue, schedule or deployment state in this recovery.

## Next evidence required

Run controlled `--apply` only from the final CI-verified branch HEAD using the same original checkpoint and the current Source file.

Expected interpretation:

1. Source structural/scope mismatch → stop before Target mutation;
2. Source admission passes → reuse all existing Target state;
3. Formula definitions verify with no presentation PUT;
4. Base v3 View filter/visible-field parity executes;
5. View readback mismatch/rejection → preserve state and fix only that contract;
6. Views pass → continue hierarchy, Advanced Permission and canonical verification;
7. automatic completion → finish manual Formula/View layout/Dashboard/Workflow parity and final Target export comparison.
