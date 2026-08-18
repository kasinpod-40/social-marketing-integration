# Customer Base Full Parity v1 — 2026-08-18

## Business target

Migrate `Social MKT Data Hub` resources into the existing customer Base `✨Marketing Content Calendar` with exact
functional/UI parity for the **32 clone-scope Tables**, while preserving every resource that existed in the customer Base
before migration.

The exact local `.base` export is the migration authority. TikTok Native is intentionally not cloned.

## Authority

```text
file                        Social MKT Data Hub(20260818-030125).base
sha256                      c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643
size                        13,331,288 bytes
Tables                      33
Fields                      723
Records                     35,528
Views                       111
Relations                   12
Formulas                    4
Dashboards                  6
Workflows                   2
Advanced Permission roles   4
```

`📣 MKT_Report_Top_Ads` appears in two snapshot chunks but one stable exported Table identity; parsers dedupe it.

## Policy B — immutable protected external TikTok

User-selected contract:

- clone scope = 32 Tables;
- `🎵 RAW_TikTok_Creator_Videos` = `protected_external_reuse`;
- Target live TikTok is authoritative for its current state;
- TikTok is excluded from clone comparison, plan, Apply and clone verification;
- TikTok still remains under the pre-existing customer write fence;
- every other Table already in Target is also immutable;
- no historical-export repair of pre-existing customer resources.

Latest observed pre-existing Target set:

- `🎵 RAW_TikTok_Creator_Videos`
- `(VDO) Content Creator`
- `(Graphic) Content Creator`
- `คำถามจาก Sale & Support`

## Live evidence

GET-only v6 customer audit on the real Target:

```text
ok                               true
policyBPreviewReady              true
fullParityReady                  false
remoteMutationCount              0
cloneApplyEnabled                false
Target Tables before             4
clone-scope Tables present       0
createTables                     32
reuseExactTables                 0
conflicts                        0
warnings                         0
clone Fields                     705
clone Records                    33,488
clone Views                      110
```

The Policy-B live Preview gate is closed. Full parity remains blocked by represented UI/Base resources.

## Actual clone-scope View inventory

All 110 clone Views are grid Views.

```text
hidden fields       11
filters             78
field order        110
sort                 41
group                 4
column config        94
row height          110
frozen columns      110
hierarchy             1
card                  0
color                 0
forms                 0
public level        110
```

Only represented dimensions may block this export; card/color/Form work is not required for this authority artifact.

## Existing shared engine reuse

`packages/application/src/use-cases/consolidate-lark-base.js` remains the only table migration engine.

It already handles:

- Table creation
- Fields
- Relation and Formula dependency remap
- Records and Relation record remap
- basic Views
- hidden fields
- View filters
- creation-only writes for missing Tables

No new parallel migration engine was introduced.

## Canonical clone verifier

Added `verify-lark-base-clone-canonical-parity.js`.

Contract: `customer_base_clone_canonical_verifier_v1`.

Coverage:

- full readable Field configuration
- generated Select option ID canonicalization
- Date defaults
- Relation Table-ID remap
- Formula Table/Field-ID remap
- every readable Record field value
- Relation record-ID remap
- View name/type/public/hidden/filter with Field-ID remap
- unrelated customer Tables ignored

The verifier is GET-only. Focused/full Branch Verification passed after implementation. It is intentionally not connected to an
enabled customer Apply path yet.

## Documented View hierarchy parity

Official Feishu/Lark documentation explicitly demonstrates PATCHing a View with:

```json
{
  "property": {
    "hierarchy_config": {
      "field_id": "..."
    }
  },
  "view_name": "..."
}
```

Implementation therefore adds only this proven contract:

- `withLarkBaseParityCapabilities` decorator reuses existing `requestBitableJson` transport;
- GET current hierarchy;
- Source field ID → field name → Target field ID remap;
- PATCH only when different;
- GET readback after update;
- hierarchy mutation is inside `protectCustomerLarkTarget` write fence;
- `applyLarkBaseDocumentedViewParity` is a post-consolidation phase but is not exposed through the customer operator.

No request body for other rich View metadata is inferred from export/response properties.

## View properties without proven write contracts

Represented but still blocked:

- field order — 110 Views
- sort — 41 Views
- group — 4 Views
- column config — 94 Views
- row height — 110 Views
- frozen columns — 110 Views

The official surface confirms generic View CRUD and the concrete hierarchy request above, but this workstream has not found a
safe documented write payload for these six properties. They are classified as
`documented_write_contract_not_proven`, not merely “code not written”.

## Dashboard capability

The approved export contains 6 Dashboards.

Official Bitable public surface found for dashboards:

- List Dashboards
- Copy Dashboard by an existing `block_id`

No documented local-export-payload → create Dashboard inside the existing Target Base contract has been proven. Whole-Base copy
creates a separate Base and does not satisfy the customer destination requirement. Therefore Dashboard parity remains fail-closed.

## Workflow capability

The export contains 2 Workflows/Automations.

Official public evidence confirms:

- List Workflows API;
- permission scopes for workflow create/update/delete/status;
- status update capability.

A complete documented workflow-definition replay request contract from local export payload has not been proven. Do not guess endpoint
paths or bodies.

## Advanced Permission v2 capability

The Target reports Advanced Permission v2.

Official v2 create-role contract exists:

```text
POST /open-apis/base/v2/apps/:app_token/roles
```

with:

- `role_name`
- `table_roles`
- optional `block_roles`
- optional `base_rule`

This makes role materialization potentially automatable, but it is not safe to implement until exact current export `gzipBaseRole`
shape and its Source Table/Dashboard references are known and pre-existing Target roles/resources have their own ownership fence.

## Value-redacted local resource shape audit

Added:

- `scripts/lib/lark-base-export-resource-shape.js`
- `scripts/customer-base-export-resource-shape-audit.mjs`

The operator reads only the exact pinned local export and emits structural metadata for:

- dashboards
- workflows
- roles
- accessConfig
- extraInfo

Output contains property paths, primitive **types**, array lengths and reference-key counts only. Primitive values are never emitted,
so IDs/tokens/member identities/workflow text are not leaked.

Authority SHA/count mismatch blocks the local audit.

Remote request count and mutation count are always zero.

## Resource ownership safety gap

The existing Target fence is Table-oriented. Before any Base-level Dashboard/Workflow/Role write can be enabled, the migration must:

1. snapshot pre-existing Target Base-level resource identities;
2. protect those resources from update/delete;
3. permit only migration-created resources;
4. reject same-name/same-identity ambiguity before mutation;
5. canonical-readback every created resource.

This is required even if the API itself supports creation.

## Apply state

```text
Customer Apply               disabled
Target mutation              0 to date
Source mutation              0
Worker/D1/Queue/Schedule     untouched
PR #661                      Draft / Open / not merged
```

`cloneApplyEnabled` must not change until every represented dimension is closed by automated parity or explicit verified manual parity.

## Remaining sequence

1. Pass exact-head Branch Verification for canonical verifier + hierarchy parity + value-redacted shape audit + docs.
2. Run one local-only resource-shape audit on the exact approved `.base` file.
3. Use actual resource structure to implement only documented/provable Dashboard/Workflow/Advanced Permission handling.
4. Add Base-level resource ownership/protection fence before any such write path exists.
5. Resolve fieldOrder/sort/group/colInfos/rowHeight/frozen through documented API or explicit manual verification; do not invent payloads.
6. Build one controlled orchestration around existing consolidator → documented parity phases → canonical verifier.
7. Enable exactly one controlled Apply only after `fullParityReady=true` by contract.
8. GET-only canonical verification plus UI/manual evidence for API-unexposed dimensions.
9. Only then mark PR #661 Ready and merge.
