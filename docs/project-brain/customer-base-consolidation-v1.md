# Customer Base Full Parity v1 — 2026-08-18

## Business target

Customer requires the Social MKT Data Hub resources inside the existing Base `✨Marketing Content Calendar`, with final
location under `Setup Phase | Social MKT Data Hub`. Completion requires full functional/UI parity for the **32 clone-scope
Tables** represented in the approved Source export, while preserving every resource that already existed in the customer Base.

Generated Lark IDs may differ only when all references are deterministically remapped and resulting behavior/UI remains equivalent.

## Authoritative Source

The migration authority is the latest local Lark Base export uploaded by the user:

`Social MKT Data Hub(20260818-030125).base`

Pinned identity:

- size: 13,331,288 bytes
- SHA-256: `c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643`
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

## Policy B — protected external TikTok

Strict `reuse_exact` was retired for the customer migration after GET-only evidence proved that the pre-existing live
`🎵 RAW_TikTok_Creator_Videos` can legitimately drift from the pinned historical export while remaining an externally-owned
Lark Native source. The user explicitly selected Policy B.

Current contract:

- the complete 33-table export remains the pinned authority artifact and still must pass exact SHA/count validation;
- clone parity scope contains 32 Tables;
- `🎵 RAW_TikTok_Creator_Videos` is `protected_external_reuse`;
- the Target live TikTok table is authoritative for its current records/schema/UI;
- TikTok is excluded from clone comparison, clone plan, Apply traversal and clone verifier traversal;
- TikTok remains protected by the pre-existing Target write fence and may receive zero schema/record/view/rename/delete/repair writes;
- unrelated pre-existing customer Tables remain outside migration scope and immutable.

Legacy callers that do not enable the protected-external policy retain their historical v2 `reuse_exact` behavior.

## Latest real Target evidence

The user ran the exact Policy-B GET-only operator on the real customer Target after code HEAD
`da99551e4649592e50355e16b63ed39e292d7f65` had passed Branch Verification.

Observed result:

- operator `customer_base_full_parity_operator_v5`
- `ok=true`
- `blockers=[]`
- authority 33 / clone scope 32 / protected external 1
- Target before: 4 Tables
- clone-scope Target Tables present: 0
- create plan: 32
- clone-source totals: 705 Fields / 33,488 Records / 110 Views
- conflicts: 0
- warnings: 0
- `protectedPlan.ok=true`
- TikTok action: `protected_external_reuse`
- `remoteMutationCount=0`
- `cloneApplyEnabled=false`

This closes the Policy-B live Preview gate. Re-running the same read-only command without a code/contract change is not useful.

## Immutable pre-existing Target policy

Every Table present in `✨Marketing Content Calendar` before migration starts is customer-owned and read-only for this workstream.
Latest observed set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

The rule is dynamic: if more Tables exist when the real Apply starts, those IDs are automatically protected.

Forbidden operations on any pre-existing Table:

- duplicate/recreate by name;
- rename/delete;
- create/update Field;
- create/update Record;
- create/update View/Filter/Sort/Group/view property;
- alter Cross-Base Sync or other customer configuration.

`protect-customer-lark-target.js` v3 snapshots all existing Table IDs/names and blocks protected writes before the underlying
OpenAPI request. Policy B additionally requires the protected-external TikTok name to exist in that snapshot and remain absent
from clone plans.

## Export implementation

`scripts/lib/lark-base-export.js` parses the canonical export envelope and validates exact SHA/count/table-set identity with zero
remote calls.

`scripts/lib/lark-base-export-source-client.js` is the read-only adapter into the existing shared consolidator. It:

- dedupes snapshot chunks;
- exposes `listTables/listFields/listRecords/listViews/getView`;
- supports an `excludedTableNames` projection for the 32-table clone scope;
- refuses direct reads of an excluded table with `LARK_BASE_EXPORT_TABLE_OUTSIDE_SCOPE`;
- normalizes supported cell values into OpenAPI-write-compatible values;
- preserves Relation/Formula properties;
- retains rich View metadata including field order, sort, group, col infos, hierarchy/card/color state;
- exposes Dashboard/Workflow/Role/Access payloads through `getExportResources()`;
- creates no new transport and performs zero remote requests.

## Existing consolidator reuse

`packages/application/src/use-cases/consolidate-lark-base.js` remains the shared migration engine. It already implements:

- createTable;
- ordinary Fields;
- relation/formula ID remap;
- record copy and relation-record remap;
- basic View creation/update;
- table/field/record/view verification.

Policy-B scoping occurs before this engine, so the consolidator traverses only 32 clone Tables. Its Apply View loop is also fenced
to migration-created Table IDs.

Current gaps before Apply:

- full Field-property canonical verification;
- full record payload verification, not only primary-key set;
- full View visible-field order/filter/group/sort/hierarchy/card/color/row-height/frozen-column fidelity;
- Forms/Questions when represented;
- dashboards;
- workflows/automation;
- Advanced Permission role/member config;
- attachment handling if present;
- canonical verifier across every automated export dimension.

## OpenAPI capability correction

The earlier broad assumption that Dashboards/Automation/Permissions must remain standalone/manual is no longer accepted as a
contract. Official Feishu/Lark OpenAPI currently exposes relevant capabilities:

- Bitable v1 View list/create/update/get/delete;
- Form metadata/question read/update APIs, with Form represented as a View type;
- Dashboard list and Dashboard copy APIs;
- Workflow list API plus platform scopes for workflow create/update/delete/status operations;
- Advanced Permission role list/create/update/delete and collaborator APIs;
- Base metadata reports whether Advanced Permission is enabled; current Target reports `isAdvanced=true`.

Therefore remaining parity work is capability-driven. A dimension may be called manual only after official API inspection proves
that the necessary read/write contract is absent or cannot preserve the exported semantics. Unsupported dimensions must fail closed;
paths must never be invented from response structure.

`audit-lark-base-full-parity.js` currently contains speculative `/open-apis/base/v3/...` resource paths and must not become a release
gate until those reads are replaced with documented endpoints or explicit capability blockers.

## Full-parity contract for clone scope

Final verifier must cover every export-represented dimension applicable to the 32 clone Tables:

1. 32-table clone set and names.
2. Full Field contracts: primary state, type, ui-type, descriptions, properties, formatters and options.
3. All exported Records/cell values.
4. Relations with target table/record ID remap.
5. Formula definitions/dependencies with field/table ID remap.
6. Every View and View type.
7. Visible-field order/visibility.
8. View Filter.
9. View Group.
10. View Sort.
11. View hierarchy/timebar where represented.
12. View card/color/row-height/frozen-column configuration where represented and supported.
13. Forms/Questions when represented.
14. Dashboards/themes/blocks/layout/data_config to the extent exposed by documented APIs; any unsupported source detail is an explicit blocker.
15. Workflows/Automation definitions, steps and exported state to the extent exposed by documented APIs; unsupported definitions are explicit blockers.
16. Advanced Permission roles/config and collaborator assignments represented in the export and exposed by documented APIs.
17. Attachment-like cells when included.

TikTok is intentionally outside clone parity and instead requires protected identity + zero-write verification.

## Safety boundary

- Source mutation: 0
- Local export remote request: 0
- Live Source dependency: optional diagnostic only
- Every pre-existing Target Table: immutable/read-only
- TikTok: `protected_external_reuse`, structurally excluded from clone operations
- Writes allowed only to migration-created post-snapshot resources
- Deletes: 0
- Worker/D1/Queue/schedule changes: 0
- Secrets stay local/environment only
- Apply remains blocked until full clone/remap/verifier coverage is complete
- PR #661 remains Draft until controlled Apply and canonical verification complete

## Remaining closure sequence

1. Preserve the successful Policy-B GET-only Preview as current live evidence.
2. Align Current Task / Project Brain / release docs to Policy B.
3. Replace speculative parity-audit paths with documented Lark/Feishu APIs and explicit capability classification.
4. Extend the existing shared Lark client/consolidator only for official supported operations.
5. Add clone/remap/verify coverage for every supported exported dimension and explicit blockers for unsupported dimensions.
6. Run exact-head CI with Apply still disabled.
7. Run one fresh GET-only capability/full-parity audit after implementation changes; require zero mutation and no hidden/unclassified gap.
8. Enable exactly one controlled Apply path fenced to resources created by the 32-table migration.
9. Run GET-only canonical verifier and prove clone parity while all pre-existing Target identities remain unchanged.
10. Move cloned Tables into `Setup Phase | Social MKT Data Hub` manually only if internal navigation-folder placement remains unavailable through supported API.
11. Complete README/CHANGELOG and then Ready/Merge PR #661 only after all gates pass.
