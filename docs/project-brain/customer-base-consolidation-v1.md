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

The file contains top-level `gzipSnapshot`, `gzipExtraInfo`, `gzipBaseRole`, `gzipAccessConfig`, `gzipDashboard`,
`gzipAutomation`, and `sign`. Each `gzip*` value is base64-encoded gzip JSON.

`gzipSnapshot` contains 34 snapshot entries but only 33 unique table IDs because `📣 MKT_Report_Top_Ads` appears in two
snapshot entries. Counts must therefore dedupe exported stable IDs. The earlier 35,373-record baseline is superseded by this
latest export's 35,528 unique records.

The Live `Social MKT Data Hub` app token that exposes only 17 tables is not migration authority and cannot block creation.
It remains optional diagnostic evidence only.

## Customer PROD configuration

`.customer.prod.vars` remains Git-ignored.

Target read/write modes require:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

Local Source export path defaults to:

`/Users/wasanjantawong/Downloads/Social MKT Data Hub(20260818-030125).base`

Optional overrides/diagnostics:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN` (diagnostic only)

`--source-export-audit` requires no Lark credential and performs zero remote request.

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

A missing target API permission, unsupported write operation, unresolved reference, collision with unrelated customer content,
or unverifiable exported property is blocking. No warning may be downgraded into a fake 100% result.

## Export reader implementation

`scripts/lib/lark-base-export.js` v2 now parses the real canonical export format instead of a guessed generic schema:

- validates the required gzip envelope members;
- gzip/base64-decodes each JSON payload locally;
- inventories Tables from `schema.tableMap`;
- inventories Fields/Views from `schema.data.table.fieldMap/viewMap`;
- inventories Records from `schema.data.recordMap`;
- dedupes every entity by stable exported ID across snapshot chunks;
- detects relation type 18 and formula type 20;
- inventories Dashboard/Automation/Role payloads;
- emits SHA-256, exact counts, table/role names and duplicate-snapshot diagnostics;
- performs zero remote calls.

## Operator v4

`customer_base_full_parity_operator_v4` uses:

```text
exact local .base export
→ exact SHA + structure/count/table-set preflight
→ optional GET-only customer Target inspection
→ full clone/remap implementation (blocked until coverage complete)
→ controlled Apply
→ GET-only canonical verifier
```

Read-only modes:

- `--source-export-audit`: local-only, defaults to the pinned Downloads file, no Lark config required
- `--full-parity-audit`: local Source export + GET-only Target inspection

Legacy `--provision-missing`, `--preview`, `--apply`, `--verify` remain blocked until full clone/remap coverage exists.

## Existing Target evidence

Latest Target inspection showed 4 tables total:

- expected existing `🎵 RAW_TikTok_Creator_Videos`
- unrelated `(VDO) Content Creator`
- unrelated `(Graphic) Content Creator`
- unrelated `คำถามจาก Sale & Support`

Unrelated customer tables are protected and must not be overwritten/deleted. Existing TikTok table may be reused only if
final canonical parity passes.

## Reuse requirement

The repository already contains `packages/application/src/use-cases/consolidate-lark-base.js`, which implements reusable
core createTable, field, relation/formula remap, record copy/relation rewrite, view creation and verification mechanics.
This engine must be extended rather than replaced.

Remaining gaps before 100% Apply:

- normalized local-export Source adapter into the existing consolidator
- full Field property fidelity
- complete View visible/filter/group/sort/timebar/card fidelity
- forms/questions when present
- dashboards/blocks/layout/data_config
- workflows/automation
- Advanced Permission role config
- attachment handling if present
- canonical verifier across all export dimensions

## Safety boundary

- Source mutation: 0
- Local export audit remote request: 0
- Live Source dependency: optional diagnostic only
- Target write: blocked until full clone coverage
- Existing unrelated customer content: immutable/protected
- Deletes: 0 unless separately approved
- Worker/D1/Queue/schedule changes: 0
- Secrets stay local/environment only

## Remaining closure sequence

1. Pass exact-head CI for operator v4 + actual export parser.
2. Run local `--source-export-audit`; exact SHA and latest counts must pass without Lark credentials.
3. Feed normalized export into existing consolidation engine and implement all remaining parity dimensions.
4. Dry-run/preview Target with zero unhandled dimensions and zero unrelated-content collisions.
5. One controlled Apply.
6. GET-only canonical verifier proves 100% parity for every export-represented dimension.
7. Only then may PR #661 be ready for merge/closeout.
