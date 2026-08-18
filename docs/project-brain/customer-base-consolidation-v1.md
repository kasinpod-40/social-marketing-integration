# Customer Base Full Parity v1 — 2026-08-18

## Business target

Customer requires the Social MKT Data Hub resources inside the existing Base `✨Marketing Content Calendar`, with the
final location under `Setup Phase | Social MKT Data Hub`. Completion requires **100% functional/UI parity** with the
valid imported Source authority, including Tables, full Field configuration, Records, Relations, Formulas, every View
and view type, visible-field order, Filter, Group, Sort, Timebar, Card configuration, Forms/Questions, Dashboards,
Workflows/Automation and Advanced Permission role configuration.

A new Lark-generated resource ID may differ from the Source only when all references are deterministically remapped and
the resulting UI/behavior is equivalent. Generated IDs are not themselves the business parity target.

## Verified source export baseline

Earlier read-only inspection of `Social MKT Data Hub(20260817-033903).base` established:

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

This export baseline remains the expected Source authority shape. Live OpenAPI identity must prove it is reading the
corresponding imported Base before Deep Full-Parity Audit output can be treated as authoritative.

## Customer PROD credential isolation

Customer-owned PROD credentials are separated from integration/development runtime configuration.

Tracked template: `/.customer.prod.vars.example`

Local secret file on the operator Mac: `/.customer.prod.vars`

The local secret file is Git-ignored. Required values:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

The Lark App ID/Secret must belong to the customer PROD application and be authorized to read both Source and Target Base.
Real credential values must never be committed, copied into docs, or emitted in logs.

## Full-parity contract

The final canonical verifier must cover every dimension present in the Source:

1. Base block tree and required folder placement.
2. Exact 33-table business set.
3. Full Field contract: name, primary state, type, ui-type, description, formatter/property/options and references.
4. Full Records/cell values.
5. Relation targets and relation cell references after ID/record remap.
6. Formula definitions/dependencies after ID remap.
7. Every View and View type.
8. View Filter.
9. View visible-field order/visibility.
10. View Group.
11. View Sort.
12. View Timebar.
13. View Card configuration.
14. Forms and form questions/configuration.
15. Dashboards, themes, blocks, layout and data_config.
16. Workflows/Automation definitions, steps and enabled/disabled state.
17. Advanced Permission roles and full role configuration.
18. Attachment-like cells and any other Source resource discovered by the valid live audit.

A missing API permission, unsupported Source feature, unresolved destination collision or unverifiable property is a
blocking condition. The operator must never downgrade it to a warning and claim 100% parity.

## First live GET-only audit — 2026-08-18

The first customer-credential audit safely completed with `ok=false` and `remoteMutationCount=0`.

Configured Source readback:

- 17 tables
- 367 fields
- 22,901 records
- 87 views
- 8 relation fields
- 4 formula fields
- 16 expected tables missing
- 0 unexpected tables

This is a material mismatch against the 33-table imported-source baseline. The evidence does **not** yet prove one single
root cause such as a wrong token. Plausible identity causes include pointing at the current Integration Base instead of
the imported 33-table Source, an incomplete imported Source, or data-access visibility differences. The next operator
must prove Base metadata and exact table set before Deep Audit.

Configured Target readback:

- 4 tables
- 81 fields
- 2,210 records
- 20 views
- 1 dashboard with 4 dashboard blocks
- existing expected `🎵 RAW_TikTok_Creator_Videos` with 2,040 records
- unrelated customer tables `(VDO) Content Creator`, `(Graphic) Content Creator`, and `คำถามจาก Sale & Support`

The three unrelated customer tables are not migration targets and were not mutated. Attachment-like cells observed in
customer content remain protected evidence only.

## API contract diagnosis from official Lark CLI

The first audit also exposed a distinction between real capability gaps and one incorrect request contract:

- Base block list path `POST /open-apis/base/v3/bases/:base_token/blocks/list` is correct; official required scope is
  `base:block:read`.
- Form list path `GET /open-apis/base/v3/bases/:base_token/tables/:table_id/forms` is correct; official required scope is
  `base:form:read`.
- Advanced Permission role list path `GET /open-apis/base/v3/bases/:base_token/roles` is correct; official scope is
  `base:role:read`, Advanced Permission must be enabled, and caller must be a Base admin.
- Workflow list in the first audit was wrong: it called GET `/workflows`; official contract is
  `POST /open-apis/base/v3/bases/:base_token/workflows/list` with `base:workflow:read`.
- View property routes are official Base v3 routes with `base:view:read`, but Live `800010502` responses have not yet
  been proven to mean unsupported/not-applicable versus another capability condition. They remain fail-closed evidence.

Therefore the repository fix must not suppress `99991672` or `800010502` globally. It must first prove the Source identity,
then annotate exact required scopes/capabilities and continue only on the valid Source authority.

## Identity-preflight repair

`packages/application/src/use-cases/preflight-customer-base-full-parity.js` now performs a GET-only gate before the
expensive deep audit:

- canonical Base metadata GET `/open-apis/bitable/v1/apps/:app_token`
- existing shared `listTables()`
- exact Source name check
- exact Target name check
- exact Source 33-table set check

If Source is not the exact authority, operator v2 prints safe metadata/table-set diagnostics and stops with
`deepAuditExecuted=false`, `remoteMutationCount=0`.

The operator also includes a compatibility correction for the old audit Workflow list call, translating the old GET
shape to official POST `.../workflows/list` semantics. Strict read failures now annotate required scopes for block, form,
workflow, role and view paths; Role additionally records the Advanced Permission/Base-admin condition.

## Safety boundary

- Source mutation: 0
- Customer target provisioning: BLOCKED
- Customer target Apply: BLOCKED
- Table/field/record/delete: 0
- Dashboard/workflow/permission mutation: 0
- Worker/D1/Queue/schedule mutation: 0
- Existing unrelated customer content must remain untouched
- Secrets remain in `.customer.prod.vars`/process environment only; logs expose only hashed Base identity

The old `--provision-missing`, `--preview`, `--apply` and `--verify` paths remain actively rejected while Full-Parity
Apply is incomplete.

## Repository state

Draft PR: `#661`

Latest implementation after the first Live audit adds Source identity/table-set preflight and Workflow request contract
correction. Exact-head Branch Verification is pending for this new repair.

No Customer Lark mutation has been run by this full-parity workstream.

## Current implementation files

- `.customer.prod.vars.example`
- `.gitignore`
- `packages/application/src/use-cases/preflight-customer-base-full-parity.js`
- `packages/application/src/use-cases/audit-lark-base-full-parity.js`
- `scripts/customer-base-consolidation-operator.mjs`
- `tests/application/preflight-customer-base-full-parity.test.js`
- `tests/application/audit-lark-base-full-parity.test.js`
- existing consolidation/preplaced modules remain for reuse only after the new full-parity contract is met

## Remaining closure sequence

1. Pass exact-head repository CI for the Live-audit diagnosis repair.
2. Rerun the GET-only operator; inspect the new Source/Target metadata and table-set preflight only.
3. If Source remains 17/33, replace only `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN` with the actual imported
   33-table Source Base token and rerun; do not mutate either Base.
4. Once Source preflight is exact 33/33, Deep Full-Parity Audit may run.
5. Resolve exact scope/capability blockers using official contracts; do not suppress unknown read errors.
6. Build minimal clone/remap support using existing shared Lark client/contracts.
7. Run dry-run/preview proving every Source dimension is handled and unrelated target resources are untouched.
8. Execute one controlled target Apply.
9. Run canonical GET-only post-Apply verifier.
10. Close only when every required dimension reports parity and no unresolved blocker remains.
