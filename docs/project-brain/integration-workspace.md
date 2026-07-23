# Integration Workspace Contract

## Purpose

โปรเจกต์ใช้ Workspace ก่อน Production เพียงชุดเดียวเพื่อประกอบระบบตั้งแต่ Source Connector ถึง Lark Canonical, Reporting, AI Summary, Insight, Alert และ Notification ให้เสร็จครบทั้งก้อน

Workspace นี้ไม่ถูกแบ่งเป็น DEV และ UAT ในการทำงานประจำวัน

## Fixed runtime model

```text
MKT_ENV=development                 # Technical runtime/isolation label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

Profile นี้คงเดิมตลอดการประกอบระบบและการแทนที่ Source account รายช่องทาง

## Ownership model

| Layer | Integration Workspace | Production |
| --- | --- | --- |
| Lark Base | Developer-owned current Base | Customer-owned |
| Worker / D1 / Queue / DLQ / Secret store | Developer-owned current resources | Customer-owned |
| Runtime profile | `integration_workspace` | `chemistry_k` |
| Target customer context | Chemistry K | Chemistry K |
| Source ownership | Mixed per Connector | Customer for every Connector |
| Schedule | Fail-closed until channel acceptance | Approved Production schedule |

Infrastructure ownership and Source ownership are separate concerns. A customer-owned source may be connected to the developer-owned Integration Workspace without creating another environment.

## Current source status

| Connector | Current source | Status |
| --- | --- | --- |
| TikTok Organic | Chemistry K `@chemistry_k` through Lark Native TikTok For Creator | RAW populated; Canonical sync for current customer source not yet verified |
| Facebook Organic | Developer temporary source | Replace later in same Workspace |
| Instagram Organic | Developer temporary source | Replace later in same Workspace |
| YouTube Organic | Developer temporary source | Replace later in same Workspace |
| Google Ads | Chemistry K advertiser linked and read-only data available | Signed delivery exists only in Draft PR `#17`; not merged/deployed |
| WooCommerce | Chemistry K source/access-dependent | Connector pending |
| Chatwoot | Chemistry K source/access-dependent | Connector pending |

## Verified TikTok facts

Latest inspected Base inventory records:

```text
RAW_TikTok_Creator_Videos   2,021 records / 18 fields
MKT_Content                    22 records / 29 fields
MKT_Content_Daily             208 records / 15 fields
```

These table-level counts prove that the RAW source is populated and the Canonical tables exist. They do **not** prove that the current Chemistry K TikTok RAW rows have been normalized into the two Canonical tables correctly.

The visible Lark Native connection is Chemistry K `@chemistry_k`, and the user confirms it has been connected for a long time. It is not a new account transition.

## Identity rules

- `customerKey=chemistry_k` is the target business context.
- New TikTok synchronization for Chemistry K must use `accountKey=chemistry_k`.
- Stable keys must preserve Platform, account identity and source entity ID according to the approved Data Model.
- Historical names such as `dev_ft_pumkin`, `uat_chemistry_k` or `ft_pumkin` may exist in configuration, reports, logs or older code.
- Those names are not sufficient evidence that current RAW records belong to another TikTok account.
- Never delete, relabel or migrate business records based only on an old Profile/configuration label.

## Current TikTok gap

The missing step is:

```text
RAW_TikTok_Creator_Videos (Chemistry K)
→ MKT_Content
→ MKT_Content_Daily
→ reconciliation
→ idempotent rerun
→ report verification
```

This is a Canonical synchronization and verification task, not an account authorization or source replacement task.

## Source replacement workflow for other channels

When a customer source becomes available for a Connector still using a temporary developer source:

1. disable only that Connector and its business schedule;
2. capture current source identity, checkpoint and row counts;
3. back up/export affected source-scoped data;
4. replace credentials and source identifiers without changing the Workspace profile;
5. run bounded backfill and reconciliation;
6. rerun for idempotency;
7. remove temporary-source rows only with exact Platform/account/stable-key scope and explicit approval;
8. re-enable only after acceptance.

Never bulk-delete unrelated channels or shared tables.

## Future storage and notification direction

The approved future direction is recorded in:

`docs/project-brain/time-series-retention-and-notification.md`

It preserves this single Integration Workspace model and proposes D1 as detailed historical/runtime storage, Lark as current-state/aggregate/report/configuration presentation, and customer-configurable Lark Group notifications.

This direction is `AUDIT_PENDING / IMPLEMENTATION_NOT_STARTED` and does not authorize:

- changing `MKT_Content_Daily` or `MKT_Ads_Daily` Grain/Retention;
- creating Notification tables or D1 migrations;
- deleting historical Records;
- enabling new schedules;
- reopening the completed Lark schema/Formula/View contract.

A separate Current Task must first audit the complete Repository `main`, latest Base and all Writer/Reader/Report dependencies.

## Production cutover

After every Connector uses customer data and the whole Integration Workspace passes end-to-end validation:

1. freeze the approved code and contracts;
2. reproduce the same architecture on customer-owned Lark and Cloudflare resources;
3. create customer-owned secrets in customer-controlled stores;
4. run fresh Production preflight, backfill, reconciliation and idempotent rerun;
5. enable schedules only after Production acceptance.

Production is not the current Integration Workspace and remains disabled until a separate approved cutover task.

## Safety

- no customer passwords or interactive login credentials in Git, Lark or chat;
- secrets remain in Environment/Secret Manager;
- Source ownership is recorded per Connector;
- Schedule remains fail-closed until channel validation;
- no Lark schema, Formula or View reopening without a new approved contract;
- no TikTok record cleanup based only on legacy labels;
- no Retention/delete behavior before historical source-of-truth, reconciliation and rollback evidence;
- no Google Ads mutation;
- no Production cutover from this document alone.
