# Customer Base View v3 + Source Refresh Recovery — 2026-08-20

## Scope

This is the current recovery authority for PR #661 after Formula definition passed live and the controlled customer Apply reached the View phase.
It also records the replacement of the local Source export with a newer export containing today's latest data.

## Immutable Target recovery baseline

- Target Base: `✨Marketing Content Calendar`
- Original controlled-Apply checkpoint SHA-256: `7c1176faab7b039acb81b663e442837e6d80a79d922c8d6e6cefbfbcaef93053`
- Checkpoint Source baseline SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
- Clone scope: 32 Tables
- Protected external Table: `🎵 RAW_TikTok_Creator_Videos`
- Target folder placement: complete under `Setup Phase | Social MKT Data Hub`

The checkpoint is a pre-write **Target ownership fence**. It must never be recreated after partial Target writes.

## Retained successful Target state

The customer Target already contains migration-owned partial state that must be reused:

- 32 clone-scope Tables created/claimed;
- ordinary fields progressed;
- Relation fields progressed;
- Formula definition progressed through Base v3;
- `📣 MKT_Ads_Campaigns.budget` exists as `fldA1bzPlX` and must not be deleted/recreated;
- legacy Formula result-presentation PUT was rejected and is permanently removed from automatic ownership;
- the controlled Apply later advanced to Views.

No destructive rollback is permitted.

## Latest live View failure

The live operator stopped at:

```text
code       CUSTOMER_BASE_RESUME_REMOTE_WRITE_REJECTED
operation  updateView
Table      🪪 MKT_Accounts
Table ID   tblVB102JoqSfgHa
HTTP       400
Lark code  1254001
```

The failed path used the old combined Bitable v1 View PATCH shape for hidden fields / filters.
Do not rerun that exact payload.

## Official View contract evidence

Current official Lark CLI sources expose Base v3 View property endpoints:

```text
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
PUT /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
GET /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/filter
GET /open-apis/base/v3/bases/:base_token/tables/:table_id/views/:view_id/visible_fields
```

`visible_fields` requires an object body:

```json
{"visible_fields":["field-id-or-name"]}
```

The Filter contract uses tuple DSL:

```json
{
  "logic": "and",
  "conditions": [
    ["field-id", "intersects", ["Active"]],
    ["other-field-id", "non_empty"]
  ]
}
```

The official supported operator family is:

```text
== != > >= < <= intersects disjoint empty non_empty
```

## Repository repair

The migration engine remains `consolidate-lark-base.js`.
The existing `withLarkBaseParityCapabilities()` decorator now overrides `updateView()` at the Lark HTTP boundary and reuses the same authenticated/retried transport.

Automatic View behavior:

1. Target hidden field IDs are validated against live Target fields.
2. Hidden fields are converted to the documented `visible_fields` body.
3. Legacy filter `conjunction` becomes Base v3 `logic`.
4. Legacy operators map to Base v3 tuple operators.
5. Single/MultiSelect and Relation membership use `intersects` / `disjoint`.
6. Scalar equality uses `==` / `!=`.
7. Numeric comparisons use `>`, `>=`, `<`, `<=`.
8. Empty tests use `empty` / `non_empty` with no value.
9. Checkbox values preserve Boolean type.
10. Filter and visible-field writes are separate remote operations.
11. Each write receives immediate GET readback; mismatch fails closed.
12. All writes still pass through the existing resumable/checkpoint write fence.

No second HTTP client, clone engine or migration wrapper was introduced.

## Latest Source export replacement

The user replaced this file in place with a newer export containing today's latest data:

`/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`

Therefore filename/path equality no longer implies the old SHA.

The controlled operator now distinguishes:

- **checkpoint baseline authority** — immutable historical Source SHA retained inside the original Target checkpoint;
- **current refresh Source authority** — the actual SHA and data currently present in the local export.

A current export may be admitted for `--apply` only when all structural dimensions remain compatible:

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

The required protected/anchor Tables must still exist.
After creating the current clone projection, its exact 32 Table names must equal `checkpoint.expectedTableNames` before any Target mutation.

This permits current Record data to refresh while preventing a changed schema/scope from being silently replayed against the partial customer Target.

`--prepare-checkpoint` remains exact-baseline-only and is forbidden operationally for this workstream.

## Verification milestone

The code milestone that introduces Base v3 View writes and refresh-compatible Source admission is:

```text
HEAD  382d0a6fd3f0ed600d43244b54b3d44bc755c7ac
Run   32325406976
Job   96295532732
PASS  all Branch Verification steps
```

Passed:

- syntax / architecture / hygiene;
- focused Report / Meta / Woo / Chatwoot / TikTok suites;
- Unit + Workers runtime;
- View v3 focused regression;
- Report reliability;
- dependency audit;
- Wrangler dry-run;
- diff whitespace / diagnostics.

## No-repeat rules

- Never prepare a new checkpoint.
- Never delete/recreate the 32 partial clone Tables.
- Never delete/recreate `fldA1bzPlX`.
- Never retry Formula presentation PUT through Bitable v1.
- Never retry combined legacy View PATCH for filter/hidden parity.
- Never lower structural Source-refresh admission merely to accept a new file.
- Never mutate the Source export.
- Never mutate Worker, D1, Queue, schedule or deployment state in this recovery.

## Next live evidence

The next controlled `--apply` must use the final CI-verified branch HEAD and original checkpoint.

Expected behavior:

1. locally inspect the current export;
2. reject before Target mutation if structural/source scope changed incompatibly;
3. reuse all successful partial Target state;
4. verify Formula definitions without presentation PUT;
5. execute Base v3 View filter/visible-field parity;
6. proceed to hierarchy / Advanced Permission / canonical verification if Views pass;
7. preserve all successful state if any later blocker appears.

Automatic completion still does not equal full UI parity. Formula result presentation, unsupported View layout dimensions, Dashboards, Workflows and final Target export comparison remain closure requirements.
