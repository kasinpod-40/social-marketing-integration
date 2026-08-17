# Customer Base Consolidation v1 — 2026-08-17

## Business target

Customer wants the Social MKT Data Hub tables inside the existing Base `✨Marketing Content Calendar`, grouped
under the internal Base navigation folder `Setup Phase | Social MKT Data Hub`. A separate duplicated Base is not
the requested final layout.

## Verified source export

Read-only inspection of `Social MKT Data Hub(20260817-033903).base` established:

- 33 unique tables
- 35,373 unique records
- 723 fields
- 111 views
- 12 relation fields
- 4 formula fields
- 6 dashboards
- 2 automations
- 4 Advanced Permission roles
- largest table 9,141 rows, within the customer's Pro row limit

The export is structurally valid at JSON/base64/gzip level. Cross-Base Data Sync is not used as the final
migration mechanism because relation/formula semantics are degraded during sync.

## Architecture decision

The migration reuses the existing central `LarkBitableClient` and the branch's table/field/record/relation/
formula/view consolidation use case. It does not add another Lark transport, queue, worker or schema engine.

Lark OpenAPI can create and edit tables but does not expose the internal Base navigation-folder placement
required by the customer. Therefore customer consolidation uses a preplaced-table safety boundary:

1. all 33 destination tables must already exist in the target Base;
2. the operator never calls the underlying remote `createTable()`;
3. a destination table with zero records, one primary field and one view is treated as a safe shell;
4. the shell is claimed in place by updating its primary field and default view, preserving the existing table ID;
5. the existing consolidation path then creates the remaining fields, records, relations, formulas and supported
   views inside that preplaced table;
6. non-empty/non-shell target tables remain visible to the generic parity preflight and must be exact/reusable
   or the run fails closed;
7. Apply requires explicit human confirmation that the preplaced tables are inside
   `Setup Phase | Social MKT Data Hub`, because folder membership itself is not OpenAPI-verifiable.

This preserves the customer's requested layout and removes remote table creation from the customer operator
path without duplicating the migration engine.

## Existing synced TikTok table

`🎵 RAW_TikTok_Creator_Videos` is already present in the target Base through Cross-Base Data Sync with 2,040
records. The operator does not special-case it by name. Because it is non-empty, it stays visible to the normal
exact/conflict preflight. It may be reused only if its current field/record shape passes that preflight; otherwise
migration stops instead of overwriting it.

## Safety

- Source mutation: 0
- Remote target table create: 0
- Table/field/record delete: 0
- Queue/D1/Worker/schedule/automation mutation: 0
- Customer live Apply: not run while customer-owned credential/folder gates remain open
- Secrets remain environment-only; logs expose only hashed Base identity

## Branch verification

Draft PR: `#661`

Exact verified head: `896d63518ebe44143652a17764abf980b5de982e`

Branch Verification:
- run `32024949257`
- job `95372300469`
- conclusion `success`
- install / syntax / architecture / hygiene passed
- focused Report, Meta, Woo, Chatwoot and staged TikTok suites passed
- Unit and Workers runtime passed
- Report Reliability passed
- dependency audit passed
- Wrangler dry-run passed
- diff whitespace check and diagnostics upload passed

No customer Lark mutation was used as test evidence.

## Implementation files

- `packages/application/src/use-cases/consolidate-lark-base.js`
- `packages/application/src/use-cases/preplaced-lark-base-target.js`
- `scripts/customer-base-consolidation-operator.mjs`
- `tests/application/consolidate-lark-base.test.js`
- `tests/application/preplaced-lark-base-target.test.js`

## Remaining closeout gates

Repository implementation and CI are complete. Remaining gates are external/customer-owned only:

- customer target GET-only preview with all 33 names present
- explicit confirmation that all destination tables are under the required internal folder
- one controlled customer Apply only after ownership/credential verification
- GET-only post-Apply parity verification
- separate Dashboard/automation/workflow/Advanced Permission parity closeout

Dashboard, automation/workflow and Advanced Permission parity are not silently treated as completed by table consolidation.
