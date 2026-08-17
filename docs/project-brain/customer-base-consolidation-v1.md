# Customer Base Full Parity v1 — 2026-08-17

## Business target

Customer requires the Social MKT Data Hub resources inside the existing Base `✨Marketing Content Calendar`, with the
final location under `Setup Phase | Social MKT Data Hub`. The latest user requirement supersedes the earlier blank-table
provisioning plan: **everything must match the Source 100%**, including Views, Filters, Sorts and all other existing
configuration/data dimensions.

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

This baseline is not sufficient to claim parity because the live imported Source may also contain detailed View
properties, Forms, Dashboard block layouts/configs, Workflow steps/states, permission config and attachment-like cells.
The live GET-only audit is therefore authoritative for the final migration scope.

## Superseded assumptions

The following earlier assumptions are no longer valid authority:

- creating 32 blank target tables is sufficient preparation;
- table/field/record/relation/formula plus only supported View properties is enough for closeout;
- Dashboard/Automation/Advanced Permission parity can be silently closed as a separate optional workstream;
- internal Base folder placement is necessarily UI-only.

Current Base v3 resource APIs expose block-tree/folder operations and dedicated View property, Form, Dashboard,
Workflow and Advanced Permission role operations. They must be audited and used where required by the Source state.

The current native table-copy endpoint is not a cross-Base copy primitive: its endpoint operates within one `base_token`.
It therefore cannot directly move a table from the imported Source Base into `✨Marketing Content Calendar`.

## Customer PROD credential isolation

Customer-owned PROD credentials are intentionally separated from integration/development runtime configuration.

Tracked template:

`/.customer.prod.vars.example`

Local secret file on the operator Mac:

`/.customer.prod.vars`

The local secret file is Git-ignored. The customer consolidation operator now reads it by default; `CUSTOMER_PROD_VARS_FILE`
may override the path only when an explicit alternate local file is required.

Required values are:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_CUSTOMER_CONSOLIDATION_SOURCE_APP_TOKEN`
- `LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN`

The Lark App ID/Secret must belong to the customer PROD application and be authorized to read both Source and Target Base.
The file must not contain a tenant access token because the shared Lark client obtains and refreshes that token itself.
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
18. Attachment-like cells and any other Source resource discovered by the live audit.

A missing API permission, unsupported Source feature, unresolved destination collision or unverifiable property is a
blocking condition. The operator must never downgrade it to a warning and claim 100% parity.

## Safety boundary

- Source mutation: 0
- Customer target provisioning: BLOCKED
- Customer target Apply: BLOCKED
- Table/field/record/delete: 0
- Dashboard/workflow/permission mutation: 0
- Worker/D1/Queue/schedule mutation: 0
- Existing unrelated customer content must remain untouched
- Secrets remain in `.customer.prod.vars`/process environment only; logs expose only hashed Base identity

The old `--provision-missing`, `--preview`, `--apply` and `--verify` paths are actively rejected by the customer operator
while Full-Parity Apply is incomplete.

## Full-Parity Audit implementation

`packages/application/src/use-cases/audit-lark-base-full-parity.js` is the current allowed customer path.
It performs GET-only inventory of Source and Target:

- Tables / Fields / Records / Views
- Base v3 block tree
- View detail plus filter / visible_fields / group / sort / timebar / card subresources
- Forms and questions
- Dashboards and dashboard blocks
- Workflows
- Advanced Permission roles

The audit records every read failure as a blocker and produces counts/digests instead of dumping raw customer records.
A strict read interceptor also makes subresource failures (including View property reads) global blockers.
The audit itself never authorizes Apply; it exists to establish the complete live migration contract first.

## Existing synced TikTok table

`🎵 RAW_TikTok_Creator_Videos` was previously observed in the Target Base through Cross-Base Data Sync with 2,040
records. Under the 100%-parity contract it is not accepted merely because the name/row count exists. Its complete Field,
Record, View and other attached configuration must pass the same canonical parity verifier or the run must fail closed.

## Repository state

Draft PR: `#661`

Customer PROD config isolation was implemented and verified. Exact head `84c1cea8ccee05e04caa5fb061aa21184672d09a`
passed Branch Verification run `32041774990`, job `95422242257`; locked install, architecture/hygiene, focused channel suites,
Unit/Workers, Report Reliability, dependency audit, Wrangler dry-run and diff check all passed.

No Customer Lark mutation has been run by this full-parity workstream.

## Current implementation files

- `.customer.prod.vars.example`
- `.gitignore`
- `packages/application/src/use-cases/audit-lark-base-full-parity.js`
- `scripts/customer-base-consolidation-operator.mjs`
- `tests/application/audit-lark-base-full-parity.test.js`
- existing consolidation/preplaced modules remain in repository for reuse only after the new full-parity contract is met

## Remaining closure sequence

1. Create local `.customer.prod.vars` from `.customer.prod.vars.example` and fill the 4 required values.
2. Run one live GET-only Full-Parity Audit against the actual imported Source Base and customer Target Base.
3. Resolve all read permission/capability gaps; no hidden/unknown Source dimension is allowed.
4. Build minimal clone/remap support using existing shared Lark client/contracts plus current Base v3 resource endpoints.
5. Run dry-run/preview proving every Source dimension is handled and unrelated target resources are untouched.
6. Execute one controlled target Apply.
7. Run canonical GET-only post-Apply verifier.
8. Close only when every required dimension reports parity and no unresolved blocker remains.
