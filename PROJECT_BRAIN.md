# Project Brain — Social Marketing Data Integration

## Purpose

ระบบรวมข้อมูล Social Organic, Paid Ads, Commerce และ Conversation เข้าสู่ Lark Base เพื่อทำ Daily Snapshot, Reporting, AI Summary, Insight และ Alert โดยใช้ Cloudflare Workers, D1, Queues และ JavaScript ES Modules

ไฟล์นี้เก็บ **Current verified state** เท่านั้น ประวัติรุ่นอยู่ใน `CHANGELOG.md` และเอกสารใต้ `docs/project-brain/`

Authority order ให้ยึด `AGENTS.md` และ `docs/current-task.md` ก่อนเสมอ

## Current repository baseline

- Main code/documentation baseline before this docs update: `c9c77b19bb1dd9572d71e455a391cf70bc3cc9dd`
- Application package line: `0.11.0`
- Lark schema/View/Formula closeout: complete; do not reopen without a new approved contract
- Google Ads signed-delivery implementation: Draft PR `#17`, not merged to `main`, not deployed

## Integration Workspace operating model

There is one pre-Production **Integration Workspace**, not separate DEV and UAT operating modes

```text
MKT_ENV=development                 # technical runtime label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

Current Workspace resources are developer-owned:

- Social MKT Data Hub Lark Base
- Cloudflare Worker
- D1
- Queue and DLQ
- Secret store
- checkpoints, locks, sync runs and alerts

Source ownership is tracked per Connector and can be mixed temporarily. Production remains separate and must be customer-owned

Full contract: `docs/project-brain/integration-workspace.md`

The old separate-UAT document `docs/project-brain/customer-real-uat.md` is superseded and retained only as history

## Current source ownership

| Connector | Source currently used in Integration Workspace | Current gap |
| --- | --- | --- |
| TikTok Organic | Chemistry K `@chemistry_k` through Lark Native | RAW populated; current customer RAW → Canonical sync not yet verified |
| Facebook Organic | Developer temporary source | Connector/normalization/reliability and later customer-source replacement |
| Instagram Organic | Developer temporary source | Connector/normalization/reliability and later customer-source replacement |
| YouTube Organic | Developer temporary source | Customer-source replacement and final validation |
| Google Ads | Chemistry K advertiser linked/read-only data available | Signed delivery remains Draft PR `#17`; not merged/deployed |
| Meta Ads | Developer no-data account preflight | Connector and customer data validation |
| TikTok Ads | Access/design preflight only | Business authorization, reporting contract and connector |
| WooCommerce | Chemistry K source/access-dependent | Connector pending |
| Chatwoot | Chemistry K source/access-dependent | Connector pending |

## Current Lark Base baseline

Latest verified configuration closeout:

```text
Physical tables             42
Fields                     737
Views                      133
Filtered Views              42
Sorted Views                 6
Views with hidden fields     7
Duplicate table names        0
Table emoji/folders       42/42
View emoji names         133/133
Google Ads formulas          4/4 PASS
Google Ads filters          19/19 PASS
Shared-table filters        17/17 PASS
Report Views                 6/6 PASS
```

Do not rerun Lark View Apply or Formula UI work

Latest inspected record inventory relevant to TikTok:

```text
RAW_TikTok_Creator_Videos   2,021 records / 18 fields
MKT_Content                    22 records / 29 fields
MKT_Content_Daily             208 records / 15 fields
```

These counts prove that the RAW source is populated and Canonical tables exist. Counts alone do not prove that Chemistry K TikTok RAW rows were synchronized correctly into both Canonical tables

## TikTok Organic current state

Verified:

- Lark Native TikTok For Creator is connected to Chemistry K `@chemistry_k`
- connection existed before the current documentation correction
- protected RAW table is populated with 2,021 records
- TikTok reliability foundation, stable-key planning, locks, retry, DLQ and report components exist in the codebase

Not yet verified for the current Chemistry K source:

- exact RAW identity/unique-video audit
- current runtime mapping to `accountKey=chemistry_k`
- write plan into `MKT_Content`
- write plan into `MKT_Content_Daily`
- reconciliation of expected/created/updated/skipped
- idempotent rerun with zero duplicates
- downstream report verification from Chemistry K Canonical rows

Therefore TikTok Organic is not considered complete merely because RAW is populated

Historical names such as `dev_ft_pumkin`, `uat_chemistry_k` or `ft_pumkin` may remain in old configuration/report history. They are not sufficient evidence to identify the owner of current Lark records and do not authorize deletion or relabeling

## Google Ads current state

Merged `main` state:

- Chemistry K advertiser link/selectability passed
- Manager Script read-only Preview passed
- six non-empty datasets returned
- errors/truncation `0/0`
- Google Ads reported `No changes`
- Lark schema, relations, formulas and managed Views complete
- direct API Basic Access review remains optional Phase 2

Draft PR `#17` state:

- signed Manager Script delivery connector implemented and tested on its branch
- HMAC/timestamp/nonce/replay/idempotency contract
- Worker ingress, D1 delivery state and reference-only Queue job
- 12-table Google Ads plan/reconciliation
- schedule disabled

Draft PR `#17` is **not** the `main` implementation baseline and has not been deployed or externally validated

## Other channel status

### YouTube Organic

- public/OAuth access and initial connector foundation exist
- developer source used in the Integration Workspace
- customer-source replacement and final customer-scale validation remain

### Facebook Organic

- real Page/post/Page Insights access preflight passed on developer source
- shared Meta transport/schema foundation exists
- business connector, normalization and reliability remain

### Instagram Organic

- token lifecycle, media and insights preflight passed on developer source
- shared schema foundation exists
- connector, operations and reliability remain

### Meta Ads

- `ads_read` preflight passed
- current developer ad account returns valid no-data
- connector and real customer data validation remain

### TikTok Ads

- separate from TikTok Organic
- controlled API/Worker connector required
- access, authorization, reporting and reliability remain

### WooCommerce / Chatwoot

- source/transport contracts exist
- production-grade connectors remain

## Core runtime rules

Every active write path must reuse:

- central Connector and Job catalogs
- deterministic stable keys
- idempotent plan/diff/execute
- D1 checkpoints and resumable work
- distributed lease lock and renewal
- bounded retry and Permanent classification
- Queue/DLQ and controlled redrive
- reconciliation and alerts
- secret/identity redaction

Do not create a parallel reliability stack for a new Connector

## Current task

Authoritative task: `docs/current-task.md`

Next implementation task:

```text
TikTok Chemistry K RAW
→ MKT_Content
→ MKT_Content_Daily
→ reconciliation
→ idempotent rerun
→ report verification
```

This is not a TikTok account-switch task and does not authorize RAW deletion or Lark schema changes

Google Ads PR `#17` remains Draft until the shared documentation baseline and work sequencing are synchronized

## Permanent safety rules

- Data model before Connector
- one Integration Workspace before customer-owned Production
- mixed Source ownership is tracked per Connector, not by switching environments
- new Connector flags and schedules disabled by default
- no fake Production success or dummy Production data
- every write path requires stable key, idempotency and retry semantics
- missing metric is `null`, not zero, unless the source proves zero
- secrets remain in Environment/Secret Manager
- no record deletion/relabeling from a historical Profile name alone
- no Lark schema/Formula/View reopening without a new approved contract
- Production resources must be customer-owned
- no Live Apply based only on chat instructions when Repository contract is newer
