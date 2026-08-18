# Customer Base Full Parity v1 — 2026-08-18

## Business target

Customer requires the Social MKT Data Hub resources inside the existing Base `✨Marketing Content Calendar`, with the
final location under `Setup Phase | Social MKT Data Hub`. User explicitly accepts temporary creation outside that folder
and will move the created tables afterward if needed. Completion still requires **100% functional/UI parity** with the
approved Source export for every configuration/data dimension actually represented in that export.

Generated Lark IDs may differ only when all references are deterministically remapped and resulting behavior/UI remains equivalent.

## Authoritative Source

The migration authority is now the local Lark Base export:

`Social MKT Data Hub(20260817-033903).base`

The Live `Social MKT Data Hub` app token that currently exposes only 17 tables is not the migration authority and must not
block table creation. It remains optional diagnostic evidence only.

Earlier read-only inspection of this exact export established:

- 33 unique tables
- 35,373 unique records
- 723 fields
- 111 views
- 12 relation fields
- 4 formula fields
- 6 dashboards
- 2 automations/workflows
- 4 Advanced Permission roles
- largest table 9,141 rows

Official Lark/Feishu documentation states that `.base` exports are JSON and preserve Base structure including tables,
views, fields, dashboards, automations/workflows and Advanced Permission configuration; exports made with structure+data
also include row data. The format intentionally does not preserve some external identity/security state such as role member
assignments, cloud-document permission/history/comments, share-enabled states, or third-party plugin credentials. Those are
not reconstructable from the export itself and must not be falsely claimed as copied.

## Customer PROD configuration

Customer-owned PROD config is isolated in `.customer.prod.vars` and Git-ignored.

Required:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

Documented default Source path:

`/Users/wasanjantawong/Downloads/Social MKT Data Hub(20260817-033903).base`

Optional diagnostic only:

- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN`

The Lark App credentials need Target read/write scopes. Source live read permission is no longer a prerequisite for clone authority.

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
13. Forms and Questions.
14. Dashboards/themes/blocks/layout/data_config.
15. Workflows/Automation definitions, steps and exported state.
16. Advanced Permission role configuration represented in the export.
17. Attachment-like cells when included.

A missing target API permission, unsupported write operation, unresolved reference, collision with unrelated customer content,
or unverifiable exported property is blocking. No warning may be downgraded into a fake 100% result.

## Why the previous path was wrong

The previous operator required the Live Source Base to prove exact 33/33 before Deep Audit. The actual configured Source
returned 17 tables, so the gate stopped before any creation even though the approved `.base` export already existed and
had previously been inspected as 33-table authority.

That gate was an unnecessary dependency and contradicted the desired migration model. It is now superseded.

## Local export reader

`scripts/lib/lark-base-export.js` is a local-only Source authority reader:

- reads the `.base` file from disk;
- parses the JSON container;
- expands nested gzip+base64 JSON payloads when present;
- calculates file SHA-256 and size;
- inventories candidate tables, fields, records, views, relations, formulas, dashboards, workflows and permission roles;
- emits bounded structural diagnostics when the real export schema needs normalization adjustment;
- performs zero Lark/Provider/Worker/D1/Queue calls.

The approved baseline is enforced by `customer-base-consolidation-operator.mjs` before future write mode may be enabled.

## Operator v3

`customer_base_full_parity_operator_v3` uses:

```text
local .base export (Source authority)
→ local baseline/structure preflight
→ customer Target Base GET-only identity/table inspection
→ full clone/remap implementation (still blocked)
→ controlled Apply (still blocked)
→ GET-only canonical verifier
```

Supported read-only modes now include:

- `--source-export-audit`: local-only, no remote request
- `--full-parity-audit`: local Source export + GET-only Target inspection

Legacy `--provision-missing`, `--preview`, `--apply`, and `--verify` remain blocked until full clone/remap coverage exists.

## Existing Target evidence

Latest Target inspection before this architecture correction showed:

- 4 tables total
- expected existing `🎵 RAW_TikTok_Creator_Videos`
- unrelated customer tables `(VDO) Content Creator`, `(Graphic) Content Creator`, `คำถามจาก Sale & Support`

These unrelated customer tables are protected and must not be overwritten/deleted. Existing TikTok table may be reused only
if final canonical parity passes.

## Reuse requirement

The repository already contains `packages/application/src/use-cases/consolidate-lark-base.js`, which implements reusable
core mechanics for createTable, ordinary fields, relation/formula ID remap, record copy/relation rewrite, view creation and
verification. This existing engine must be extended, not replaced with a parallel migration framework.

Current gaps that must be added before 100% Apply:

- robust normalized local-export Source adapter
- full field-property fidelity beyond current minimal mutation shape
- complete view visible/filter/group/sort/timebar/card contracts
- forms/questions
- dashboards/blocks/layout/data_config
- workflows/automation
- Advanced Permission role config
- attachment handling if present
- canonical verifier across all dimensions

## Safety boundary

- Source mutation: 0
- Live Source dependency: optional diagnostic only
- Target write: blocked until export baseline + full clone coverage
- Existing unrelated customer content: immutable/protected
- Deletes: 0 unless separately approved in a future explicit scope
- Worker/D1/Queue/schedule changes: 0
- Secrets stay in `.customer.prod.vars`/process environment only

## Repository state

Draft PR: `#661`

Latest change replaces the Live Source 33/33 authority gate with the local `.base` export authority, adds the local export
reader and changes Customer PROD config accordingly. Exact-head Branch Verification must pass before the next local run.

## Remaining closure sequence

1. Run exact-head CI.
2. Run `--source-export-audit` against the exact local file and compare to approved baseline.
3. Align the normalized reader to the real export structure if any inventory recognition differs; do not fall back to the 17-table Live Source.
4. Adapt the local export into the existing consolidation engine and extend all missing parity dimensions.
5. Dry-run/preview against Target with zero unrelated-content collisions and zero unhandled exported dimensions.
6. One controlled Apply.
7. GET-only canonical verifier proves 100% parity for every export-represented dimension.
8. Only then may PR #661 be considered ready for merge/closeout.
