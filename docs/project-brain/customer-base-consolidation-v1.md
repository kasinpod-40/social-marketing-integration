# Customer Base Consolidation v1 — 2026-08-17

## Business target

Customer wants the Social MKT Data Hub tables inside the existing Base `✨Marketing Content Calendar`, grouped
under the internal Base navigation folder `Setup Phase | Social MKT Data Hub`. A separate duplicated Base is not
the requested final layout.

The user has explicitly authorized a temporary staging exception: missing destination tables may be created at the
Target Base root/default placement through Lark OpenAPI, after which the user will manually move those newly created
blank tables into `Setup Phase | Social MKT Data Hub` before Consolidation Apply.

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

Lark OpenAPI can create and edit tables but does not expose the internal Base navigation-folder placement required by
the customer. The workstream therefore uses two deliberately separated phases:

### Phase A — root/default-placement provisioning

1. `--provision-missing` reads the current Target Base table list first.
2. Existing expected table names are preserved and never recreated or overwritten.
3. Duplicate target names or table-limit overflow fail closed before any create call.
4. Only missing exact expected names are created, each as an empty one-field shell with one default Grid view.
5. Rerunning after success is idempotent and creates zero additional tables.
6. This phase requires explicit write confirmations and does not read or mutate the Source Base.
7. The user manually moves the newly created tables into `Setup Phase | Social MKT Data Hub` in Lark UI.

### Phase B — consolidation Apply

1. all 33 destination tables must already exist in the Target Base;
2. the Apply path never calls the underlying remote `createTable()`;
3. a destination table with zero records, one primary field and one view is treated as a safe shell;
4. the shell is claimed in place by updating its primary field and default view, preserving the existing table ID;
5. the existing consolidation path then creates the remaining fields, records, relations, formulas and supported
   views inside that preplaced table;
6. non-empty/non-shell target tables remain visible to the generic parity preflight and must be exact/reusable
   or the run fails closed;
7. Apply requires explicit human confirmation that the tables are inside `Setup Phase | Social MKT Data Hub`, because
   folder membership itself is not OpenAPI-verifiable.

This keeps remote table creation out of the actual migration Apply while allowing the user-authorized root provisioning
step to eliminate manual creation of dozens of blank tables.

## Existing synced TikTok table

`🎵 RAW_TikTok_Creator_Videos` is already present in the target Base through Cross-Base Data Sync with 2,040
records. Provisioning does not special-case or recreate it because its exact expected name is already present.
During consolidation it stays visible to the normal exact/conflict preflight. It may be reused only if its current
field/record shape passes that preflight; otherwise migration stops instead of overwriting it.

## Safety

- Source mutation: 0
- Target table create: allowed only in explicit `--provision-missing` mode and only for missing expected names
- Consolidation Apply remote table create: 0
- Existing table overwrite/rename during provisioning: 0
- Table/field/record delete: 0
- Queue/D1/Worker/schedule/automation mutation: 0
- Customer live provisioning: not yet run
- Customer live Apply: not run
- Secrets remain environment-only; logs expose only hashed Base identity

## Verification state

Draft PR: `#661`

The previous preplaced-only implementation passed Branch Verification at head
`8d0412ffbfc75621b3060af56d2730f93c2f77ba`, run `32025415791`.

The newer user-authorized root-provisioning change requires a fresh exact-head Branch Verification before any live
`--provision-missing` execution. Customer Lark has not been used as test evidence for this change.

## Implementation files

- `packages/application/src/use-cases/consolidate-lark-base.js`
- `packages/application/src/use-cases/preplaced-lark-base-target.js`
- `scripts/customer-base-consolidation-operator.mjs`
- `tests/application/consolidate-lark-base.test.js`
- `tests/application/preplaced-lark-base-target.test.js`

## Remaining closeout gates

- exact-head Branch Verification for root provisioning change
- one controlled customer `--provision-missing`
- read-back proving all expected table names exist and existing tables were preserved
- manual move of newly created tables into `Setup Phase | Social MKT Data Hub`
- customer target GET-only preview with all 33 names present
- explicit confirmation that all destination tables are under the required internal folder
- one controlled customer Apply only after ownership/credential verification
- GET-only post-Apply parity verification
- separate Dashboard/automation/workflow/Advanced Permission parity closeout

Dashboard, automation/workflow and Advanced Permission parity are not silently treated as completed by table consolidation.
