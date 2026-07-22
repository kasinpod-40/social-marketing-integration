# Integration Workspace Contract

## Purpose

The project uses one pre-Production Integration Workspace to assemble every part of the system end to end: Connector, Raw/Canonical mapping, Worker, D1, Queue/DLQ, lock/retry, Lark Base, reports, AI summaries, insights and notifications.

It is not operated as separate DEV and UAT modes.

## Fixed runtime model

```text
MKT_ENV=development                 # technical isolation label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

The profile remains constant while channels are built and while source accounts are replaced. Legacy profile names are compatibility aliases only and must not be used as workflow stages. Existing TikTok report records keyed with `dev_ft_pumkin` remain readable as legacy stable identifiers, so this model does not require an immediate Lark record rewrite.

## Ownership model

Infrastructure ownership and source ownership are separate concerns:

| Layer | Integration Workspace | Production |
| --- | --- | --- |
| Lark Base / Worker / D1 / Queue / DLQ / secret store | Developer-owned current resources | Customer-owned |
| Runtime profile | `integration_workspace` | `chemistry_k` |
| Target customer context | Chemistry K | Chemistry K |
| Source ownership | Mixed per Connector | Customer for every Connector |
| Schedule | Disabled until channel validation | Approved production schedule only |

Current source roles:

| Connector | Current source role | Replacement required before final customer-data validation |
| --- | --- | --- |
| TikTok | developer temporary substitute (`ft.pumkin`) | yes |
| Facebook | developer temporary substitute | yes |
| Instagram | developer temporary substitute | yes |
| YouTube | developer temporary substitute | yes |
| Google Ads | Chemistry K customer-real | no |
| WooCommerce | Chemistry K customer-real/access-dependent | no |
| Chatwoot | Chemistry K customer-real/access-dependent | no |

The table is operational metadata, not a reason to create another environment/profile.

## Identity contract

- `customerKey=chemistry_k` identifies the target business context.
- Connector `accountKey` identifies the current source account and may differ while a temporary substitute is used.
- Every connector exposes `sourceOwner`, `sourceRole` and `replacementRequired` in runtime readiness metadata.
- Stable keys must include the connector account/source identity required by the existing Data Model.
- Do not relabel temporary developer data as customer source data in logs or evidence.

## Assembly workflow

1. Use whichever authorized source exists for each channel.
2. Finish schema, connector, Worker route, reliability, reporting and downstream AI/notification flow in the same Workspace.
3. Keep channel feature flags and schedules fail-closed until that channel's manual validation passes.
4. Do not switch profiles between channels.

## Replacing a temporary source with customer data

For each connector marked `replacementRequired=true`:

1. disable that connector and its schedules;
2. capture source identity, checkpoint, row counts and backup/export;
3. delete only rows scoped to the temporary platform/account/source identity according to an approved cleanup plan;
4. replace credentials and source identifiers in Environment/Secret configuration;
5. update the connector account/source mapping without changing the Workspace profile;
6. run full backfill, reconciliation and idempotent rerun;
7. verify zero temporary-source rows and zero duplicate customer stable keys;
8. re-enable only after validation.

Never bulk-delete unrelated channels or shared tables without exact platform/account filters and reconciliation evidence.

## Final validation and Production

When every connector uses customer data:

1. run the full multi-channel end-to-end validation in the same Integration Workspace;
2. verify reports, AI summary/insight, alerts, retries, locks, DLQ and schedules;
3. freeze the approved code/config contract;
4. reproduce the same architecture on customer-owned Lark/Cloudflare/platform resources using profile `chemistry_k`;
5. do not migrate secrets from developer ownership; customer-owned secrets must be created in customer-controlled stores.

## Safety

- customer login credentials are never collected;
- secrets remain in Secret Manager/Environment only;
- source ownership is visible in runtime metadata and evidence;
- business schedules remain disabled until manual validation;
- Production remains separate and customer-owned;
- this contract does not authorize Google Ads mutation, Lark schema reopening or Production cutover.
