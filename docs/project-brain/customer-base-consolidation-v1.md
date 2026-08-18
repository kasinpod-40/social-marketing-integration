# Customer Base Full Parity v1 — 2026-08-18

## Business target

Customer requires the Social MKT Data Hub resources inside the existing Base `✨Marketing Content Calendar`, with final
location under `Setup Phase | Social MKT Data Hub`. User accepts temporary creation at root and will move tables afterward
if needed. Completion requires **100% functional/UI parity** for every configuration/data dimension represented in the
approved Source export.

Generated Lark IDs may differ only when all references are deterministically remapped and resulting behavior/UI remains equivalent.

## Authoritative Source

The migration authority is the latest local Lark Base export uploaded by the user:

`Social MKT Data Hub(20260818-030125).base`

Pinned identity:

- size: 13,331,288 bytes
- SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`

Direct inspection of the real export envelope establishes:

- 33 unique tables
- 35,528 unique records
- 723 unique fields
- 111 unique views
- 12 relation fields
- 4 formula fields
- 6 dashboards
- 2 automations/workflows
- 4 Advanced Permission roles

`gzipSnapshot` contains 34 snapshot entries but only 33 unique table IDs because `📣 MKT_Report_Top_Ads` appears in two
snapshot chunks. Counts dedupe stable IDs. The earlier 35,373-record baseline is superseded by this export's 35,528 rows.

The Live `Social MKT Data Hub` app token exposing only 17 tables is diagnostic only and cannot block creation.

## Customer PROD configuration

`.customer.prod.vars` is Git-ignored. Target read/write modes require:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

Exact local Source path used by the operator Mac:

`/Users/wasanjantawong/Desktop/Social MKT Data Hub.base`

Optional overrides/diagnostics:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN` (diagnostic only)

`--source-export-audit` requires no Lark credential and performs zero remote request. The exact user-run audit passed the
pinned SHA and all 33/723/35,528/111/12/4/6/2/4 counts with `blockers=[]`.

## Full-parity contract

Final verifier must cover every dimension represented by the Source export:

1. 33-table business set and names.
2. Full Field contracts: primary state, type, ui-type, descriptions, properties, formatters and options.
3. All exported Records/cell values.
4. Relations with target table/record ID remap.
5. Formula definitions/dependencies with field/table ID remap.
6. Every View and View type.
7. Visible-field order/visibility.
8. View Filter.
9. View Group.
10. View Sort.
11. View Timebar.
12. View Card configuration.
13. Forms/Questions when represented in export data.
14. Dashboards/themes/blocks/layout/data_config.
15. Workflows/Automation definitions, steps and exported state.
16. Advanced Permission role configuration represented in export.
17. Attachment-like cells when included.

Any unhandled exported property, target API permission gap, unresolved reference, or collision with customer content is a blocker.

## Immutable pre-existing Target policy

User instruction is now broader than the original TikTok-only protection: **do not touch anything that already exists in
`✨Marketing Content Calendar`**.

Therefore every Table present in the Target snapshot before migration starts is immutable/read-only for this workstream.
Latest observed set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

The rule is dynamic: if more Tables exist when the real Preview/Apply starts, those IDs are also automatically protected.

Forbidden operations on any pre-existing Table:

- duplicate/recreate by name;
- rename/delete;
- create/update Field;
- create/update Record;
- create/update View/Filter/Sort/Group/view property;
- alter Cross-Base Sync or other customer configuration.

`protect-customer-lark-target.js` v2 snapshots all existing Table IDs/names, blocks their write methods before the underlying
OpenAPI request, and allows writes only to Tables created after that snapshot.

`🎵 RAW_TikTok_Creator_Videos` is a Source-overlap special case: it must exist and Preview can accept it only as
`reuse_exact`. Any mismatch or create/repair plan blocks Apply; migration must not modify the existing TikTok table to make
it match.

Unrelated existing Tables require no Source plan entry but remain fully protected by the client fence.

The historical consolidator still contains a View loop that can write views on reused tables. Apply must remain disabled
until that behavior is changed so `reuse_exact` tables receive zero writes even without relying on the outer fence.

## Export implementation

`scripts/lib/lark-base-export.js` parses the actual canonical export envelope and validates exact SHA/count/table-set
identity with zero remote calls.

`scripts/lib/lark-base-export-source-client.js` is the read-only adapter into the existing consolidator interface. It:

- dedupes snapshot chunks;
- exposes `listTables/listFields/listRecords/listViews/getView`;
- normalizes Text, Number, Date, Select, MultiSelect, URL and relation cells into OpenAPI-write-compatible values;
- preserves exported Relation/Formula properties;
- retains raw field/view metadata for later full-fidelity remapping;
- exposes Dashboard/Workflow/Role/Access payloads for later parity phases;
- creates no new transport and performs zero remote requests.

Regression coverage includes Select/MultiSelect/URL values, duplicate snapshots, relations/formulas and View metadata
(filter/sort/group/hidden/order).

## Existing consolidator reuse

`packages/application/src/use-cases/consolidate-lark-base.js` remains the shared migration engine. It already implements:

- createTable;
- ordinary Fields;
- relation/formula ID remap;
- record copy and relation-record remap;
- basic View creation/update;
- table/field/record/view verification.

It must be extended, not replaced. Current gaps before 100% Apply:

- remove all write behavior for `reuse_exact` tables;
- full Field-property fidelity;
- full View visible/filter/group/sort/timebar/card fidelity;
- forms/questions when present;
- dashboards/blocks/layout/data_config;
- workflows/automation;
- Advanced Permission role config;
- attachment handling if present;
- canonical verifier across every export dimension;
- protected Target policy wired into the only enabled Preview/Apply path.

## Safety boundary

- Source mutation: 0
- Local export remote request: 0
- Live Source dependency: optional diagnostic only
- Every pre-existing Target Table: immutable/read-only
- TikTok overlap: `reuse_exact` or block
- Writes allowed only to migration-created post-snapshot Tables
- Deletes: 0
- Worker/D1/Queue/schedule changes: 0
- Secrets stay local/environment only
- Apply remains blocked until full clone/remap/verifier coverage is complete

## Remaining closure sequence

1. Exact-head CI for export Source adapter + all-existing Target fence.
2. Wire the adapter into GET-only consolidator Preview.
3. Snapshot/protect all pre-existing Target tables; require TikTok/source overlaps to be `reuse_exact`.
4. Remove historical reused-table View writes from the consolidator.
5. Implement every remaining export-represented parity dimension.
6. GET-only Preview must prove zero unhandled dimensions and zero mutation surface against existing customer resources.
7. One controlled Apply may write only newly-created migration Tables.
8. GET-only canonical verifier proves 100% parity while every pre-existing Target resource remains unchanged.
9. Only then may PR #661 be ready for merge/closeout.
